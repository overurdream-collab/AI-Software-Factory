# Independent acceptance — F
Baseline: 47d5f98f46bcb82ac612266efcb336f672ddb956.
Run: node --test test/acceptance/fixture.test.mjs
The fixture is a synthetic clamp bug. Correct control is handwritten, not model-generated. It checks red/green and rejects constant-answer and early-exit mutants. It is not evidence of a real factory repair. Host-side candidate execution is restricted to these hardcoded controls; future untrusted candidates require E's isolated runner.

| Gate | Required evidence | Current decision |
|---|---|---|
| G0 | independent regression and scheduler results | Unverified |
| G1 | two processes, overlapping leases, SIGKILL, restart, stale result rejection | Unverified |
| G2 | pinned upstream evaluation and live provider invocation | Unverified |
| G3 | clean base, artifact digest and tree, live repair, sandbox and independent red/green | Unverified |
| G4 | exact PR head/tree and CI logs, interrupted push/PR recovery without duplication | Unverified |
| G5 | execution/review/delivery interruption, orphan cleanup with live and unrelated controls | Unverified |
| G6 | authorized pilot and hosted 24-hour evidence | Unverified |

No approved external pilot repository or live model evidence. Local GitHub clone probe failed DNS resolution. Do not treat this infrastructure blocker as a failed repair. Do not approve or merge based on synthetic controls. F must retain ownership of acceptance suite and verify exact candidate tree, required command exit codes, test counts and log hashes; no candidate-supplied test plan. Missing or skipped required checks prevent acceptance.
