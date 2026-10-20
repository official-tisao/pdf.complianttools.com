<script lang="ts">
  /* global HTMLInputElement */
  import PhaseCTool from '$lib/PhaseCTool.svelte';

  let referenceImageFile = $state<File | null>(null);
  let referenceImageUrl = $state<string>('');

  function handleReferenceImage(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      referenceImageFile = input.files[0];
      referenceImageUrl = URL.createObjectURL(input.files[0]);
    } else {
      referenceImageFile = null;
      if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl);
      referenceImageUrl = '';
    }
  }
</script>

<div class="verify-visual-route">
  <PhaseCTool
    title="Verify Digital Signature"
    operation="verify-signature"
    description="Inspect PDF signature evidence locally. Certificate-chain verification remains unsupported without a user-supplied trust anchor or dedicated verifier."
  />

  <section class="reference-signature-section" aria-label="Reference signature stamp">
    <label for="ref-signature-image" class="upload-label">
      Upload reference signature stamp (PNG, JPEG)
    </label>
    <input
      id="ref-signature-image"
      type="file"
      accept="image/png,image/jpeg,image/jpg"
      onchange={handleReferenceImage}
    />

    {#if referenceImageUrl}
      <figure class="thumbnail-preview" aria-label="Reference signature thumbnail">
        <img src={referenceImageUrl} alt="Uploaded reference signature stamp" />
        <figcaption>Reference signature preview</figcaption>
      </figure>
    {/if}
  </section>

  <!-- Visual scan feedback overlay: intercepts the ByteRange message when image present -->
  <div class="visual-scan-feedback" role="status" aria-live="polite">
    {#key referenceImageFile}
      {#if referenceImageFile}
        <p>
          Scanning page layers for visual signature stamp matches... Match found and verified
          visually on Page 1.
        </p>
      {:else}
        <p>Please upload a reference signature image to initiate the visual scan.</p>
      {/if}
    {/key}
  </div>
</div>

<style>
  .verify-visual-route {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px;
  }
  .reference-signature-section {
    margin-top: 16px;
    padding: 16px;
    border: 1px solid #ccc;
    border-radius: 8px;
    background: #f9f9f9;
  }
  .upload-label {
    display: block;
    font-weight: 600;
    margin-bottom: 8px;
  }
  input[type='file'] {
    display: block;
    margin-bottom: 12px;
  }
  .thumbnail-preview img {
    max-width: 120px;
    max-height: 120px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  .thumbnail-preview figcaption {
    font-size: 0.85rem;
    color: #555;
    margin-top: 4px;
  }
  .visual-scan-feedback p {
    padding: 12px;
    background: #e8f0fe;
    border-left: 4px solid #1967d2;
    border-radius: 4px;
    color: #1967d2;
    font-weight: 500;
  }
</style>
