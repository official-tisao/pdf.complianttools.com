<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import type { AnnotationKind } from '@pdf-complianttools/engine';

  type PhaseCOperation =
    | 'editor'
    | 'annotate'
    | 'add-text'
    | 'add-image'
    | 'headers-footers'
    | 'page-numbers'
    | 'watermark'
    | 'overlay'
    | 'create-form'
    | 'fill-form'
    | 'accessibility-audit'
    | 'sign'
    | 'signature-background'
    | 'request-signature'
    | 'protect'
    | 'unlock'
    | 'password-generator'
    | 'redact'
    | 'verify-signature';

  let {
    title,
    description,
    operation,
    accept = '.pdf,application/pdf',
  }: { title: string; description: string; operation: PhaseCOperation; accept?: string } = $props();

  let files = $state<File[]>([]);
  let busy = $state(false);
  let status = $state('');
  let error = $state('');
  let downloadHref = $state<string | undefined>();
  let downloadName = $state('edited.pdf');
  let find = $state('');
  let replacement = $state('');
  let text = $state('Added locally');
  let note = $state('');
  let recipients = $state('recipient@example.test');
  let threshold = $state(32);
  let page = $state(1);

  function selectFiles(list: FileList | null) {
    files = list ? Array.from(list) : [];
    status = files.length
      ? `${files.length} file${files.length === 1 ? '' : 's'} selected locally.`
      : '';
    error = '';
    downloadHref = undefined;
  }

  function save(bytes: Uint8Array, name: string, type: string) {
    const url = globalThis.URL.createObjectURL(
      new globalThis.Blob([bytes.buffer as ArrayBuffer], { type }),
    );
    downloadHref = url;
    downloadName = name;
  }

  async function run() {
    const file = files[0];
    if (!file && operation !== 'password-generator') {
      error = 'Choose a local file first. Nothing is uploaded.';
      return;
    }
    busy = true;
    error = '';
    status = 'Working locally…';
    try {
      const engine = await import('@pdf-complianttools/engine');
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : undefined;
      if (operation === 'password-generator') {
        const generated = engine.generateSecurePassword({ length: 24, symbols: true });
        status = `Generated a local password with about ${generated.entropyBits} bits of entropy. Copy it from this page; it is not stored.`;
        note = generated.password;
      } else if (operation === 'editor') {
        const output = await engine.editTextRun(bytes!, {
          page,
          find,
          replace: replacement,
          fallback: { page, text, x: 72, y: 72, size: 12 },
        });
        save(output, 'edited.pdf', 'application/pdf');
        status =
          'Text edit exported locally. If the font could not be edited in place, the engine used the labelled text-box remedy.';
      } else if (operation === 'annotate') {
        const output = await engine.addAnnotation(bytes!, {
          page,
          kind: 'highlight' satisfies AnnotationKind,
          rect: { x: 72, y: 680, width: 180, height: 24 },
          contents: note || 'Local annotation',
        });
        save(output, 'annotated.pdf', 'application/pdf');
        status = 'Standard PDF annotation exported locally.';
      } else if (operation === 'add-text') {
        save(
          await engine.addTextToPdf(bytes!, { page, text, x: 72, y: 72, size: 14 }),
          'add-text.pdf',
          'application/pdf',
        );
        status = 'Text box exported locally.';
      } else if (operation === 'add-image') {
        const image = files[1];
        if (!image) throw new Error('Choose a PDF and a PNG/JPEG image.');
        save(
          await engine.addImageToPdf(bytes!, new Uint8Array(await image.arrayBuffer()), {
            page,
            x: 72,
            y: 72,
            width: 160,
            height: 80,
          }),
          'add-image.pdf',
          'application/pdf',
        );
        status = 'Image placed locally.';
      } else if (operation === 'headers-footers') {
        save(
          await engine.addHeadersFooters(bytes!, {
            header: '{date}',
            footer: 'Page {page} of {total}',
          }),
          'headers-footers.pdf',
          'application/pdf',
        );
        status = 'Header/footer tokens expanded locally.';
      } else if (operation === 'page-numbers') {
        save(
          await engine.addPageNumbers(bytes!, {
            format: 'page-of-total',
            position: 'bottom-center',
          }),
          'page-numbers.pdf',
          'application/pdf',
        );
        status = 'Page numbers exported locally.';
      } else if (operation === 'watermark') {
        save(
          await engine.addWatermark(bytes!, { text: text || 'DRAFT', opacity: 0.25, rotation: 45 }),
          'watermarked.pdf',
          'application/pdf',
        );
        status = 'Watermark exported locally.';
      } else if (operation === 'overlay') {
        const overlay = files[1];
        if (!overlay) throw new Error('Choose a base PDF and an overlay PDF.');
        save(
          await engine.overlayPdf(bytes!, new Uint8Array(await overlay.arrayBuffer())),
          'overlay.pdf',
          'application/pdf',
        );
        status = 'PDF overlay exported locally.';
      } else if (operation === 'create-form') {
        save(
          await engine.createFormPdf(bytes!, [
            { name: 'name', type: 'text', page, x: 72, y: 680, width: 220, height: 24 },
            { name: 'agree', type: 'checkbox', page, x: 72, y: 640, width: 18, height: 18 },
          ]),
          'fillable-form.pdf',
          'application/pdf',
        );
        status = 'AcroForm fields created locally.';
      } else if (operation === 'fill-form') {
        save(
          await engine.fillFormPdf(bytes!, { name: text || 'Filled locally', agree: true }),
          'filled-form.pdf',
          'application/pdf',
        );
        status = 'Supported AcroForm fields filled locally.';
      } else if (operation === 'accessibility-audit') {
        const report = await engine.auditAccessibility(bytes!);
        note = `${report.imageCount} images; ${report.taggedImageCount} Figure tags; reading order: ${report.readingOrder}. ${report.warnings.join(' ') || 'No local audit warnings.'}`;
        status =
          'Accessibility audit complete. Authoring still requires manual review where tags are missing.';
      } else if (operation === 'sign') {
        save(
          await engine.signPdf(bytes!, {
            page,
            text: text || 'Signed locally',
            x: 72,
            y: 72,
            width: 160,
            height: 48,
            dateStamp: true,
          }),
          'signed-visible.pdf',
          'application/pdf',
        );
        status =
          'Visible signature appearance exported locally; it is not a certificate-backed digital signature.';
      } else if (operation === 'signature-background') {
        save(
          engine.removeSignatureBackground(new Uint8Array(await file!.arrayBuffer()), threshold),
          'signature-transparent.png',
          'image/png',
        );
        status = 'Transparent PNG exported locally.';
      } else if (operation === 'request-signature') {
        const packageBytes = await engine.prepareSignatureRequest(
          bytes!,
          recipients
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          note || 'Please review and sign this document.',
        );
        save(packageBytes, 'signature-request.json', 'application/json');
        status =
          'A local request package is ready. Delivery is not sent: configure your own email or signing API explicitly.';
      } else if (operation === 'protect') {
        await engine.protectPdf();
      } else if (operation === 'unlock') {
        await engine.unlockPdf();
      } else if (operation === 'redact') {
        const result = await engine.redactPdf(bytes!, {
          method: 'text-search-match',
          searchPattern: find || undefined,
          page,
          removeMetadataOnRedact: true,
        });
        save(result.bytes, 'redacted-verified.pdf', 'application/pdf');
        status = `Redaction exported only after verification. ${result.warnings.join(' ')}`;
      } else if (operation === 'verify-signature') {
        const report = await engine.verifyDigitalSignatures(bytes!);
        status = `${report.status}: ${report.remedy}`;
      }
    } catch (caught) {
      error =
        caught instanceof Error ? caught.message : 'The local operation could not be completed.';
      status = '';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{title} locally</title>
  <meta name="description" content={description} />
</svelte:head>

<section class="tool-page">
  <p class="eyebrow">EDIT &amp; SECURITY</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  <div class="trust">
    <strong>Local-first.</strong> This route does not upload document bytes or credentials.
  </div>
  {#if operation === 'signature-background'}
    <FileDrop
      accept=".png,image/png"
      onchange={selectFiles}
      label="Drop an 8-bit RGBA PNG signature photo"
    />
  {:else}
    <FileDrop
      {accept}
      onchange={selectFiles}
      label={operation === 'add-image' || operation === 'overlay'
        ? 'Choose the base file, then the second local file'
        : 'Drop a PDF here or choose a local file'}
    />
  {/if}
  <div class="panel">
    {#if operation === 'editor'}
      <label
        >Existing text to replace<input
          bind:value={find}
          placeholder="Simple literal text run"
        /></label
      >
      <label>Replacement<input bind:value={replacement} placeholder="Replacement text" /></label>
      <label>Fallback text box<input bind:value={text} /></label>
    {:else if operation === 'redact'}
      <label
        >Text or regex to remove<input
          bind:value={find}
          placeholder="SSN, email, or a regular expression"
        /></label
      >
      <p class="caution">
        The local conservative fallback removes the complete content stream of matching pages, then
        verifies text, structure, and metadata surfaces. Review before sharing.
      </p>
    {:else if operation === 'request-signature'}
      <label
        >Recipients<input
          bind:value={recipients}
          placeholder="one@example.com, two@example.com"
        /></label
      >
      <label>Message<textarea bind:value={note} rows="3"></textarea></label>
    {:else if operation === 'accessibility-audit' || operation === 'verify-signature'}
      <p class="caution">
        This is a read-only evidence report. Unsupported cryptographic or authoring claims remain
        visible as remedies.
      </p>
    {:else if operation !== 'password-generator'}
      <label>Text / note<input bind:value={text} /></label>
    {/if}
    {#if operation !== 'password-generator' && operation !== 'signature-background'}
      <label>Page<input type="number" min="1" bind:value={page} /></label>
    {/if}
    {#if operation === 'signature-background'}
      <label
        >Background threshold<input type="number" min="0" max="255" bind:value={threshold} /></label
      >
    {/if}
    <Button disabled={busy} onclick={run}
      >{busy
        ? 'Working locally…'
        : operation === 'password-generator'
          ? 'Generate locally'
          : 'Run locally'}</Button
    >
    {#if note}<p class="result" role="status">{note}</p>{/if}
    {#if status}<p class="status" role="status">{status}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if downloadHref}<a class="download" href={downloadHref} download={downloadName}
        >Download {downloadName}</a
      >{/if}
  </div>
</section>

<style>
  .tool-page {
    margin: auto;
    max-width: 960px;
    padding: 96px 40px 0;
  }
  .eyebrow {
    color: var(--color-muted);
    font-size: 0.875rem;
    letter-spacing: 0.12em;
  }
  h1 {
    font-size: clamp(2.5rem, 6vw, 4rem);
    letter-spacing: -0.05em;
    margin: 12px 0;
  }
  .lede,
  .status,
  .caution {
    color: var(--color-muted);
    max-width: 720px;
  }
  .trust {
    background: var(--color-platinum);
    border-radius: var(--radius-panel);
    margin: 24px 0;
    padding: 14px 18px;
  }
  .panel {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    display: grid;
    gap: 16px;
    margin-top: 24px;
    padding: 24px;
  }
  label {
    display: grid;
    gap: 8px;
    font-weight: 600;
  }
  input,
  textarea {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    font: inherit;
    padding: 10px;
  }
  .error {
    color: #9a2f24;
  }
  .result {
    background: var(--color-platinum);
    overflow-wrap: anywhere;
    padding: 12px;
  }
  .download {
    color: inherit;
    font-weight: 600;
  }
  @media (max-width: 767px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
  }
</style>
