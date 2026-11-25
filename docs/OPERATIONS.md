# Runtime operations — Agent E

Use a dedicated trusted Docker host with Node >=22. No production deployment or paid resources are authorized. The host must configure trusted workers, durable store and D resource APIs. Pass an already installed node image digest. Project plans are trusted argv lists, never model-generated shell commands.

The runner mounts the checkout read-only and copies it to bounded writable tmpfs. No network, host credentials or Docker socket should be present in the checkout. Resource records precede creation; reconciliation verifies durable eligibility and immutable Docker ID. Missing orphan registrations remain eligible to handle late creation; retention and definitive absence need further integration.

The daemon API runs bounded rounds and reconciliation, uses abortable backoff, and reports round states; a heartbeat or round alone is not task progress. Arbitrary in-process adapters cannot be forcibly terminated by AbortSignal; isolate such adapters in subprocesses or containers before acceptance.

Validation:
- node --test test/runtime-unit.test.mjs (fixture-based tests, not live Docker)
- FACTORY_DOCKER_TEST=1 node --test test/sandbox.integration.test.mjs (requires Docker and preloaded legacy image)
- F must additionally verify real project runner, positive network control, SIGKILL/restart, live versus orphan versus foreign containers, and 24-hour hosted fault injection.

Current limitations: Docker unavailable in local execution environment; direct git DNS failed. No hosted runtime or authorized external pilot. D resource API integration, writable tmpfs permissions, late-create reconciliation, hard cancellation and positive network control require verification. No G5 or P4 acceptance claimed.
