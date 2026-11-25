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

## Verified CI evidence (2026-11-25)
Head 27dfb6266283303a9c52471d35ea79f0040b73fb, CI checkout merge 469c421 into baseline 47d5f98f46bcb82ac612266efcb336f672ddb956.
- Factory CI run 45540721612, job 138958285264: npm test, 34 tests, 31 pass, 0 fail, 3 skipped. All four synthetic fixture controls passed.
- Isolated execution pilot run 45540721622, job 138958285322: node --test test/sandbox.integration.test.mjs, 3 pass, 0 fail, 0 skipped.
- Prior run 45540569286: 28 pass, 3 fail, 3 skipped; nested Node test environment polluted child output. Fixed in 27dfb62 by clearing inherited test context and checking TAP counts. No live model evidence.
- New artifact.test.mjs uses local temporary Git fixtures to test clean checkout, patch digest, candidate tree and declared path checks, plus negative controls. It is a synthetic verifier control, not yet wired to B/C. Its CI result is pending at authoring time.
- No gate G1–G6 accepted. G0 synthetic acceptance controls passed on the earlier head; integrated factory acceptance remains pending. No claim of tests run on later heads until CI logs obtained.
