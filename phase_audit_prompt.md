# PHASE-BY-PHASE AUDIT & FIX SYSTEM

Use this exact flow for every phase. Do not skip steps.

## Phase Template (repeat for Phase 1 → Phase 5)

PHASE: <Name>
TASK: <Specific code/task, referencing file:line from audit>
TEST: <Validation method (run fixtures / compare output / check test-results / build / lint)>
REPORT: <Full report delivered before moving to next phase>

## Rules

- No code edited until this prompt is invoked.
- Each phase ends ONLY after TEST passes and REPORT is delivered.
- Report must include: what was done, test result, remaining issues, next phase impact.
- At end of final phase: summarize all changes, final test proof, and confirm no uncommitted work if required.

## Phase Definitions (from audit)

Phase 1 — Preserve visual metadata during PDF/HTML extraction (pdf-text.ts, convert.ts)
Phase 2 — Add CSS-aware rendering layer / replace textPagesToPdf (pdf-text.ts)
Phase 3 — Preserve colors/styles in format converters (docx/pptx/xlsx/odf/epub in convert.ts)
Phase 4 — Add CSS preservation in HTML routes (htmlToPdf / pdfToHtml)
Phase 5 — Validation / regression + final report

---

# Font-Size Recovery Decision (recorded: 2026-10-28)

- meta.scale = sqrt(a²+b²) treated as reference only; not a direct font-size extraction.
- Do NOT use meta.scale * 12 as fallback fontSize.
- Prefer meta.fontSize when explicitly available and verified.
- If font size unestablished, leave unset (no invented values).
- General font-size recovery: NOT ESTABLISHED (verified by synthetic fixture with scale=14/10 vs drawn 14pt/10pt; errors 154pt/110pt under scale*12 approximation).
- No production/test/dependency changes made.
- Related: color-font-meta.pdf generator/fixture/test exist; meta.color/fontSize missing in PDF.js extraction (verified separately).
