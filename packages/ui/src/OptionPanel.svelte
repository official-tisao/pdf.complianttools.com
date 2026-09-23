<script lang="ts">
  export type OptionField = {
    key: string;
    label: string;
    type: 'number' | 'text' | 'range' | 'select' | 'checkbox';
    value: string | number | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: readonly string[];
    advanced?: boolean;
  };

  let {
    fields,
    onchange,
  }: { fields: OptionField[]; onchange?: (key: string, value: string | number | boolean) => void } =
    $props();
  let advanced = $state(false);

  function update(field: OptionField, event: Event) {
    const target = event.currentTarget as { value: string; checked?: boolean };
    const value =
      field.type === 'checkbox'
        ? Boolean(target.checked)
        : field.type === 'number' || field.type === 'range'
          ? Number(target.value)
          : target.value;
    onchange?.(field.key, value);
  }
</script>

<section class="options" aria-labelledby="options-heading">
  <h2 id="options-heading">Options</h2>
  {#each fields.filter((field) => !field.advanced || advanced) as field (field.key)}
    <label>
      <span>{field.label}</span>
      {#if field.type === 'select'}
        <select
          value={field.value as string}
          onchange={(event) => update(field, event)}
          aria-label={field.label}
        >
          {#each field.options ?? [] as option (option)}<option value={option}>{option}</option
            >{/each}
        </select>
      {:else if field.type === 'checkbox'}
        <input
          type="checkbox"
          checked={Boolean(field.value)}
          onchange={(event) => update(field, event)}
          aria-label={field.label}
        />
      {:else}
        <input
          type={field.type}
          value={field.value as string | number}
          min={field.min}
          max={field.max}
          step={field.step}
          onchange={(event) => update(field, event)}
          aria-label={field.label}
        />
      {/if}
    </label>
  {/each}
  {#if fields.some((field) => field.advanced)}
    <button
      type="button"
      class="disclosure"
      aria-expanded={advanced}
      onclick={() => (advanced = !advanced)}
      >{advanced ? 'Hide advanced options' : 'Show advanced options'}</button
    >
  {/if}
</section>

<style>
  .options {
    background: var(--color-white, #fff);
    border: 1px solid var(--color-hairline, #1c1a171a);
    border-radius: var(--radius-panel, 8px);
    display: grid;
    gap: 16px;
    padding: 20px;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  label {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr);
  }
  input,
  select {
    border: 1px solid var(--color-hairline, #1c1a171a);
    border-radius: 6px;
    font: inherit;
    min-height: 36px;
    padding: 6px 8px;
  }
  input[type='checkbox'] {
    justify-self: start;
    min-height: 20px;
  }
  .disclosure {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    justify-self: start;
    padding: 0;
    text-decoration: underline;
  }
</style>
