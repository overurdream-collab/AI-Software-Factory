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

## Verified parallel execution — 2026-11-25
Both Docker runs completed successfully; extracted from PARALLEL_EVIDENCE in actual job logs. Factory CI run 45547266082: 30 passed, 0 failed, 5 skipped; Docker run 45547266050: 5 passed, 0 failed, 0 skipped. The two candidate command intervals overlap by 2995 ms on the second run and 2994 ms on the first. Both workers submitted distinct patches, independently reapplied to pristine Git trees; all four containers were removed. This establishes runtime concurrency using a deterministic generator, not live model autonomy, scheduler runRound integration, independent F acceptance, or hosted 24-hour reliability. The intervals include the intentional three-second fixture delay; they do not measure coding throughput. Commands: node --test; FACTORY_DOCKER_TEST=1 node --test test/sandbox.integration.test.mjs (existing CI). Durable redacted evidence:

```json
{
  "version": 1,
  "kind": "live-runtime-deterministic-generator",
  "testedCommit": "778efb892c62e45c6c75761028158ab98501dd4d",
  "D": "e261a5617422251c7420024da2db81a96c6ad9c1",
  "B": "0c5afeda7bd768f939cb061ab45d81e595a43303",
  "imageDigest": "sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a",
  "runs": [
    {
      "commit": "7528504c4ac7ad108e8ab814371d1e184d4098bb",
      "dockerRun": 45547248250,
      "job": 138979706150,
      "overlapMs": 2994,
      "passed": 5,
      "failed": 0,
      "skipped": 0
    },
    {
      "commit": "778efb892c62e45c6c75761028158ab98501dd4d",
      "dockerRun": 45547266050,
      "job": 138979759352,
      "overlapMs": 2995,
      "passed": 5,
      "failed": 0,
      "skipped": 0
    }
  ],
  "workers": [
    {
      "worker": "worker-01",
      "pid": 3865,
      "taskId": "sum",
      "attemptId": "e7557094-7fda-4895-9c1e-281cde483f34",
      "workspace": "work-sum/worker-bP3wIu",
      "baselineExit": 1,
      "candidateExit": 0,
      "patchSha256": "a009d6fef916f712bc77015b8acc38cc34202132cc170253bba365f109fdf527",
      "candidateTree": "44b2ad5a78fef9855498a6d63c2604d9c1f38c0f",
      "start": 1795581072252,
      "end": 1795581075255
    },
    {
      "worker": "worker-02",
      "pid": 3866,
      "taskId": "text",
      "attemptId": "48e301cf-7f87-4ba7-9732-1c1d4ead1183",
      "workspace": "work-text/worker-pL8h8P",
      "baselineExit": 1,
      "candidateExit": 0,
      "patchSha256": "06d2e476108ed059cc237b5afa6877bd62a14d24217406582cd24e1fbfaaa725",
      "candidateTree": "3aff1260221bc2028e0d1558c90bebf2b1456d69",
      "start": 1795581072244,
      "end": 1795581075247
    }
  ],
  "resourcesCleaned": 4
}
```
