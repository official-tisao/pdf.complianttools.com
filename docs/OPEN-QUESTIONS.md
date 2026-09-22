# Open questions and working defaults

This note records decisions that could reasonably require product-owner input while Phase A and
Phase B are implemented. None of these questions blocks the current work. The defaults below follow
the repository specification, local-first browser constraints, permissive licensing requirements, and
the existing `design.md` / `saas-template/` references.

| Question                                                     | Working default                                                                                                                                                                            | Revisit when                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| What branch names should carry the parallel work?            | Use `phase-a` and `phase-b`, each forked from the pushed Phase 0 fix on `init-commit`.                                                                                                     | Before merging either phase branch.                              |
| What does “end to end” mean for a phase?                     | Every task in that workstream gets an implementation seam, a user-visible path where applicable, typed errors, tests, and an updated PLAN status; no placeholder claims count as complete. | At the phase gate review.                                        |
| Which PDF engine is authoritative for export?                | `pdf-lib` remains the mutation/serialization engine; pdf.js validates authored output and pdfium cross-checks rendering.                                                                   | If a measured fidelity or performance test disproves the choice. |
| How should unsupported formats behave?                       | Explain the unsupported capability with a typed remedy and preserve the original file; never silently upload or invoke a copyleft/server dependency.                                       | When a permissively licensed browser reader is cleared.          |
| Should remote conversion be enabled by default?              | No. Local browser processing is the default; Relay is explicit opt-in and never required for local tools.                                                                                  | When a user explicitly configures Relay.                         |
| Which AI/provider behavior is assumed in these phases?       | No AI calls are added to Phase A or B; any future escalation remains BYOK, gesture-gated, and outside the local engine.                                                                    | During Workstream E implementation.                              |
| What are the initial performance priorities?                 | Correctness and bounded memory first, then measured throughput; use the budgets in README §19 and fail with a remedy before an OOM-prone operation.                                        | After representative fixture benchmarks exist.                   |
| How much localization is required before phase completion?   | All new user-facing strings use the existing message boundary; English is the source locale, with pseudo-locale and RTL checks added as the UI surface expands.                            | Before Workstream G launch convergence.                          |
| Which visual details take precedence when references differ? | `design.md` is the written contract; physical files under `saas-template/` are the implementation reference for spacing, shell, and responsive behavior.                                   | When a design review explicitly supersedes either reference.     |

## Defaults applied without waiting

- Keep the public static app useful with JavaScript disabled and with no Relay configured.
- Keep all document bytes local unless a user explicitly starts a BYOK or Relay operation.
- Prefer deterministic, browser-compatible, permissively licensed dependencies and record each new
  dependency in the clearance register before use.
- Add fixtures and tests alongside each capability; update `PLAN.md` in the same commit as any plan
  or specification change.
- Preserve the existing branch and commit discipline: related changes are grouped, phase work is
  pushed only to its own phase branch, and the current branch receives only the shared fix/base work.
