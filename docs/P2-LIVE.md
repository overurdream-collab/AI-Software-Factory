# P2 live integration pilot

This branch assembles the six separately delivered components for one authorized, disposable pilot inside overurdream-collab/AI-Software-Factory. No main merge, production deployment, external repository write or paid provider is authorized by this workflow.

Pinned inputs:
- A be0a65b8e638872ec00f59d37ee4c66971a1dc7e
- B 0c5afeda7bd768f939cb061ab45d81e595a43303
- C 7dbc376463e730eb1c2777ab38e4d4a932ebfa7a
- D 8455755657270229ca2db01e32b8f9f764231efb
- E 564c747d3858e4488b61bda12962d9c92f892a6e
- F 563da476df8e786cb8e0b5d288697f37852a34ad, plus independently authored scripts/acceptance.mjs and its dedicated verifier controls.

The fixture fixtures/p2-clamp/clamp.mjs deliberately misses the lower bound. F owns seven varied checks; the model receives only the buggy source and a behavioral goal, never the expected revised source or test contents.

P2 live factory pilot runs only on explicitly named coordination integration branches. It uses a dedicated ephemeral GitHub runner because the interactive workspace cannot access the Docker socket. The runner installs Ollama v0.40.18 after checking the release archive SHA-256, pulls qwen2.5-coder:1.5b locally with cloud inference disabled, and pins the Docker image by its observed digest. The initial 0.5b trial failed with an invalid candidate and was not accepted or delivered; the larger model is evaluated against the same independent tests.

scripts/p2-live.mjs repair executes A/B/E under D leases, then F independently reapplies and validates the patch and tests in a new Docker sandbox. It closes SQLite. A separate process, scripts/p2-live.mjs deliver, reopens the database and checks the artifact identity before C delivery. It then fetches the actual PR head, has F verify that exact commit under a separate valid audit lease, publishes a commit-bound check run, and lets C reconcile the same PR to delivered. Replay must return the same PR and commit.

The custom check Factory live pilot acceptance is published only after F verifies the exact remote head in Docker. GitHub suppresses workflow triggers for GITHUB_TOKEN-created refs, so this explicit head check is needed; no unrelated CI conclusion is substituted.

GitHub Actions may be prevented by repository policy from opening pull requests even with pull-requests:write. In that case the job fails visibly and retains its SQLite checkpoint. The authorized coordinator may create the same candidate PR using the connected GitHub app and rerun the failed job; the rerun restores the accepted artifact and reconciles existing remote objects instead of generating a new patch. Such a fallback must be reported as coordinator-assisted delivery, not fully unattended delivery.

Evidence and checkpoints are uploaded as factory-p2-checkpoint (14-day artifact retention). They contain no GitHub credential; candidate code never receives one. Log hashes and raw public-fixture test outputs are retained outside candidate workspaces. Completed sanitized results should also be copied into a reviewable repository evidence document for longer retention.

This pilot is not a 24-hour hosted service, not proof of two live coding workers, and not a guarantee of all possible repairs. Initial addition of this file is preparation, not evidence of successful live execution. Use actual run/check/PR results to decide acceptance.

## Resume control revision

The v2 control branch restores the accepted checkpoint from run 45544471305. Its operator-pinned repair base remains 1e2226e5f0bb61842a45df03253a88a72a4638e4 on coord/p2-live-integration-v1, and its reviewed head remains 60705dbb5ca251a33b1b8b99e4c4ee7b645f4ab2 in PR #10. It must not regenerate a patch or change the fixture's independent tests. The artifact SHA-256 before resumption is 2b23e17dabc943d78d4aff88cea5133aeaa22cfb0d19ccb372e105828d45378c.

The first resumed job exposed a local Git transport defect: clone transfers local branch refs, not remote-tracking refs. The control revision now fetches the exact delivered head into a local refs/heads/p2-head-<sha> and asserts its identity before F clones it. Independent verifier and check-file contents remain unchanged. This is a control-plane transport repair, not an alteration of the accepted source or acceptance criteria. The original v1 base is deliberately left immutable.
