<script lang="ts">
  let {
    label,
    value = 0,
    min = 0,
    max = 100,
    step = 1,
    onchange,
  }: {
    label: string;
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    onchange?: (event: Event) => void;
  } = $props();
</script>

<label class="slider">
  <span>{label}</span>
  <input type="range" {value} {min} {max} {step} {onchange} aria-label={label} />
</label>

<style>
  .slider {
    color: var(--color-ink, #1c1a17);
    display: grid;
    font: 600 0.875rem/1.4 var(--font-sans, system-ui, sans-serif);
    gap: 8px;
  }

  input {
    accent-color: var(--color-ink, #1c1a17);
    min-width: 160px;
  }

  input:focus-visible {
    outline: 3px solid var(--color-focus, #1c1a17);
    outline-offset: 3px;
  }
</style>
