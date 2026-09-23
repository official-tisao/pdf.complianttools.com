<script lang="ts">
  type Variant = 'primary' | 'secondary';

  let {
    variant = 'primary',
    type = 'button',
    disabled = false,
    onclick,
    children,
  }: {
    variant?: Variant;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    children: import('svelte').Snippet;
  } = $props();
</script>

<button class={`button button-${variant}`} {type} {disabled} {onclick}>
  {@render children()}
</button>

<style>
  .button {
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    cursor: pointer;
    font: 600 1rem/1.5 var(--font-sans, system-ui, sans-serif);
    padding: 8px 28px;
    transition:
      transform 160ms ease,
      opacity 160ms ease;
  }

  .button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .button:focus-visible {
    outline: 3px solid var(--color-focus, #1c1a17);
    outline-offset: 3px;
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .button-primary {
    background: var(--color-ink, #1c1a17);
    color: var(--color-white, #fff);
  }

  .button-secondary {
    background: transparent;
    border-color: var(--color-hairline, #1c1a171a);
    color: var(--color-ink, #1c1a17);
  }
</style>
