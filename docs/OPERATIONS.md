# Runtime operations — Agent E

Use a dedicated trusted Docker host with Node >=22. No production deployment or paid resources are authorized. The host must configure trusted workers, durable store and D resource APIs. Pass an already installed node image digest. Project plans are trusted argv lists, never model-generated shell commands.

The runner mounts the checkout read-only and copies it to bounded writable tmpfs. No network, host credentials or Docker socket should be present in the checkout. Resource records precede creation; reconciliation verifies durable eligibility and immutable Docker ID. Missing orphan registrations remain eligible to handle late creation; retention and definitive absence need further integration.

The daemon API runs bounded rounds and reconciliation, uses abortable backoff, and reports round states; a heartbeat or round alone is not task progress. Arbitrary in-process adapters cannot be forcibly terminated by AbortSignal; isolate such adapters in subprocesses or containers before acceptance.

Validation:
- node --test test/runtime-unit.test.mjs (fixture-based tests, not live Docker)
- FACTORY_DOCKER_TEST=1 node --test test/sandbox.integration.test.mjs (requires Docker and preloaded legacy image)
- F must additionally verify real project runner, positive network control, SIGKILL/restart, live versus orphan versus foreign containers, and 24-hour hosted fault injection.

Current limitations: Docker unavailable in local execution environment; direct git DNS failed. No hosted runtime or authorized external pilot. D resource API integration, writable tmpfs permissions, late-create reconciliation, hard cancellation and positive network control require verification. No G5 or P4 acceptance claimed.

## Cross-agent verification and host entrypoint
D integration test pins 8455755657270229ca2db01e32b8f9f764231efb in a separate detached worktree. The Docker CI suite now includes actual project command execution, SQLite leases, SIGKILL of the runner, reopening the database, actual lease expiration, cleanup with live and unrelated container controls, and a replacement attempt. Check the exact revision's CI results; test code is not evidence by itself.
Positive network control passed on E revision 49130f9f7d8c7da20d76738d3c43baf219f62e9d, run 45540849644 (3 pass, 0 fail, 0 skipped).

Run the service on an authorized dedicated Linux host:
```sh
FACTORY_RUNTIME_CONFIG=/etc/factory/runtime.mjs FACTORY_PROGRESS_PATH=/var/lib/factory/status.json node scripts/daemon.mjs
```
The operator config must export createRuntime({signal}) returning store, workers, resourceApi, optional close(), and daemon settings. Keep config and database outside project trees. The operator supplies approved tasks and providers. Example systemd service (adjust to actual host and trusted service account; Docker access is effectively root-level):
```ini
[Unit]
Description=AI Software Factory runtime
After=docker.service
Requires=docker.service
[Service]
Type=simple
User=factory
WorkingDirectory=/opt/factory
Environment=FACTORY_RUNTIME_CONFIG=/etc/factory/runtime.mjs
Environment=FACTORY_PROGRESS_PATH=/var/lib/factory/status.json
ExecStart=/usr/bin/node /opt/factory/scripts/daemon.mjs
Restart=on-failure
RestartSec=10
TimeoutStopSec=40
KillMode=control-group
[Install]
WantedBy=multi-user.target
```
The status file represents round liveness only, not accepted-task progress. Compare durable attempts, command evidence and completed deliveries against actual time. For the 24h acceptance run, retain start/end UTC, host identity, exact commit, image digest, per-task attempts, fault injection timestamps, cleanup results, recovery times, and independently verified task results. Use only disposable authorized fixtures. Service definition is not installed or running on a persistent host; no 24h proof exists yet. A bounded CI runner is not a permanent host.

## Parallel worker acceptance fixture
Revision 7528504c4ac7ad108e8ab814371d1e184d4098bb adds two independent Node OS processes sharing D SQLite, with separate Git fixture repos and B workspaces, E Docker runners, baseline assertion failures and corrected candidate commands. B pinned at 0c5afeda7bd768f939cb061ab45d81e595a43303; D pinned at e261a5617422251c7420024da2db81a96c6ad9c1. The trusted test commands emit actual in-container start/end UTC epoch milliseconds; the test requires positive overlap and validates both patches on pristine repos, distinct PIDs/attempts/workspaces, and cleanup. The generator is a predetermined fixture, not live AI inference. Tasks remain in review; F owns independent acceptance. Evidence is PARALLEL_EVIDENCE in the Docker workflow log, not an assertion of success before CI runs.
