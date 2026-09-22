# pdf.complianttools.com — Master Build Specification

> **Status:** Greenfield specification. The repository also contains the normalized capability
> reference (`comprehensive.md`), the visual implementation reference (`design.md`), and the saved
> template files under `saas-template/`; the implementation tree described below is the target build.
> **Audience:** An autonomous coding agent (or human team) implementing the product end to end.
> **Contract:** Everything needed to build, verify, and ship is in this document. Where a fact must be
> re-verified against a live third-party API or licence, the section is marked **⚠ VERIFY** with the
> exact verification step. Do not invent API shapes or licence terms; verify, then implement.
> **Inputs:** `comprehensive.md` is the normalized capability baseline; `design.md` and
> `saas-template/` are the physical design references. The capability list below preserves the
> distinctions that matter operationally: local versus remote processing, rendered pages versus
> extracted originals, combined files versus per-page/ZIP output, and deterministic versus AI work.
> **Modelled on:** `image.complianttools.com`'s README/PLAN pair. Same discipline, same non-negotiables,
> applied to PDF instead of raster images.

---

## Table of contents

1. [Product thesis](#1-product-thesis)
2. [Non-negotiable principles](#2-non-negotiable-principles)
3. [Competitive feature union](#3-competitive-feature-union)
4. [Complete tool catalog](#4-complete-tool-catalog)
5. [Format & standard support matrix](#5-format--standard-support-matrix)
6. [Exhaustive option reference](#6-exhaustive-option-reference)
7. [Technology decisions](#7-technology-decisions)
8. [Architecture](#8-architecture)
9. [Repository layout](#9-repository-layout)
10. [The engine API](#10-the-engine-api)
11. [UX specification](#11-ux-specification)
12. [Design system](#12-design-system)
13. [Capability escalation and BYOK AI](#13-capability-escalation-and-byok-ai)
14. [Provider adapter specifications](#14-provider-adapter-specifications)
15. [The CORS problem and the Relay](#15-the-cors-problem-and-the-relay)
16. [Key storage and security model](#16-key-storage-and-security-model)
17. ["Connect your AI" teaching page](#17-connect-your-ai-teaching-page)
18. [Persistence and state](#18-persistence-and-state)
19. [Performance budgets](#19-performance-budgets)
20. [Accessibility](#20-accessibility)
21. [Internationalization](#21-internationalization)
22. [Testing strategy](#22-testing-strategy)
23. [Build, CI, and deployment](#23-build-ci-and-deployment)
24. [SEO and growth](#24-seo-and-growth)
25. [Legal, privacy, and trust](#25-legal-privacy-and-trust)
26. [Implementation roadmap](#26-implementation-roadmap)
27. [Definition of done](#27-definition-of-done)
28. [Appendices](#28-appendices)

---

## 1. Product thesis

### 1.1 What this is

A **browser-based PDF toolkit** that performs every document-modification operation offered by the
leading online PDF converters — locally, in the user's browser, with no upload, no account, no
watermark, and no paywall. Where an operation genuinely requires a generative language model (chat
with a PDF, AI summarization, translation, quiz/flashcard generation, "generate a PDF from a prompt"),
the user supplies their own provider endpoint and secret (BYOK — Bring Your Own Key), and the app calls
it directly from the browser on the user's behalf.

The product has four explicit processing modes:

1. **Local browser mode:** parse, render, mutate, convert, OCR, sign, redact, and export on the device;
   after the application and any selected local models have loaded, these flows remain usable offline.
2. **BYOK AI mode:** an explicit, cost-estimated request to the provider endpoint chosen by the user;
   document content and the provider key go only to that configured endpoint, never to a service owned by
   this project.
3. **Self-hosted Relay mode:** an optional user-run service for arbitrary webpage capture and, where
   configured, delivery of a signature request. The public static app must remain useful without it.
4. **Capture mode:** camera/mobile input for scans, signatures, and images, followed by the same local
   PDF pipeline as imported files.

The full capability reference in `comprehensive.md` is normalized by outcome rather than by vendor
menu. The implementation must retain those outcome distinctions instead of collapsing them into a
generic "convert" button.

### 1.2 Why it wins

Every incumbent studied for this spec shares the same architectural weakness: **the PDF, and every
document merged, converted, or signed alongside it, is uploaded to a server you do not control.**
That is not an implementation detail — for a document toolkit it is the whole trust model. PDFs
routinely contain contracts, medical records, bank statements, tax returns, and signatures. Uploading
them to "process and delete within 24 hours" is a promise, not a guarantee.

The server-side architecture forces the same shape onto every competitor: daily/free-tier conversion
limits, file-size caps, sign-in walls for "premium" tools, per-file page limits, credit systems, and a
Pro tier gating OCR, batch, and API access. Moving the computation to the client removes the tax:

| Incumbent constraint | Our position |
| --- | --- |
| "Files uploaded only for processing, never stored" (Drawboard) — a promise, not a mechanism | Never leaves the device; nothing to delete, nothing to promise |
| Daily conversion limits, sign-in required beyond them (Adobe Acrobat online) | Unlimited, no sign-in, ever |
| 40 MB / 2-files-per-30-seconds ceiling (Drawboard PDF to Word) | Limited only by device RAM |
| Premium required for batch, OCR quality tiers, e-signature workflows (iLovePDF Premium/Desktop) | All of it, free, in the browser tab already open |
| Upload → server queue → poll → download | Instant; result renders as the pipeline runs |
| "Register for free to unlock additional features" (pdf.net) | No account, no email, ever |
| Chat/summarize/translate routed through the vendor's own AI backend, on the vendor's terms | Routed through *your* AI provider, with *your* key, under *your* terms |
| Requires network for every operation | Full PWA; the entire non-AI toolkit works offline after first load |

### 1.3 Positioning statement

> **Every PDF tool. In your browser. Nothing uploaded. Actually free.**

### 1.4 Growth mechanics

1. **Per-operation landing pages.** Search demand for PDF tools is enormous and literal: "pdf to word",
   "merge pdf", "compress pdf online", "unlock pdf without password", "bank statement to excel",
   "pdf to markdown". Each gets a prerendered, fast, self-contained page (§24), exactly as the
   reference competitors do — but ours works with JavaScript disabled for the file-picker and static
   copy, and never phones home.
2. **Shareable recipes.** A multi-step pipeline (e.g. "merge → add page numbers → compress → PDF/A")
   is encoded in the URL fragment. No server round-trip, no stored document, fully reproducible.
3. **Trust, provably.** "Nothing is uploaded" is verifiable in the browser's Network panel. No
   competitor with a server-side architecture can make and prove the same claim.

---

## 2. Non-negotiable principles

| # | Principle | Enforcement |
| --- | --- | --- |
| P1 | **Local-first.** Every non-generative operation runs on-device (parse, render, merge, split, convert, compress, sign, redact, OCR). | CI asserts zero network requests during a full pipeline run (§22.6). |
| P2 | **No upload of user documents, ever, except to a BYOK endpoint the user explicitly configured.** | CSP `connect-src` allowlist built at runtime from the user's own provider config only (§16.4). |
| P3 | **No account, no email, no sign-in.** | No auth code exists in the repo. |
| P4 | **No paywall, no credits, no watermark, no artificial page/file/daily caps.** | No billing code exists in the repo. |
| P5 | **No third-party runtime scripts.** No analytics SDK, no tag manager, no ad network, no font/library CDN. | CSP `script-src` is `'self'` only; all libraries and fonts self-hosted and pinned. |
| P6 | **Works offline.** After first visit, the full toolkit (excluding user-invoked AI calls and webpage→PDF capture) functions with the network off. | Playwright suite run with `context.setOffline(true)`. |
| P7 | **Keys are the user's.** Never transmitted to any origin we control; we operate no server capable of receiving them. | Static hosting only for the app; the optional Relay (§15) is stateless and never sees provider keys. |
| P8 | **Honest capability reporting.** If a codec, signature scheme, or feature is unavailable in this browser, or a document is malformed, say so plainly with the reason and the remedy. Never fail silently, never fabricate a result (never invent extracted table cells, never silently drop pages). | Every failure path is a typed error with a `remedy` field rendered in the UI. |
| P9 | **Byte-faithful by default.** Never silently re-render, re-flatten, strip metadata/bookmarks/tags, flatten forms, or rasterize text unless the user asked for exactly that. Every destructive step is explicit. | Default option values in §6 are all pass-through/no-op. |
| P10 | **Fast enough to feel direct.** A 20-page PDF opens and renders its first page in under 800 ms; option changes preview in under 150 ms. | Performance budget test in CI (§19). |
| P11 | **Programmatic before probabilistic.** A feature may call an external model only if no deterministic algorithm can produce an acceptable result — table extraction, layout-preserving DOCX reconstruction, and text extraction are programmatic; open-ended "chat with this PDF" is not. | Every AI code path has an entry in the AI Justification Register (§13.1.3). |
| P12 | **Escalation is the user's choice, never the default.** Where a local heuristic exists (e.g. keyword-extraction "summary", rule-based alt-text draft), it runs first and is shown; the AI upgrade is an explicit, costed, labelled action. | UI test asserts no AI request fires without an explicit user gesture. |
| P13 | **Clean IP by construction.** Every dependency is permissively licensed (no AGPL/GPL/LGPL rendering cores — this excludes MuPDF's AGPL license, Ghostscript's AGPL license, and LibreOffice's GPL/MPL-2.0-with-GPL-linkage headless conversion path from the default build), every font is redistributable, and every shipped model/asset is registered with provenance. Where no clean option exists we build our own or report the capability honestly unavailable. | `verify:licenses` and the static-asset register gate the build (§25). |

---

## 3. Competitive feature union

The product surface is the **union** of every feature observed across the seven reference products.
Where two products expose the same feature with different options, we ship the **superset**.

### 3.1 Sources

| ID | Product | What we take from it |
| --- | --- | --- |
| **SP** | [Smallpdf](https://smallpdf.com/pdf-tools) | Breadth of office/image ↔ PDF matrix, PDF/A conversion, redaction, AI Assistant, quiz/test generator, page-numbering, annotator |
| **ILP** | [iLovePDF](https://www.ilovepdf.com/) | Tool taxonomy and grouping (Organize/Optimize/Convert/Edit/Security/Intelligence), workflows, PDF Forms, AI Summarizer, Translate PDF, PDF→Markdown, Compare PDF, Scan to PDF |
| **P24** | [PDF24](https://tools.pdf24.org/en/all-tools) | The most exhaustive literal option set of any competitor: invoices/e-invoicing, webpage-to-PDF, QR generation, PDF overlay, pages-per-sheet, halve pages, bookmarks, rasterize, flatten, web-optimize, document-info editing, desktop companion apps |
| **OPDF** | [OpenPDF](https://openpdf.com/) | Minimal core-conversion baseline (convert/merge/split/compress) confirming the non-negotiable floor every competitor meets |
| **PDFN** | [pdf.net](https://pdf.net/) | Editor-first flow (change text, add image/text, signature background removal), bank-statement-to-Excel, Bates numbering, "Chat with PDF"/"Generate PDF"/"PDF Summarizer" AI set, share-via-link |
| **DB** | [Drawboard PDF](https://www.drawboard.com/tools/convert-pdf-to-word) | Build/View-and-Edit/Convert taxonomy, headers & footers, flatten, clean per-format conversion grid |
| **ADO** | [Adobe Acrobat online](https://www.adobe.com/acrobat/online.html) | The full generative-AI surface (chat, summary, flashcards, quiz, mind map, generate presentation), fill & sign, e-signature requests, reorder/insert pages, PSD/AI/INDD ingestion, OCR quality bar (the format's inventor) |

### 3.2 Union matrix

`●` = offered · `○` = partially offered · blank = not offered. **Ours** column: `●` = fully local,
no key, offline-capable · `◐` = local primary path with an optional, explicit AI escalation ·
`AI` = genuinely requires an external model, justified in §13.1.3.

| Capability | SP | ILP | P24 | OPDF | PDFN | DB | ADO | Ours |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Merge PDFs | ● | ● | ● | ● | ● | ● | ● | ● |
| Split PDF | ● | ● | ● | ● | ● | ● | ● | ● |
| Extract / delete / insert / reorder pages | ● | ● | ● | | ● | ● | ● | ● |
| Rotate pages | ● | ● | ● | | ● | ● | ● | ● |
| Rearrange / organize pages | ● | ● | ● | | ● | | ● | ● |
| Pages-per-sheet / N-up | | | ● | | | | | ● |
| Halve PDF pages | | | ● | | | | | ● |
| Crop / trim pages | ● | ● | ● | | | | ● | ● |
| Change page size | | | ● | | | | | ● |
| Bookmark / outline editor | | | ● | | | | | ● |
| Compress PDF | ● | ● | ● | ● | ● | ● | ● | ● |
| Web-optimize PDF | | | ● | | | | | ● |
| Repair PDF | | ● | ● | | | | | ● |
| Rasterize PDF | | | ● | | | | | ● |
| Flatten PDF (forms/annotations) | | | ● | | | ● | | ● |
| PDF → PDF/A | ● | ● | ● | | | ● | | ● |
| Change document info / metadata | | | ● | | | | | ● |
| Remove metadata | | | ● | | | | | ● |
| Office → PDF (Word/Excel/PPT + legacy doc/xls/ppt) | ● | ● | ● | ● | ● | ● | ● | ● |
| PDF → Office (Word/Excel/PPT) | ● | ● | ● | ● | ● | ● | ● | ● |
| PDF → CSV / bank statement → Excel | | | | | ● | | | ● |
| Image ↔ PDF (JPG/PNG/BMP/GIF/TIFF/WEBP/HEIC/SVG/PSD/AI/INDD) | ● | ● | ● | ● | ● | ● | ● | ● |
| Text/RTF/Markdown/HTML/EPUB/ODF/HWP/CSV/ZIP/Publisher ↔ PDF | ● | ● | ● | | ● | ● | | ● |
| Webpage (URL) → PDF | | ● | ● | | | | | ● (Relay) |
| Create PDF from camera | | ● | ● | | | | | ◐ |
| QR code generation | | | ● | | | | | ● |
| Invoice / e-invoice creation & XML e-invoicing | | | ● | | | | | ● |
| Fillable PDF form creation & detection | | ● | ● | | | | | ● |
| Fill out PDF forms | | ● | ● | | ● | | ● | ● |
| Edit text/images/shapes on a PDF | ● | ● | ● | ● | ● | ● | ● | ● |
| Annotate (draw/highlight/erase/comment) | ● | | ● | | ● | ● | ● | ● |
| Add headers & footers | | | | | | ● | | ● |
| Add page numbers | ● | ● | ● | | ● | ● | ● | ● |
| Bates numbering | | | | | ● | | | ● |
| Watermark (text/image) | ● | ● | ● | | | ● | | ● |
| PDF Overlay (stamp one PDF onto another) | | | ● | | | | | ● |
| Sign PDF (draw/type/upload signature) | | ● | ● | | ● | | ● | ● |
| Request e-signature from others | | | | | ● | | ● | ◐ |
| Remove signature background | | | | | ● | | | ● |
| Protect PDF (add password/permissions) | | ● | ● | | ● | | ● | ● |
| Unlock PDF (remove password) | | ● | ● | | ● | | | ● |
| Generate secure password | | | ● | | | | | ● |
| Redact PDF (permanent) | ● | ● | ● | | | | | ● |
| OCR (searchable text layer) | ● | ● | ● | | | | ● | ● |
| Compare two PDFs | | ● | ● | | ● | | | ● |
| View PDF / PDF reader | ● | | ● | | | ● | | ● |
| Extract embedded images | | | ● | | | | | ● |
| Scan to PDF (mobile capture) | | ● | | | | | | ◐ |
| Multiple-choice / quiz / test generator | ● | | | | | | ● | AI |
| AI Summarizer / "Chat with PDF" | | ● | | | ● | | ● | AI |
| Translate PDF (layout-preserving) | | ● | | | | | | AI |
| PDF → Markdown | ● | ● | | | | | | ◐ |
| Generate a PDF from a text prompt | | | | | ● | | | AI |
| Flashcard maker / mind map / presentation generator | | | | | | | ● | AI |
| Alt-text / accessibility tagging draft | | | | | | | | ◐ |
| Batch processing | ○ | ○ | ○ | | | | ○ | ● |
| Public API | ● | ● | ● | | | | ● | ● (npm + CLI) |
| Works offline | | | | | | | | ● |
| No file-size cap, no daily cap | | | | | | | | ● |

### 3.3 Intersections resolved

- **"Edit PDF" means three different things** across competitors: pdf.net edits *text runs in place*,
  iLovePDF/PDF24 add *annotation-layer objects* (text boxes, shapes, images) on top of the page, and
  Adobe adds *comments*. We ship all three as one **Editor** host (T30) with a mode switch: **Direct
  text edit** (re-flows the existing text run, only where the font is embedded and subsettable),
  **Annotate/overlay** (adds new objects, always available, never touches original content), and
  **Comment** (sticky notes, highlights — never alters page content).
- **"Compress" vs "Optimize for web" vs "Repair".** PDF24 treats these as three tools; we keep them as
  three distinct routes because their *goals* differ (smaller file vs. fast-first-byte-for-web vs.
  fixing corruption) even though they share one engine primitive: object-stream rewrite +
  image re-encode + font subsetting.
- **AI naming.** "AI Summarizer" (iLovePDF), "PDF Summarizer"/"Chat with PDF"/"Generate PDF" (pdf.net),
  and Adobe's "Chat with PDF"/"Flashcard maker"/"Quiz maker"/"Mind map"/"Generate Presentation" are the
  same underlying capability — an LLM call over extracted document text — wearing different UI skins.
  We ship **one BYOK AI panel** (§13) with five prompt presets (Summarize, Quiz me, Flashcards, Mind
  map, Chat) plus a free-form prompt box, all sharing one adapter layer, rather than five separate
  "AI tools".
- **Signature: drawn vs. requested.** "Sign PDF" (self-sign) is fully local — canvas-drawn or
  image-uploaded signature composited onto the page, no server. "Request e-signature from others"
  (pdf.net, Adobe) inherently requires a third party to receive and act on a request; we support this
  only as a **BYOK integration** (the user's own e-mail/webhook or a signing-API key) — never a
  service we operate — and label it clearly as requiring the user's own delivery channel.
- **Webpage → PDF** cannot be done in-browser: a page loaded via `<iframe>` cannot be captured due to
  cross-origin canvas tainting, and `fetch()` of an arbitrary URL is blocked by CORS almost everywhere.
  We solve this with the optional, user-run **Relay** (§15) — never a hosted service we operate.

---

## 4. Complete tool catalog

72 tools, each a dedicated route, a prerendered landing page, and a thin preset over the shared engine.

**Mode column:**
- `Local` — runs entirely on-device. No key, no network, works offline after initial loading. **61 tools.**
- `Local ⇗AI` — fully functional locally; an optional, explicit Tier-3 escalation exists for one
  documented hard case. **5 tools:** T29, T44, T52, T59, T61.
- `BYOK / Relay` — local preparation with an explicitly configured external delivery/capture channel.
  **2 tools:** T36, T55.
- `AI` — Tier 3 only; justified in the register (§13.1.3). **4 tools:** T65–T68.

### 4.1 Organize pages

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T01 | Merge PDF | `/merge` | Local | Any order, drag-to-reorder, per-file page-range selection, bookmark-preserving or flattened outline merge; accepts supported office/image inputs through explicit conversion and can emit one PDF or a ZIP of outputs |
| T02 | Split PDF | `/split` | Local | By page ranges, fixed page count, bookmark/outline level, or maximum output size; supports one-file-per-page/range and ZIP download |
| T03 | Extract Pages | `/extract-pages` | Local | Selected pages, ranges, or sections → one combined PDF or separate files; preview before export and keep or drop bookmarks/links |
| T04 | Remove / Delete Pages | `/remove-pages` | Local | Range, pattern (`odd`, `even`, `blank`), or multi-file selection; exports a new PDF and never mutates the source |
| T05 | Insert Pages | `/insert-pages` | Local | Insert another PDF or blank pages at any index |
| T06 | Reorder / Organize Pages | `/organize` | Local | Visual thumbnail grid, drag-drop, multi-select |
| T07 | Rotate Pages | `/rotate-pdf` | Local | Per-page, selected pages, whole PDF, or batch; 90° steps; auto-rotate from content orientation where supported |
| T08 | Pages Per Sheet (N-up) | `/pages-per-sheet` | Local | 2/4/6/9-up, margin, order (booklet-aware) |
| T09 | Halve PDF Pages | `/halve-pages` | Local | Splits each oversized page (e.g. A3) into two |
| T10 | Crop / Trim PDF | `/crop-pdf` | Local | Visual handles + numeric margins; per-page or uniform |
| T11 | Change Page Size | `/resize-pdf-pages` | Local | Standard sizes + custom; scale-to-fit or crop-to-fit |
| T12 | Bookmark Editor | `/bookmarks` | Local | Add/edit/remove outline entries, nesting, page targets |
| T13 | Bates Numbering | `/bates-numbering` | Local | Prefix/suffix, zero-padding, starting number, position |

### 4.2 Optimize & repair

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T14 | Compress PDF | `/compress-pdf` | Local | 3-level presets (extreme/balanced/high-quality) + custom image-quality slider; live predicted size |
| T15 | Web-Optimize PDF | `/optimize-for-web` | Local | Linearize ("fast web view"), progressive image encode, font subsetting |
| T16 | Repair PDF | `/repair-pdf` | Local | Rebuild xref/object streams; recover pages from truncated/corrupt files |
| T17 | Rasterize PDF | `/rasterize-pdf` | Local | Flatten every page to an image (anti-copy, anti-edit output), DPI selectable |
| T18 | Flatten PDF | `/flatten-pdf` | Local | Bakes form fields and/or annotations into page content |
| T19 | PDF → PDF/A | `/pdf-to-pdfa` | Local | PDF/A-1b, 2b, 3b; font-embed + colour-profile-embed validation with a pass/fail report |

### 4.3 Convert — office & text ↔ PDF

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T20 | Word ↔ PDF | `/word-pdf` | Local | DOC/DOCX both directions; layout-preserving reconstruction (columns, tables, headers/footers, footnotes) with honest best-effort reporting for legacy `.doc` |
| T21 | Excel ↔ PDF | `/excel-pdf` | Local | XLS/XLSX both directions; per-sheet page range, fit-to-width |
| T22 | PowerPoint ↔ PDF | `/ppt-pdf` | Local | PPT/PPTX both directions; one slide per page or notes layout |
| T23 | Text / RTF / Markdown ↔ PDF | `/text-pdf` | Local | TXT, RTF, and Markdown (tables, code blocks, headings, lists) both directions; preserves a text-only fallback when layout cannot round-trip |
| T24 | HTML ↔ PDF | `/html-pdf` | Local† | Pasted HTML/CSS and local files are local; a live URL needs the Relay (§15), with preview, orientation, and margin controls |
| T25 | ODF Suite ↔ PDF | `/odf-pdf` | Local | ODT/ODS/ODP both directions |
| T26 | EPUB ↔ PDF | `/epub-pdf` | Local | Reflowable ↔ fixed-layout, TOC-aware |
| T27 | CSV ↔ PDF | `/csv-pdf` | Local | Table rendering with column-width heuristics; PDF table → CSV extraction |
| T28 | PDF → Bank-Statement Excel | `/bank-statement-to-excel` | Local | Table-structure heuristics (ruled + ruleless) tuned for statement layouts; per-column type inference |
| T29 | PDF → Markdown | `/pdf-to-markdown` | Local ⇗AI | **Tier 0–1:** heading/list/table/code-block structure inferred from font size, indentation, and ruled lines. **Tier 3 (optional):** LLM re-structuring for documents with no reliable visual structure (scanned prose, inconsistent styling) |
| T30a | ZIP / CBZ / Publisher / HWP → PDF | `/other-formats-to-pdf` | Local | Legacy/niche format coverage parity with PDF24/Smallpdf |

### 4.4 Convert — images ↔ PDF

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T31 | Image → PDF | `/image-to-pdf` | Local | JPG/PNG/BMP/GIF/TIFF/WEBP/HEIC/SVG; page size, portrait/landscape, margins/no margins, quality, one-per-page or contact sheet; animated GIF input is represented as page content |
| T32 | PDF → Image | `/pdf-to-image` | Local | One page or the entire document as JPG/PNG/BMP/GIF/TIFF/SVG/general image output, DPI selectable, individual downloads or ZIP; separate original-image extraction is T34 |
| T33 | PSD / AI / INDD → PDF | `/design-file-to-pdf` | Local | Flattened-composite extraction from layered design-file containers (no re-layout) |
| T34 | Extract Embedded Images | `/extract-images` | Local | Pulls original-resolution raster objects straight from page content streams |

### 4.5 Create

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T35 | Blank / Templated PDF Creator | `/create-pdf` | Local | Create from supplied content/files or a blank page; page size/orientation presets, grid/lined/dot templates, and reusable local templates |
| T36 | Webpage (URL) → PDF | `/webpage-to-pdf` | Local (Relay) | Requires the user-run Relay (§15); never a hosted capture service |
| T37 | QR Code Generator | `/qr-code` | Local | Encodes URL/text/vCard; export as PDF, PNG, or SVG |
| T38 | Invoice Creator | `/invoice-creator` | Local | Visual builder + line items, tax, totals, customer/vendor fields, and saved templates in IndexedDB |
| T39 | Electronic Invoice (e-invoice) | `/e-invoice` | Local | Create PDF invoices, convert PDF invoices to structured XML, and convert XML e-invoices to PDF; UBL/ZUGFeRD-style embedding per §5.6 |
| T40 | Scan to PDF | `/scan-to-pdf` | Local | Camera capture via `getUserMedia`, perspective deskew, multi-page assembly |
| T41 | Job-Application / Form-Pack Builder | `/document-pack-builder` | Local | Merge a cover letter + resume + attachments into one ordered PDF with a generated table of contents |

### 4.6 Edit & annotate

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T42 | PDF Editor (host) | `/editor` | Local (host) | Direct text-run edit (embedded/subsettable fonts only) plus add/move/resize/rotate/delete text, images, logos, and shapes; issues no request of its own |
| T43 | Annotator | `/annotate` | Local | Highlight, underline, strikeout, freehand draw, erase, sticky note, shapes, arrows, callouts, selectable colors, and line widths |
| T44 | Fill Out Form | `/fill-form` | Local ⇗AI | AcroForm + XFA-lite field detection and filling. **Escalation:** OCR-based field-guessing on flat/scanned forms with no field structure |
| T45 | Create Fillable Form | `/create-form` | Local | Text field, checkbox, radio group, dropdown, date, signature field placement + validation rules |
| T46 | Add Text | `/add-text` | Local | Free text boxes, font/size/colour, alignment guides |
| T47 | Add Image / Logo | `/add-image` | Local | Position, scale, opacity, per-page or all-pages |
| T48 | Headers & Footers | `/headers-footers` | Local | Text/date/page-number tokens, per-section rules |
| T49 | Page Numbers | `/page-numbers` | Local | Position, format (`1`, `Page 1 of N`, roman), start value, skip-first-N-pages |
| T50 | Watermark | `/watermark-pdf` | Local | Text or image; opacity, rotation, tiling, page-range scope |
| T51 | PDF Overlay / Stamp | `/pdf-overlay` | Local | Composite one PDF's pages onto another's as a stamp layer (e.g. letterhead) |
| T52 | Alt-Text & Tagging Assistant | `/pdf-accessibility` | Local ⇗AI | Structure-tag audit (heading order, reading order, untagged images) drafted locally; optional AI-authored alt-text descriptions per flagged image |

### 4.7 Sign & protect

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T53 | Sign PDF | `/sign-pdf` | Local | Draw, type, or upload signature/initials; place, resize, date-stamp, and sign supported office documents, spreadsheets, and images through local conversion |
| T54 | Remove Signature Background | `/remove-signature-background` | Local | Threshold + flood-fill background removal on an uploaded signature photo → transparent PNG |
| T55 | Request Signature (BYOK) | `/request-signature` | BYOK | Prepares a package for multiple recipients, signature fields, progress tracking, and delivery through the user's own e-mail/signing API; we operate no signing backend |
| T56 | Protect PDF (password/permissions) | `/protect-pdf` | Local | Owner + user password, AES-256/128 or RC4-compat, permission flags (print/copy/edit/annotate) |
| T57 | Unlock PDF | `/unlock-pdf` | Local | Removes a **known** user password only; never brute-forces or cracks unknown passwords |
| T58 | Generate Secure Password | `/password-generator` | Local | Length/charset controls, entropy readout |
| T59 | Redact PDF | `/redact-pdf` | Local ⇗AI | Manual box/text redaction with content-stream removal (not overlay). **Escalation:** pattern-assisted flagging of likely PII (SSN/email/phone regexes — deterministic, not AI) is Tier 0; a true AI PII-classifier pass is the optional Tier-3 upgrade for messy scans |

### 4.8 View, compare, analyze

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T60 | PDF Reader / Viewer | `/view-pdf` | Local | Continuous/single-page, zoom, search, outline navigation, print, and explicit share/export actions |
| T61 | Compare PDFs | `/compare-pdf` | Local ⇗AI | Side-by-side or overlay comparison with added/removed/replaced-line text diff and visual pixel-diff. **Escalation:** semantic ("meaning-level") change summary via AI is optional |
| T62 | Document Info / Metadata Editor | `/pdf-metadata` | Local | Title/author/subject/keywords/dates/custom XMP; strip-all preset |
| T63 | OCR (searchable text layer) | `/ocr-pdf` | Local | Tesseract.js in a worker; per-language model, output as invisible text layer over the original page image |
| T64 | Bookmark/Structure Inspector | `/pdf-inspector` | Local | Page count, size, PDF version, encryption state, font list + embedding status, tag tree, object count |

### 4.9 AI-assisted document intelligence (BYOK)

Four tools genuinely require an external language model — open-ended reasoning over document meaning
that no deterministic algorithm can produce. Each is justified in §13.1.3, clearly labelled, and costed
before it runs. Three provide a useful local fallback without a key; T67 instead reports plainly that no
local translation path is available.

| # | Tool | Route | Capability | Why no local path exists | Without a key |
| --- | --- | --- | --- | --- | --- |
| T65 | Chat with PDF | `/ai/chat-with-pdf` | `chat` | Open-ended Q&A over document meaning, with follow-up questions over extracted PDF, Word, Excel, PowerPoint, and image content | Full-text search + section jump-to is offered instead |
| T66 | AI Summarizer / Quiz / Flashcards / Mind Map | `/ai/summarize` | `summarize`, `generate` | Key takeaways, chapter-style notes, concise summaries, multiple-choice/true-false/open questions, flashcards, mind maps, and presentations require language understanding | A local extractive summary (top-ranked sentences by TF-IDF position/heading weight) is produced instead |
| T67 | Translate PDF (layout-preserving) | `/ai/translate` | `translate` | Summary or full translation in 20+ target languages where the configured provider supports it; layout re-flow needs judgement about line-length changes | No local fallback — page is left untranslated with a clear message |
| T68 | Generate PDF from Prompt | `/ai/generate-pdf` | `generate` | Generate an invoice, resume, NDA, survey, job-application document, or other formatted PDF from a prompt, optional source files, and a template | T35/T38 (template + invoice builders) cover structured, non-generative document creation |

### 4.10 Batch & developer

| # | Tool | Route | Mode | Notes |
| --- | --- | --- | --- | --- |
| T69 | Batch Runner | `/batch` | Local (host) | Drop N supported documents, apply a recipe, download individual results or a ZIP; per-file status, retry-failed-only, partial download |
| T70 | Recipe Builder | `/recipe` | Local (host) | Visual pipeline editor; save to IndexedDB, export JSON, share via URL fragment |
| T71 | Folder Watcher | `/watch` | Local | File System Access API — auto-process new files dropped into a picked folder |
| T72 | CLI & Library | `packages/cli`, `packages/engine` | Local | Same engine, npm-published; a recipe JSON runs identically in Node and the browser |

### 4.11 Cross-cutting capability requirements

The following requirements come from the normalized capability reference in `comprehensive.md`. They
are intentionally cross-cutting rather than extra routes: the same primitives must be available from
the relevant tool pages, batch runner, recipe builder, and CLI.

**Create, capture, and business documents.** A user can create a PDF from supplied content or files,
capture paper pages with a camera, combine images into a PDF, create a job-application pack, generate a
QR code, build an invoice visually, create an e-invoice, convert an XML e-invoice to PDF, and turn a
bank statement into structured Excel or CSV. Scanned statements must be able to pass through OCR before
table extraction. Prompt-generated documents may use source attachments and templates, but the UI must
label generated content as requiring human review; legal-document generation is not legal advice.

**Conversion breadth.** The conversion registry covers Word, Excel, PowerPoint, RTF, plain text,
Markdown, HTML, ODF, EPUB, CSV, Publisher, HWP, ZIP/CBZ, JPG/JPEG, PNG, WEBP, BMP, GIF, TIFF,
HEIC/HEIF, SVG, PSD, AI, and INDD wherever §5 marks a direction as supported. PDF can become editable
Word, PowerPoint, Excel, ODT, ODS, ODP, RTF, TXT, HTML, Markdown, EPUB, or CSV, or can yield OCR text
and embedded original images. A conversion that cannot preserve layout or a legacy format must report
the exact limitation instead of silently dropping content.

**Assembly and output semantics.** Merge, split, extract, and delete flows support thumbnail preview,
page/range/section selection, multi-file input, and repeated batches. Where applicable, a result can be
one combined file, one file per page or selection, a ZIP package, an editable office document, a set of
rendered page images, or a set of original embedded images. These are different output contracts: T32
renders pages, T34 extracts embedded originals, and neither may be substituted silently for the other.

**Page appearance and document control.** Page operations retain single-page and whole-document scope,
drag-and-drop ordering, page-size and crop controls, N-up/halve layouts, headers/footers, page-number
tokens, watermarks, overlays, bookmarks, viewer preferences, metadata editing/removal, flattening,
rasterization, web optimization, repair, OCR, PDF/A conversion, password protection, known-password
unlocking, permanent redaction, local signing, signature-background removal, and explicit share/export
actions.

**Acquisition and handling.** Every upload surface supports file picker and drag-and-drop; multi-file
surfaces support Ctrl/Shift selection, adding/removing files after selection, reordering, and preview
before destructive operations. Results support one-at-a-time download, multiple individual downloads,
and ZIP download. Any future cloud-drive connector must be an explicit user-mediated integration and
must not weaken the local-first or no-project-server trust boundary.

**Availability and trust.** Local browser paths work on desktop, tablet, and mobile where the browser
API exists, and the non-AI toolkit remains usable offline after its assets load. BYOK AI and Relay flows
are visibly separate from local processing. Third-party products may advertise temporary uploads,
automatic deletion, TLS, GDPR, ISO controls, or no-model-training claims; those observations explain
the competitive landscape but are not claims made by this product and can change over time.

---

## 5. Format & standard support matrix

`D` = decode/read · `E` = encode/write · `—` = not supported.

### 5.1 Document container

| Format | D | E | Notes |
| --- | :-: | :-: | --- |
| PDF (1.0–2.0) | ● | ● | Object streams, cross-reference streams, linearized, encrypted (RC4/AES-128/AES-256) |
| PDF/A (1b, 2b, 3b) | ● | ● | Conformance validated on export with a pass/fail report, not just claimed |
| PDF/X (print) | ● | — | Read-only recognition; production not in v1 (⚠ VERIFY demand before building) |
| AcroForm / XFA (legacy) | ● | ● | XFA is read/flatten only — no XFA authoring |

### 5.2 Office formats

| Format | → PDF | PDF → | Notes |
| --- | :-: | :-: | --- |
| DOCX / DOC | ● | ● | DOC via a binary-format reader (legacy, best-effort) |
| XLSX / XLS | ● | ● | Formula results only, not formulas, unless `preserveFormulas` |
| PPTX / PPT | ● | ● | |
| RTF | ● | ● | |
| ODT / ODS / ODP / ODG | ● | ● | |
| Publisher (PUB) | ● | — | Read best-effort; no PUB authoring |
| HWP (Hangul Word Processor) | ● | — | Read best-effort |

### 5.3 Text & markup

| Format | → PDF | PDF → | Notes |
| --- | :-: | :-: | --- |
| Plain text (TXT) | ● | ● | |
| Markdown (CommonMark + tables/GFM) | ● | ● | Round-trips headings, lists, tables, code blocks |
| HTML / CSS (pasted or file) | ● | ● | Live-URL capture needs the Relay (§15) |
| EPUB | ● | ● | |
| CSV | ● | ● | |
| XML e-invoice (UBL/ZUGFeRD-style) | ● | ● | Embedded as a compliant attachment, not just appended text |

### 5.4 Raster & vector images

| Format | → PDF | PDF → | Notes |
| --- | :-: | :-: | --- |
| JPG/JPEG | ● | ● | |
| PNG | ● | ● | Alpha handled: composited over a user-chosen background on PDF write |
| BMP | ● | ● | |
| GIF | ● | ● | First frame only into PDF; animation is not meaningful in a page |
| TIFF (incl. multi-page) | ● | ● | Multi-page TIFF ↔ multi-page PDF |
| WEBP | ● | ● | |
| HEIC/HEIF | ● | — | Decode via platform decoder only, same rationale as image.complianttools.com §25.3.2 |
| SVG | ● | ● | Vector-preserving PDF write where possible, not rasterized |
| PSD / AI / INDD | ● | — | Flattened composite only; no layer-aware re-export |

### 5.5 Archives & containers

| Format | → PDF | PDF → | Notes |
| --- | :-: | :-: | --- |
| ZIP (of pages/images) | ● | ● | |
| CBZ/CBR (comic archive) | ● | ● | |

### 5.6 Signature & security standards

| Standard | Support | Notes |
| --- | :-: | --- |
| PDF standard security handler (RC4 40/128, AES-128, AES-256) | Full | Both encrypt (protect) and decrypt-with-known-password (unlock) |
| Certificate-based digital signature (PKCS#7 / CAdES) | Read + verify | **Signing** with a real cert requires the user's own PKCS#12 file or a BYOK signing API; we never generate or hold a certificate |
| Visible signature appearance | Full | Local, canvas/image-based, not cryptographic on its own |
| PDF/UA (accessibility tagging) | Read + audit | Full authoring assistance in T52; full automated remediation is not claimed |

---

## 6. Exhaustive option reference

Representative option surfaces for the highest-traffic tools; every tool has an equivalent
schema-validated options object (§10.2).

### 6.1 Merge (T01)
`fileOrder[]`, `pageRangePerFile`, `preserveBookmarks` (bool, default true), `bookmarkStrategy`
(`per-file-top-level` | `flatten` | `none`), `insertBlankBetween` (bool).

### 6.2 Compress (T14)
`preset` (`extreme` | `balanced` | `high-quality` | `custom`), `imageQuality` (1–100), `imageDpiCap`
(72–600 or `off`), `subsetFonts` (bool, default true), `removeUnusedObjects` (bool, default true),
`stripMetadata` (bool, default false), `linearize` (bool, default false).

### 6.3 Convert — Word ↔ PDF (T20)
Word→PDF: `pageSize`, `margin`, `embedFonts` (default true), `preserveComments`, `preserveTrackChanges`
(`show` | `accept` | `reject`). PDF→Word: `preserveLayout` (`flowing` | `fixed-layout-boxes`),
`ocrIfScanned` (bool, defers to T63), `extractImages` (bool).

### 6.4 Protect / Unlock (T56/T57)
`userPassword`, `ownerPassword`, `encryptionAlgorithm` (`AES-256` | `AES-128` | `RC4-128` legacy-compat),
`permissions` (`print`, `printHighRes`, `modify`, `copy`, `annotate`, `fillForms`,
`extractForAccessibility`, `assemble`).

### 6.5 Watermark (T50)
`content` (`text` | `image`), `text`, `font`, `fontSize`, `color`, `opacity` (0–1), `rotation` (°),
`position` (3×3 grid + custom), `tiled` (bool), `pageRange`, `behindContent` (bool).

### 6.6 Redact (T59)
`method` (`manual-box` | `text-search-match`), `searchPattern` (plain or regex), `presetPattern`
(`ssn` | `email` | `phone` | `credit-card`), `redactionColor`, `removeMetadataOnRedact` (bool, default
true — a redacted document that still carries the redacted text in XMP/metadata is not redacted).

### 6.7 OCR (T63)
`language[]` (multi-select from the pinned Tesseract model list), `outputMode`
(`invisible-text-layer` | `searchable-pdf` | `plain-text-export`), `dpi`, `deskew` (bool),
`pageRange`.

### 6.8 PDF/A conversion (T19)
`conformanceLevel` (`1b` | `2b` | `3b`), `colorProfile` (embed sRGB | preserve existing),
`fallbackOnFailure` (`report-only` | `best-effort-fix`), always produces a **conformance report**
listing every check performed and its result — never a silent pass/fail badge.

---

## 7. Technology decisions

### 7.1 Framework
SvelteKit, static adapter, prerendering every indexable route — identical rationale to
`image.complianttools.com` §7.1: smallest hydration cost, best fit for hundreds of near-identical
generated landing pages, first-class Web Worker ergonomics.

### 7.2 PDF engine core — the central decision

| Candidate | Licence | Verdict |
| --- | --- | --- |
| **MuPDF (mupdf.js / mupdf-wasm)** | **AGPL-3.0** (commercial licence available) | **Excluded from the default build.** AGPL's network-use clause is incompatible with P13 for a product we distribute freely; a commercial licence is a business decision outside this spec (⚠ VERIFY if the business chooses to purchase one — a separate build target, never the default). |
| **Ghostscript** | **AGPL-3.0** | **Excluded**, same reasoning. |
| **LibreOffice headless (server-side conversion)** | GPL-2.0/LGPL-3.0 for the app; **also requires a server**, violating P1/P2 | **Excluded.** |
| **pdf.js (Mozilla)** | **Apache-2.0** | **Adopted** for rendering, text extraction, and structure inspection (read paths). |
| **pdfium (via `pdfium-wasm` / `@embedpdf` builds)** | **BSD-3-Clause / Apache-2.0** (Google-maintained fork of Foxit's engine, relicensed permissively) | **Adopted** for high-fidelity rasterization (PDF→image) and as a cross-check renderer. ⚠ VERIFY the exact licence text of the specific pinned WASM build before vendoring — pdfium itself is BSD-3, but wrapper projects vary. |
| **pdf-lib** | **MIT** | **Adopted** for PDF *writing/mutation* — merge, split, page ops, forms, encryption, watermark, page numbers. Actively-maintained fork (`pdf-lib` successor, e.g. `@cantoo/pdf-lib`) pinned; ⚠ VERIFY current maintenance status at implementation time. |
| **jsPDF** | MIT | **Adopted** for programmatic PDF *creation* (invoices, QR, blank templates) where pdf-lib's lower-level API is more code than needed. |
| **pdf-parse / custom** | MIT | Text-extraction convenience layer over pdf.js. |

**Net effect:** zero copyleft in the default build. Every capability MuPDF/Ghostscript would have
provided is covered by pdf.js (read) + pdfium (rasterize) + pdf-lib (write) + our own code for the gap
between them (§7.5).

### 7.3 Office format libraries

| Format | Library | Licence |
| --- | --- | --- |
| DOCX write | `docx` | MIT |
| DOCX/DOC read | `mammoth` (DOCX→HTML/structure) + **our own** legacy `.doc` (OLE2/CFB) binary reader | MIT + ours |
| XLSX read/write | `exceljs` | MIT |
| PPTX write | `pptxgenjs` | MIT |
| PPTX read | **our own** OOXML slide-XML reader (it's a ZIP of XML — no external parser needed beyond a zip lib) | ours |
| ODF suite | `jszip` (MIT) + **our own** ODF-XML reader/writer | ours |
| ZIP handling (CBZ, ODF, OOXML, e-invoice bundles) | `fflate` | MIT |

### 7.4 OCR

Tesseract.js (Apache-2.0), same model-hosting discipline as `image.complianttools.com` §14 (T62):
models fetched from a pinned CDN or self-hosted mirror, SHA-256 verified, disclosed size before
download, never bundled by default to keep the base app small.

### 7.5 The "our own" layer

Where no clean-licence library exists, or the gap between pdf.js/pdfium/pdf-lib leaves a hole, we
build it, exactly as `image.complianttools.com` built its own simple-image-codec framework (§25.4
there). Candidates identified so far: **legacy `.doc`/`.xls`/`.ppt` binary readers** (OLE2 Compound
File format is publicly documented by Microsoft's Open Specifications program), **bank-statement table
heuristics** (T28), **PDF/A conformance checker** (a rules engine over the parsed object graph, not a
model), **N-up/booklet page-imposition math** (T08/T09), **Bates numbering and page-number token
rendering** (T13/T49).

### 7.6 Ten rules for every prerendered page

Identical to `image.complianttools.com` §7.6: static H1/description/FAQ, real `<input type="file">`
in served HTML, drag/paste layered on at hydration, zero-JS reference-page archetype where content
alone answers the query, engine core as a shared long-cached chunk, per-route `size-limit` budget.

---

## 8. Architecture

### 8.1 Shape

```
apps/web        SvelteKit app — every /route from §4
apps/relay       Optional, self-hostable Node service for webpage→PDF capture only (§15)
packages/engine  Pure TS + WASM. No DOM. compile() / run() / preview() over a Recipe (§10)
packages/ui      Design-system components (§12), generated option controls (§10.2/§11.7)
packages/cli     Node CLI wrapping packages/engine
```

### 8.2 The pipeline model
A **Recipe** is an ordered list of **Steps**, each a `{op, options}` pair validated against a Zod
schema. `compile(recipe, inputMeta) → Plan` decides tiering (local WASM vs. optional AI step),
projects peak memory, and orders operations to minimize intermediate re-serialization (e.g. do all
page-tree mutations before the final single re-save, rather than re-parsing between every step).

### 8.3 Why PDF mutation is harder than image mutation
Unlike raster pixels, a PDF page references shared resources (fonts, images, page trees) by indirect
object reference. Two ops in the same recipe (e.g. "delete page 3" then "add page numbers") must
operate against a **consistent, single in-memory document graph**, not a fresh reparse per step. The
engine holds one `PDFDocument` handle per pipeline run and mutates it in place, materializing bytes
only once, at the end — this is the direct analogue of `image.complianttools.com`'s "step fusion"
(§8.2 there), adapted to a graph structure instead of a pixel buffer.

### 8.4 Worker model
Parsing, rendering, OCR, and re-serialization all run in module workers; the main thread only ever
holds thumbnails/small previews and the UI state. Large document buffers are transferred, never
copied, and never retained on the main thread.

### 8.5 Preview architecture
A **proxy document** (first N pages, or the current visible page only, rendered at screen resolution
via pdfium) drives the live preview; the full multi-hundred-page document is only fully processed on
export. A property test asserts the proxy preview is not misleading: the exported page, downscaled,
must match the proxy preview within tolerance — "the preview must not lie" (P8).

---

## 9. Repository layout

```
/
├── apps/
│   ├── web/                # SvelteKit app, one route per tool (§4)
│   └── relay/               # optional webpage-capture relay (§15)
├── packages/
│   ├── engine/
│   │   ├── src/pdf/          # parse, mutate, render adapters over pdf.js/pdfium/pdf-lib
│   │   ├── src/office/       # docx/xlsx/pptx/odf readers+writers
│   │   ├── src/text/         # markdown/html/rtf/txt/csv/epub
│   │   ├── src/ocr/          # tesseract.js worker wrapper
│   │   ├── src/ai/           # provider adapters, transport, BYOK (§13-14)
│   │   ├── src/security/     # encrypt/decrypt, redaction, signature verify
│   │   └── bench/            # escalation & accuracy measurement harnesses
│   ├── ui/
│   ├── cli/
│   └── extension/            # optional browser-extension "PDF this page" integration
├── docs/
│   ├── ADR/ip-clearance.md
│   └── THIRD-PARTY-LICENSES.md
├── scripts/                 # verify-licenses.ts, verify-assets.ts, fetch-wasm.ts, plan-progress.mjs
├── comprehensive.md         # normalized capability reference used to build §3–§5
├── design.md                # visual system and responsive implementation reference
├── saas-template/           # saved HTML/MHTML template pages and physical design assets
├── README.md
└── PLAN.md
```

---

## 10. The engine API

```ts
type Recipe = { version: 'r1'; steps: Step[] };
type Step<Op extends OpId = OpId> = { op: Op; options: OptionsFor<Op> };

function compile(recipe: Recipe, inputMeta: DocMeta): Plan;
function run(plan: Plan, inputs: Blob[], opts: RunOpts): AsyncIterable<Progress | Result>;
function preview(recipe: Recipe, proxy: PdfProxy, opts: PreviewOpts): Promise<PreviewFrame>;

type EngineError =
  | { kind: 'encrypted-unknown-password'; remedy: string }
  | { kind: 'corrupt-structure'; remedy: string; repairable: boolean }
  | { kind: 'unsupported-feature'; feature: string; remedy: string }
  | { kind: 'font-not-embedded-cannot-edit-text'; remedy: string }
  | { kind: 'target-size-unreachable'; achieved: number; remedy: string }
  | { kind: 'ai-provider-unreachable'; providerId: string; remedy: string };
// every variant carries `remedy`; enforced by a type-level test, per P8.
```

### 10.1 Core types
`PdfDocumentHandle`, `PageRef`, `FormFieldRef`, `Annotation`, `SecurityState`, `Recipe`, `Step`,
`ExportOptions` — mirroring `image.complianttools.com` §10.1's `RasterImage`/`Frame` but for a
document graph rather than a pixel buffer.

### 10.2 Options are generated, not hand-written
Every tool's option panel is generated from its Zod schema, exactly as
`image.complianttools.com` §10.2/§11.7 mandates — this is a hard carry-over rule, not a stylistic
suggestion, because it is what keeps 72 tools' UIs consistent and accessible without 72 bespoke forms.

---

## 11. UX specification

### 11.1 Universal tool page anatomy
Drop zone (accepts drag/paste/click/File-System-Access-API) → live thumbnail strip → generated option
panel (§10.2) → primary action → result panel with download / "process another" / "build a recipe from
this" affordances. Same anatomy on all 68 tool pages, so muscle memory transfers.

### 11.2 The page-thumbnail grid
Shared component across Organize (T06), Split (T02), Extract (T03), Delete (T04), Rotate (T07),
Bookmarks (T12) — virtualized for 1,000+ page documents, drag-reorder, multi-select with shift/ctrl,
keyboard-navigable (arrow keys + space to select).

### 11.3 Diff & compare view (T61)
Side-by-side scroll-synced pages with a text-diff sidebar (added/removed/moved lines) and a toggle to
overlay a pixel-difference heatmap rendered via pdfium.

### 11.4 Recipe builder (T70)
Visual node-chain identical in spirit to `image.complianttools.com` §11.4's Flow D: a plain-language
description of the pipeline renders before anything runs ("Merge 3 files → remove blank pages → add
page numbers → compress to balanced quality"), and any AI step is flagged so a shared recipe never
surprises the recipient with a cost.

### 11.5 Batch (T69)
Per-file status rows (queued/running/done/error), retry-failed-only, partial ZIP download mid-batch,
and a memory governor that reduces concurrency rather than crashing on very large document sets.

---

## 12. Design system

Design tokens, component library, and interaction rules are inherited verbatim from
`image.complianttools.com` §12 (light/dark tokens, zero-flash theme script, `prefers-reduced-motion`)
— the same team, the same product family, one design system for both. The local visual source of truth
is [`design.md`](design.md), with the physical saved references in [`saas-template/`](saas-template/)
(including `style-guide.mhtml`, `home-01.htm`, `home-01.html`, `home-02.mhtml`, and `home-03.mhtml`).
New PDF-specific primitives: **PageThumb**, **PageGrid**, **AnnotationLayer**, **SignaturePad**,
**FieldOverlay** (for form-filling), **DiffPane**.

---

## 13. Capability escalation and BYOK AI

### 13.1 Tier ladder (identical structure to `image.complianttools.com` §13.1)

- **Tier 0** — deterministic, instant, no model (page ops, merge/split, encryption, watermark, text
  extraction, extractive summary, regex-based PII flagging).
- **Tier 1** — classical algorithm, local, no model but non-trivial (table-structure heuristics for
  bank statements, PDF/A conformance rules engine, layout-preserving DOCX reconstruction).
- **Tier 2** — local learned model, on-device inference, no network (OCR via Tesseract.js is
  arguably Tier 1.5 — a trained model shipped as a static asset, run entirely locally; no BYOK key
  needed, so it does not count against the AI-tool total).
- **Tier 3** — external provider, BYOK, explicit user gesture required every time an AI panel is
  opened for the first time in a session.

### 13.1.3 AI Justification Register (excerpt — full register ships with the repo)

| Tool | Capability | Why Tier 0–2 cannot do this | Local fallback shown first |
| --- | --- | --- | --- |
| T65 Chat with PDF | open-ended Q&A | No fixed transform answers an arbitrary question | Full-text search + jump-to-section |
| T66 Summarize/Quiz/Flashcards/Mind map | abstractive generation | Requires language understanding, not extraction | Extractive summary (heading + TF-IDF ranked sentences) |
| T67 Translate PDF | machine translation | Learned-model task by definition | None — states "untranslated" plainly |
| T68 Generate PDF from prompt | novel content authoring | No algorithm invents prose from intent | Template/invoice builders (T35/T38) for structured, non-generative creation |
| T29 (escalation only) PDF→Markdown restructuring | inferring structure with no visual cues | Heuristics need *some* signal (font size, indentation); absent that, judgement is required | Best-effort heuristic Markdown, clearly marked "structure inferred, review recommended" |
| T44 (escalation only) Form-field guessing on flat scans | recognizing intended field boundaries with no AcroForm structure | OCR text + layout gives candidates; final judgement about "is this a checkbox" benefits from a model on messy scans | Manual field placement (T45's tool, reused) |
| T52 (escalation only) Alt-text authoring | describing image *content*, not just flagging its absence | No local model performs image captioning in this engine (parity with `image.complianttools.com` T71's same limitation) | A structural audit (missing tags, reading-order gaps) plus a manual-entry field |
| T59 (escalation only) PII classification on messy scans | context-dependent judgement beyond regex patterns | Regexes catch SSN/email/phone reliably; free-text PII ("my colleague Jane at Acme Corp") needs understanding | Regex + preset pattern flags (Tier 0), always run first |
| T61 (escalation only) Semantic diff summary | "what changed in meaning" vs. "what changed in text" | Text-diff is exact and local; meaning-level synthesis is generative | Text-diff + visual pixel-diff (Tier 0) |

### 13.2–13.6
Provider config UI, cost estimation shown before every AI call, per-call confirmation, and the
"never the default, never automatic" enforcement test are carried over unchanged from
`image.complianttools.com` §13.2–13.6, substituting "document text" for "image pixels" throughout.

---

## 14. Provider adapter specifications

Same adapter contract as `image.complianttools.com` §14: one `ProviderAdapter` interface
(`chat`, `summarize`, `translate`, `generate` capabilities), implementations for OpenAI-compatible,
Anthropic-compatible, and generic-HTTP-with-a-template providers, each declaring which capabilities it
supports and its expected request/response shape. ⚠ VERIFY exact request/response schemas against each
provider's live API docs at implementation time — do not hardcode assumed shapes.

---

## 15. The CORS problem and the Relay

Two operations cannot be done from a static browser page alone:

1. **Webpage (URL) → PDF (T36).** Rendering an arbitrary third-party URL requires fetching and
   executing its DOM, which a same-origin static app cannot do for a cross-origin page (no CORS
   header will ever be granted by an arbitrary site for this purpose).
2. **Request e-signature delivery (T55, optional).** Actually delivering a signing link by email
   requires an SMTP relay or a signing API — the browser cannot send email directly.

Both are solved the same way `image.complianttools.com` solves its analogous cases: an **optional,
self-hostable Relay** (`apps/relay`), a thin stateless Node service the user runs themselves (or a
public instance they explicitly opt into) that performs a headless-browser render (Playwright/Chromium)
or a signing-API call using **the user's own credentials**, and returns bytes. We do not operate a
Relay by default; the app that ships is fully functional without it, with those two features
plainly stating "requires the Relay" until one is configured (P8).

---

## 16. Key storage and security model

Identical model to `image.complianttools.com` §16: provider keys live in `IndexedDB`, never in
`localStorage` (no synchronous cross-tab leak surface), never logged, never included in a diagnostic
bundle (`credential-leak` test harness, §22.7), and never transmitted to any origin other than the
one the user configured. A PDF-specific addition: **the redaction verification pass (T59)** must prove
that redacted text does not survive in `/Contents` streams, `/StructTree`, or XMP metadata after
export — a redaction that leaves the text recoverable via "select all → copy" is a security bug, not a
cosmetic one, and is treated with the same severity as a credential leak.

---

## 17. "Connect your AI" teaching page

A dedicated `/connect-ai` route explaining BYOK in plain language, with provider-specific setup guides
(where to get a key, what it costs, how to set a spending cap on the provider's own dashboard),
carried over structurally from `image.complianttools.com` §17.

---

## 18. Persistence and state

Recipes and invoice/form templates persist to `IndexedDB`. Recipe sharing uses the same
deflate+base64url URL-fragment scheme as `image.complianttools.com` §18.2, with one addition: because
PDFs are frequently much larger than a shareable URL, the recipe (the *steps*) is always shareable via
URL; **the source document itself is never encoded into the link** — the recipient supplies their own
file when they open a shared recipe.

---

## 19. Performance budgets

| Interaction | Budget |
| --- | --- |
| Open a 20-page PDF, render first page | ≤ 800 ms |
| Option-panel change → live preview update | ≤ 150 ms |
| Merge 10 × 5-page PDFs | ≤ 1.5 s |
| Compress a 20 MB PDF (balanced preset) | ≤ 4 s |
| OCR one page (English) | ≤ 2 s |
| Page-thumbnail grid scroll, 500-page document | 60 fps, virtualized |

---

## 20. Accessibility

`axe` zero violations on every route; every tool keyboard-operable end to end, including the
page-thumbnail grid (arrow keys + space), the signature pad (an alternate type-to-sign path for users
who cannot draw), and the diff view (keyboard-navigable change list, not just a visual heatmap). T52
exists specifically to help *users of the tool* produce more accessible PDFs — the tool itself must be
a model of the standard it teaches.

---

## 21. Internationalization

All UI strings are i18n messages with translator comments, tested against `en-XA` (pseudo-locale,
catches hardcoded strings and layout overflow) and `ar` (RTL, catches directional bugs) — identical
policy to `image.complianttools.com` §21. OCR language selection (T63) and translation target language
(T67) are separate, larger locale lists driven by the underlying model/provider capabilities, not the
UI locale list.

---

## 22. Testing strategy

Unit tests per op (happy path + every typed error), property tests (recipe round-trip, all-defaults
no-op, tiled/fused equivalence where applicable), an adversarial PDF corpus (truncated files, circular
object references, decompression bombs in embedded streams, PDFs claiming 0 or 1,000,000 pages,
malformed xref tables, PDFs with JavaScript actions — which must never execute), a `no-network`
Playwright harness proving zero requests during a full local pipeline, and a `credential-leak` harness
— same twelve-point Standard Tool Completion Checklist structure as
`image.complianttools.com` PLAN.md §0.4, applied per tool.

---

## 23. Build, CI, and deployment

Static hosting only (no server runtime in the deploy target for `apps/web`); `apps/relay` — if used —
deploys separately and is explicitly out of the P1–P7 default critical path. License gate
(`verify:licenses`), static-asset register gate (`verify:assets`), and a **PDF-specific trademark/legal
grep** (deny-list: any hardcoded reference to a specific e-signature vendor's proprietary flow,
"DocuSign"-style trademarked terms used as generic verbs, and any bundled full-text of a licensed
digital-certificate root program) all gate the build, mirroring
`image.complianttools.com` §23/§25.

---

## 24. SEO and growth

~680-equivalent prerendered landing pages is the wrong number for PDF (there are fewer permutations
than raster image formats, but higher per-query search volume); expect roughly 200–300 pages covering
every tool × every relevant format pair (e.g. `/word-to-pdf`, `/pdf-to-word`, `/excel-to-pdf` as
distinct pages even though they share one engine op), each meeting the same ten-rule static-page
contract as `image.complianttools.com` §7.6/§24.

---

## 25. Legal, privacy, and trust

### 25.1 The licence landscape is the central risk for this product specifically
Unlike the image-toolkit sibling project, the *dominant* open-source PDF rendering/editing engines
(MuPDF, Ghostscript) are AGPL, and the dominant *office-conversion* engine (LibreOffice headless) is
GPL/MPL-with-linkage-considerations and, worse, architecturally server-side. §7.2 documents the
resolution: pdf.js + pdfium + pdf-lib, zero copyleft, fully client-side. This is the single most
important engineering decision in this spec and must not be silently reversed by a future contributor
reaching for "just use MuPDF, it's easier" — that reintroduces AGPL and a licensing decision, not a
technical one.

### 25.2 Licence allowlist
Identical allowlist to `image.complianttools.com` §25.2: MIT, Apache-2.0, BSD-2/3, ISC, Zlib, 0BSD,
MPL-2.0 (wrap-never-patch), Unlicense, CC0. **Deny** on GPL/LGPL/AGPL/SSPL/BUSL/non-commercial/unknown.

### 25.3 Items requiring explicit clearance decisions before implementation
- Digital-signature root-certificate trust lists — we verify against certificates the *user's own
  browser/OS* trusts, or a user-supplied CA bundle; we never bundle or claim authority over a root
  program.
- E-signature "request" flow naming — avoid any single vendor's trademarked verb; describe the feature
  generically ("send for signature via your own email").
- pdfium wrapper licensing — ⚠ VERIFY the exact licence of whichever maintained WASM build is pinned;
  pdfium core is permissive but wrapper projects must be checked individually.

### 25.4 Trust claims
"Nothing is uploaded" must remain literally true and demonstrably verifiable in the Network panel for
every tool except the four AI tools (§4.9, always after an explicit gesture) and the two Relay-gated
tools (§15, always stated plainly when unconfigured).

The capability reference records several privacy models observed in the source products: local-browser
processing that continues offline after load; temporary upload services that advertise deletion; and
desktop/mobile applications with different storage boundaries. Our implementation adopts only the first
model by default. A BYOK request is an explicit exception to the local-only path, and a Relay request is
an explicit exception to static-browser capture. The UI must show the active boundary before processing,
including the configured endpoint for AI or Relay work, and must never imply that a third party's retention
or certification claim applies to this product.

---

## 26. Implementation roadmap

See `PLAN.md` for the dependency-aware execution ledger. Only the bootstrap/contracts work is a
hard prerequisite. Once Gate 0 passes, these workstreams start in parallel:

0. Foundation, toolchain, shared engine contracts, IP clearance, and design primitives
A. Core pipeline plus organize/optimize/repair (T01–T19)
B. Conversion breadth and format fixtures (T20–T34)
C. Editing, forms, signing, protection, redaction, and accessibility authoring (T42–T59)
D. Viewing, comparison, inspection, metadata, and OCR (T60–T64)
E. BYOK platform and document intelligence (T29/T44/T52/T59/T61, T65–T68)
F. Creation, Relay, batch, recipes, folder watching, and CLI/library (T35–T41, T69–T72)
G. Cross-workstream hardening and launch convergence: i18n, SEO, accessibility, performance, legal,
   branch protection, and final Definition-of-Done verification

Workstream E can build its provider/key/consent platform while B–D build extraction and local fallbacks;
its document-facing integrations begin as soon as those contracts exist. Workstream G can build its
checklists and page scaffolding early, but its final gate waits for all workstream artifacts.

---

## 27. Definition of done

A tool is done only when it passes the Standard Tool Completion Checklist (PLAN.md §0.4, ported
verbatim) — engine op with no DOM dependency, generated Zod-schema controls, all-defaults-no-op,
full error-branch test coverage, adversarial-input coverage, prerendered page meeting the ten-rule
contract, live-preview fidelity proof, latency budget met and measured, zero `axe` violations,
full keyboard operability, i18n-survivable strings, and an honest offline story.

---

## 28. Appendices

See `PLAN.md` Appendices A (Tools), B (Formats), C (AI adapters), D (Clearance register) for the
tracked, checkbox-driven versions of §4, §5, §14, and §25 respectively.
