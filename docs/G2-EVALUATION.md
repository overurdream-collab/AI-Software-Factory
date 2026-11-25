# G2 evaluation and Agent A handoff

Date: 2026-11-25 UTC. Baseline: `47d5f98f46bcb82ac612266efcb336f672ddb956`.
Scope: provider transport, upstream source evaluation, reproducible local inference probe.
Status: implementation and live provider smoke test complete; independent F review pending. G2 is not declared accepted by this report, and G3–G6 remain unproven.

## Decision

Keep the existing bounded Ollama adapter for the first A→B pilot. It already fits the coordinator's `Generate({source,goal,signal}) → Promise<string>` contract, introduces no hosted provider credential, and now has a real local inference result. The unchanged default is `qwen3:8b` for compatibility; that default model was NOT downloaded or tested here. The smoke model is `qwen2.5-coder:0.5b`, a small CPU-capable model, not a production-quality selection.

Do not replace the scheduler or adopt a complete upstream engine before the first repository repair works. Reconsider an engine after F validates the complete isolated workspace→tests→PR flow. Ollama is a model-serving transport, not an autonomous coding engine. Its success does not satisfy the upstream-engine adoption gate by itself.

## Pinned source comparison

Only the source/docs cited below were inspected. None of these three engines was installed, run, benchmarked, vendored or integrated. Runtime compatibility is therefore unverified.

| Candidate and inspected revision | License observed | Runtime and isolation | GitHub compatibility described | Cost/dependency implications | Decision for first pilot |
| --- | --- | --- | --- | --- | --- |
| OpenHands/OpenHands `f16d9d992f7dcf2326802f3e30517fdfb98881e9` | Root MIT; retain copyright/license for copied code. Dependencies and external Agent Server/SDK require their own review. | Current README identifies **Agent Canvas**, Node 24+ and uv, with direct-host, Docker and multiple conversation sandbox modes. Direct-host mode gives host filesystem access; Canvas isolation does not imply all automation/control services are isolated. | README describes GitHub automations; runtime ownership is split across software-agent-sdk, typescript-client and automation repositories. Those extra repositories are not pinned/evaluated here. | Self-hosted option exists; commercial cloud optional. Host, inference, dependency and operations costs remain; no prices or account entitlements were verified. | Defer: broader control plane and several additional runtime repos; not a drop-in bounded Generate adapter. |
| openai/symphony `be10a1b79df723d6d7612b5651c8522704dafb2e` | Apache-2.0 root license; preserve required license/notices and mark changes if copying. No code copied. | Elixir/OTP reference orchestrator launching Codex app-server in per-issue workspaces. Reference docs explicitly call it prototype/evaluation software. Workspaces alone do not prove container/network isolation. | Current reference docs include GitHub Issues tracker and github_api tool, as well as Linear/Jira/Asana/GitLab. GitHub tracker support does not prove our no-auto-merge, isolated delivery and durable lease requirements. | Needs Codex runtime and authorized access/entitlements plus tracker credentials; source license is not a free inference entitlement. No paid invocation made. | Defer: useful orchestration reference, but replaces/duplicates core orchestration and requires another execution/auth stack. |
| langchain-ai/open-swe `15567c6004de5691646ac692bb1ab27eff036f8b` | MIT for Robin's own code; README explicitly excludes vendor/ from this repository's license. Do not assume vendored code has MIT terms. | Current README identifies **Robin**, built on Deep Agents/LangGraph. Documented as-is agent execution requires Managed Deep Agents; own runtime needs adaptation. Local execution explicitly does not provide cloud sandbox isolation. | GitHub App, issues/PR integrations and delivery described. Installation warns coding sandboxes normally receive installation-wide App access; repository bindings do not narrow credentials. | Installation describes LangSmith/LLM Gateway, GitHub App and Slack secrets; standalone setup adds PostgreSQL/Redis and LangGraph license/configuration requirements. Fees/entitlements unverified; no service provisioned. | Defer: broad platform dependency and credential footprint beyond the first local bounded pilot. |

### Immutable sources

