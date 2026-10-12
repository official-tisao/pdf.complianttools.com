<script lang="ts">
</script>

<svelte:head>
  <title>AI Tools — Chat, Summarize, Translate, Generate</title>
  <meta name="description" content="PDF AI tools (local first, BYOK escalation)." />
</svelte:head>

<main class="panel">
  <h1>AI Tools</h1>
  <p>Local-first PDF intelligence. Escalation to your configured provider only after explicit confirmation.</p>

  <nav aria-label="AI subroutes">
    <ul>
      <li><a href="/ai/chat-with-pdf">Chat with PDF</a></li>
      <li><a href="/ai/summarize">Summarize / Quiz / Flashcards</a></li>
      <li><a href="/ai/translate">Translate PDF</a></li>
      <li><a href="/ai/generate-pdf">Generate PDF from Prompt</a></li>
      <li><a href="/ai/escalations">Escalations &amp; Remedies</a></li>
    </ul>
  </nav>

  <p><small>Workstream E — BYOK AI (PLAN.md T65–T68, category E, unshipped). Subroutes available; root landing added.</small></p>
</main>

<style>
  .panel { max-width: 640px; margin: 2rem auto; padding: 1.5rem; }
  nav ul { list-style: none; padding: 0; }
  nav li + li { margin-top: 0.5rem; }
  nav a { font-weight: 600; }
</style>
