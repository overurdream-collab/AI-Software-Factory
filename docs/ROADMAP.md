# Delivery gates
G0: deterministic scheduler, retry bounds and independent verifier tests.
G1: durable task storage and restart recovery; concurrency leases.
G2: evaluate upstream OpenHands, Symphony and Open SWE at pinned revisions; verify licenses, costs, sandbox and GitHub compatibility before adoption.
G3: one real coding worker in isolated workspace; explicit repository allowlist, no secrets exposed to untrusted code.
G4: GitHub issue intake, branch/PR delivery, CI evidence tied to exact commit; independent review.
G5: unattended bounded retries, heartbeat, watchdog, budgets and kill switch.
G6: pilot on disposable repository, then owner-authorized real project.
Acceptance: real code change, passing tests, independent review, PR, restart recovery, no unauthorized side effects. Do not claim 24/7 until hosted runtime and recovery are demonstrated.