- [OpenHands README](https://github.com/OpenHands/OpenHands/blob/f16d9d992f7dcf2326802f3e30517fdfb98881e9/README.md), [LICENSE](https://github.com/OpenHands/OpenHands/blob/f16d9d992f7dcf2326802f3e30517fdfb98881e9/LICENSE), [self-hosting](https://github.com/OpenHands/OpenHands/blob/f16d9d992f7dcf2326802f3e30517fdfb98881e9/docs/SELF_HOSTING.md).
- [Symphony README](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/README.md), [LICENSE](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/LICENSE), [reference runtime](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/elixir/README.md).
- [Open SWE / Robin README](https://github.com/langchain-ai/open-swe/blob/15567c6004de5691646ac692bb1ab27eff036f8b/README.md), [LICENSE](https://github.com/langchain-ai/open-swe/blob/15567c6004de5691646ac692bb1ab27eff036f8b/LICENSE), [installation](https://github.com/langchain-ai/open-swe/blob/15567c6004de5691646ac692bb1ab27eff036f8b/docs/INSTALLATION.md).

This is a source-level suitability and license/dependency screening, not a legal opinion or a successful runtime adoption test.

## Implemented transport

```js
import {ollamaGenerator, ProviderError} from './src/ollama.mjs';
const generate = ollamaGenerator({
  model: 'qwen2.5-coder:0.5b', port: 11434, timeoutMs: 120000
});
const candidate = await generate({source, goal, signal});
```

- Same public signature and return type as coordination v1; B chooses the trusted source path. The returned string is complete revised source, not a command or path.
- Fixed `http://127.0.0.1:<port>/api/generate`; redirects rejected; no remote endpoint or key configuration. Operator must ensure the local Ollama server itself uses local models: a loopback endpoint alone cannot prove this. This run used `OLLAMA_NO_CLOUD=1`.
- Limits: 65536 input bytes (source+goal), 65536 candidate bytes, 262144 response bytes, configurable deadline 1..300000ms. Empty goal/candidate, malformed JSON/UTF-8 and incomplete generation rejected.
- Deadline covers waiting for fetch and body consumption, including noncooperative injected fetch/read fixtures. Reader/body cancellation is attempted without waiting on a hung cancel callback. Timer cleared and reader lock released on completion/failure.
- Caller AbortSignal reason is preserved. Provider errors use a fixed message and `ProviderError.code`, not raw provider text or model contents.
- Error codes: INVALID_CONFIG, INVALID_REQUEST, UNAVAILABLE, HTTP_ERROR, MISSING_RESPONSE, RESPONSE_ERROR, RESPONSE_TOO_LARGE, INVALID_JSON, INCOMPLETE_GENERATION, INVALID_CANDIDATE, TIMEOUT.
- UNAVAILABLE/HTTP_ERROR/TIMEOUT are transport/service failures, not evidence that the coding task is wrong. E/D decide retry accounting. A cancelled HTTP request does not itself prove server-side inference stopped.

## Verification performed

Environment: Node v24.22.3 / npm 11.19.1, CPU execution. Local tests required an execution grant for loopback socket access; first restricted run exposed EPERM and was not counted as success.

```sh
node --test --test-isolation=none --test-reporter=tap test/ollama.test.mjs test/provider-contract.test.mjs test/provider-probe.test.mjs
# 31 tests: 31 pass, 0 fail, 0 cancelled, 0 skipped

node --test --test-isolation=none --test-reporter=tap
# 58 tests: 55 pass, 0 fail, 0 cancelled, 3 skipped (Docker)

git diff --check
# exit 0
```

The provider suite includes synthetic fetch/stream failures, real loopback HTTP request/response, unavailable service, stalled body deadlines and redirect rejection. All loopback test servers are synthetic, not model inference. Probe tests verify evidence handling without executing candidate code.

Source SHA-256 values used for the live probe:
- src/ollama.mjs: `7e8f100077cc9c3aa8a48a880de63eb4d480aa72425ea43aef3cfe850f6a6f25`
- scripts/provider-live.mjs: `5600275ed71da919278ec13523befecf42e3d0ef2ceb140b5b5188cde19c5cd0`

Local TAP transcripts are retained at /workspace/a-provider/evidence-provider.tap and evidence-tests.tap. CI on the delivery PR supplies remote reproducible test logs; inspect its exact head and merge checkout SHA before using those as evidence. Local Docker integration was not run. F must independently review/re-run tests; A's own test result is not independent acceptance.

## Actual model probe

A real Ollama 0.40.18 process was started from the official Linux release, and `qwen2.5-coder:0.5b` pulled from the official registry. Ollama verified model blob SHA-256 values. `/api/show` reports GGUF, qwen2, 494.03M parameters, Q4_K_M, and an Apache-2.0 license text for this model. Actual model manifest digest and generated candidate follow.

The fixed public fixture explicitly asks for the desired revised source. This proves transport, structured generation and exact-text checking; it is not an independent coding-quality benchmark. Candidate code was not executed. This does not prove repository repair, isolated tests, GitHub delivery, two agents, recovery or 24/7 operation.

```json
[
  {
    "version": 1,
    "kind": "provider-probe",
    "passed": true,
    "startedAt": "2026-11-25T03:12:27.004Z",
    "finishedAt": "2026-11-25T03:12:32.881Z",
    "nodeVersion": "v24.22.3",
    "provider": "ollama-loopback",
    "serverVersion": "0.40.18",
    "model": "qwen2.5-coder:0.5b",
    "modelDigest": "4ff64a7f502a08b7616edb8ca0a79eb1853fc363d842b7df4b46915d11a3fb09",
    "elapsedMs": 5760,
    "fixture": "single-source-add-exact-text",
    "sourceSha256": "5b01ee484093664f8263c230f9392950fa0df219c62e9a894d1affb45e1e8370",
    "candidate": "export function add(a, b) { return a + b; }",
    "candidateSha256": "c4b7a01cbde242bf0e133e7afefc62e73fffdac917b0efd9cb40f26ed25d26f0",
    "expectedSha256": "c4b7a01cbde242bf0e133e7afefc62e73fffdac917b0efd9cb40f26ed25d26f0",
    "checks": {
      "structuredCandidate": true,
      "exactFixtureText": true
    },
    "limits": {
      "inputBytes": 65536,
      "candidateBytes": 65536,
      "responseBytes": 262144,
      "timeoutMs": 120000
    },
    "codeExecuted": false,
    "repositoryRepairVerified": false,
    "serverSideCancellation": "not-verified"
  },
  {
    "kind": "live-provider-fault-probe",
    "checks": [
      {
        "name": "missing-model",
        "passed": true,
        "code": "HTTP_ERROR"
      },
      {
        "name": "caller-cancel",
        "passed": true,
        "elapsedMs": 108
      }
    ],
    "serverSideCancellation": "not-verified",
    "codeExecuted": false
  }
]
```

The two JSON records are separate observations: successful generation, then live missing-model rejection and caller cancellation. Client cancellation returned within 108ms; server-side cancellation remains unverified.

### Runtime setup in this workspace

The default /home/agent/.ollama directory was read-only even with a requested write grant. The installed application and model data stay under /workspace/a-provider. PRoot maps that program's expected state directory to a workspace directory without changing HOME or globally installing a service. It is path translation for the smoke runtime, NOT the candidate-code sandbox or a security boundary.

Runtime: official Ollama release `v0.40.18`.
Path translator: official proot-me/proot `v5.5.0`; downloaded executable matched published SHA256SUMS:
`db185300a9daabbce86aca7632d8c7fdc4249f6f153171954013b70c5f491ec0`.

On an ordinary writable local development host PRoot is unnecessary. Use an already installed Ollama server and an explicitly selected model; downloading/installing binaries or models is not performed automatically by repository scripts.

Workspace-only launch used:
```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=/workspace/a-provider/models OLLAMA_NO_CLOUD=1 \
  /workspace/a-provider/proot -b /workspace/a-provider/ollama-state:/home/agent/.ollama \
  /workspace/a-provider/ollama/bin/ollama serve
```

Reproduce the bounded probe against that server, or any operator-managed local Ollama with the model installed:
```sh
OLLAMA_MODEL=qwen2.5-coder:0.5b OLLAMA_TIMEOUT_MS=120000 \
  node scripts/provider-live.mjs /path/to/new-provider-evidence.json
```

The output file is created exclusively (existing files are not overwritten); stdout contains the same JSON. Exit 0 means the exact fixture text matched; exit 1 means probe failure. It never runs the generated text. A synthetic endpoint could imitate the metadata, so provenance requires the operator's controlled runtime and installed model, not JSON fields alone.

No paid model API or hosted service was invoked. Infrastructure/CPU/storage costs and future hosted inference fees are not measured or guaranteed zero. This workspace service is temporary and not a hosted or persistent 24/7 deployment.

## Next owners and remaining gates

- B can consume the Generate interface immediately and must implement real repository patching; do not use this exact-text probe as repository acceptance.
- E supplies project execution isolation, kill/recovery cleanup and server-side lifecycle policy.
- F owns independent acceptance and must distinguish a local smoke model from a production model decision.
- C delivers only a reviewed repository artifact and links CI to exact commits.
- Upstream adoption and production model selection await independent review and representative repair tests. No G2/G3/G4/G5/G6 acceptance is asserted here.
