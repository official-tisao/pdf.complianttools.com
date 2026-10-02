<script lang="ts">
  /**
   * A compact, SVG-based progress indicator for local work that can take a
   * moment to complete. Pass a number from 0 to 100 when the caller can
   * measure progress; pass null for an indeterminate, animated state.
   */
  let {
    value = null,
    label = 'Loading',
    detail = '',
    size = 'compact',
  }: {
    value?: number | null;
    label?: string;
    detail?: string;
    size?: 'compact' | 'regular';
  } = $props();

  const progress = $derived(value == null ? null : Math.min(100, Math.max(0, value)));
  const circumference = 113.1;
  const dashOffset = $derived(
    progress == null ? circumference * 0.72 : circumference * (1 - progress / 100),
  );
  const accessibleLabel = $derived(detail ? `${label}: ${detail}` : label);
</script>

<div
  class="loading-progress {size}"
  class:indeterminate={progress == null}
  role={progress == null ? 'status' : 'progressbar'}
  aria-label={accessibleLabel}
  aria-live="polite"
  aria-valuemin={progress == null ? undefined : 0}
  aria-valuemax={progress == null ? undefined : 100}
  aria-valuenow={progress == null ? undefined : Math.round(progress)}
>
  <svg class="indicator" viewBox="0 0 48 48" aria-hidden="true">
    <circle class="track" cx="24" cy="24" r="18" />
    <circle class="value" cx="24" cy="24" r="18" style={`stroke-dashoffset: ${dashOffset}`} />
  </svg>
  <span class="copy">
    <span class="label">{label}</span>
    {#if detail}<span class="detail">{detail}</span>{/if}
  </span>
  <span class="percentage" aria-hidden="true"
    >{progress == null ? '…' : `${Math.round(progress)}%`}</span
  >
</div>

<style>
  .loading-progress {
    align-items: center;
    color: var(--color-secondary-ink, #464442);
    display: inline-flex;
    gap: 9px;
    min-height: 32px;
  }

  .loading-progress.regular {
    gap: 12px;
    min-height: 40px;
  }

  .indicator {
    display: block;
    flex: 0 0 auto;
    height: 32px;
    transform: rotate(-90deg);
    width: 32px;
  }

  .regular .indicator {
    height: 40px;
    width: 40px;
  }

  circle {
    fill: none;
    stroke-width: 4;
  }

  .track {
    stroke: color-mix(in srgb, var(--color-muted, #777) 20%, transparent);
  }

  .value {
    stroke: var(--color-ink, #1c1a17);
    stroke-linecap: round;
    stroke-dasharray: 113.1;
    transition: stroke-dashoffset 180ms ease-out;
    transform-box: fill-box;
    transform-origin: center;
  }

  .indeterminate .value {
    animation: loading-ring 1.15s linear infinite;
    stroke-dashoffset: 82;
  }

  .copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .detail {
    color: var(--color-muted, #777);
    font-size: 0.75rem;
  }

  .percentage {
    color: var(--color-muted, #777);
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    margin-left: auto;
  }

  @keyframes loading-ring {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .value {
      transition: none;
    }

    .indeterminate .value {
      animation: none;
      stroke-dashoffset: 66;
    }
  }
</style>
