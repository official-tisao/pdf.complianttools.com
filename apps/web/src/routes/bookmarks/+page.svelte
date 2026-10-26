<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
    import { firstBytes, download } from '$lib/pdf-download';

  export type BookmarkNode = { title: string; page: number };

  let bookmarks = $state<BookmarkNode[]>([]);
  let file = $state<File | null>(null);
  let status = $state('');

  async function run(fileList: File[]) {
    if (!fileList[0]) return;
    file = fileList[0];
    status = 'Updating outline…';
    try {
      const bytes = await firstBytes(fileList);
      const current = await (await import('@pdf-complianttools/engine')).getPdfOutline(bytes);
      bookmarks = current.map((item) => ({ title: item.title, page: item.pageNumber ?? 1 }));
      const { updatePdfBookmarks } = await import('@pdf-complianttools/engine');
      const edited = await updatePdfBookmarks(bytes, bookmarks);
      download(edited, 'bookmarked.pdf');
      status = 'Done. Downloaded bookmarked.pdf.';
    } catch (e) {
      status = e instanceof Error ? e.message : 'Failed.';
    }
  }

  function addBookmark() {
    bookmarks = [...bookmarks, { title: 'New section', page: 1 }];
  }

  function deleteBookmark(index: number) {
    bookmarks = bookmarks.filter((_, i) => i !== index);
  }

  function updateBookmark(index: number, field: 'title' | 'page', value: string | number) {
    const updated = [...bookmarks];
    updated[index] = { ...updated[index], [field]: value };
    bookmarks = updated;
  }

  async function saveEdited() {
    if (!file) return;
    status = 'Saving outline…';
    try {
      const { updatePdfBookmarks } = await import('@pdf-complianttools/engine');
      const bytes = await firstBytes([file]);
      const result = await updatePdfBookmarks(bytes, bookmarks);
      download(result, 'bookmarked.pdf');
      status = 'Done. Downloaded bookmarked.pdf.';
    } catch (e) {
      status = e instanceof Error ? e.message : 'Save failed.';
    }
  }
</script>

<svelte:head><title>Bookmark Editor — locally</title></svelte:head>

<ToolWorkspace
  title="Bookmark Editor"
  eyebrow="ORGANIZE"
  description="Add and edit a PDF's outline tree so its sections are navigable."
  actionLabel="Edit bookmarks"
  actionKey="shell.action.bookmarks"
  onrun={run}
  singleFile={true}
/>

{#if file}
  <section class="bookmarks-panel" aria-label="Bookmark tree">
    <div class="toolbar">
      <button onclick={addBookmark}>Add bookmark</button>
      <button onclick={saveEdited}>Save to PDF</button>
    </div>
    <table>
      <thead><tr><th>Title</th><th>Page</th><th></th></tr></thead>
      <tbody>
        {#each bookmarks as b, i (i)}
          <tr>
            <td><input bind:value={b.title} oninput={() => updateBookmark(i, 'title', b.title)} /></td>
            <td><input type="number" min="1" bind:value={b.page} oninput={() => updateBookmark(i, 'page', b.page)} /></td>
            <td><button onclick={() => deleteBookmark(i)}>Delete</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="status" role="status" aria-live="polite">{status}</p>
  </section>
{/if}

<style>
  .bookmarks-panel { margin-top: 24px; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
  .toolbar { display: flex; gap: 12px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
  input { width: 100%; padding: 4px; }
  button { padding: 6px 10px; }
  .status { color: #555; margin-top: 8px; }
</style>
