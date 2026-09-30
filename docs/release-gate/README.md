# Release-gate evidence bundles

One file per task whose `Done when` needs evidence CI cannot produce from unit
tests alone. Each records what was measured or observed, in what environment,
and against what threshold.

Regenerate with the script named in the bundle's `evidenceType` note; never
hand-edit the numbers.

| Bundle                        | Task  | What it proves                                                                                                   |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `P7-02-evidence-bundle.json`  | P7-02 | Three physical devices scanned generated QR codes                                                                |
| `P7-02-scan-plan.txt`         | P7-02 | The scan plan a device test must follow                                                                          |
| `P7-02-raw-logs.txt`          | P7-02 | Raw scanner output behind the bundle                                                                             |
| `P7-07-evidence.json`         | P7-07 | 50- and 200-file batches complete; the memory governor reduces rather than refuses (`pnpm measure:batch-budget`) |
| `P7-03-latency-evidence.json` | P7-03 | §19 invoice latency budgets, measured in Chromium (`pnpm verify:latency`)                                        |
