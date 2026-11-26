# AI Virtual Headquarters
Status: foundation prototype, not live operations.
Arabic-first management layer; existing factory remains independently owned.
## Scope
Owner -> executive -> departments: software factory, marketing, research, design, knowledge, finance, security, independent QA.
Phase 1: project registry, bounded task intake, explicit approval, evidence-based status, read-only factory adapter. No paid calls, deployments, automatic merges or cross-repository writes.
## Architecture
Node/TypeScript or JS service, PostgreSQL eventual durable registry, React RTL dashboard, optional Three.js low-poly view. Start dependency-free domain policy; do not duplicate factory scheduler or state store.
Factory adapter must map actual TaskSpec and delivery records from the coordinated factory version, pin base commit, allowlisted repository and paths, trusted test plan and limits. Unknown or unavailable backend is blocked, not running. Accepted is not delivered; delivered requires independent acceptance evidence and matching commit/checks.
## Milestones
VHQ-01 foundation; 02 authorization and executive; 03 durable projects/tasks; 04 factory adapter contract tests and authorized live pilot; 05 authenticated dashboard; 06 optional 3D; 07 additional departments; 08 hosted recovery and acceptance.
## Governance
Default deny. Owner grants scoped repository/action/budget/expiry approval. No credentials in prompts or logs. External inputs untrusted. Separate implementation/review. Explicit approval for paid usage, production, destructive operations and merges. Audit all transitions. Do not expose other projects until authorized. No percentage without measurable criteria.
## Local policy tests
node --test vhq/policy.test.mjs
The initial policy is an in-process prototype, not authentication, persistence or a live adapter. No external action is performed.

## Owner decision — 2026-11-26: validation-first providers
Use Codex within existing subscription allowance for coding and tests. DeepSeek free chat may assist manual analysis of sanitized non-sensitive inputs; it is not an authenticated automated API. Enable a DeepSeek API adapter only with verified free credits or explicitly approved funding. Default additional spend: USD 0. No automatic paid fallback, purchased credits, or paid hosting. On quota exhaustion persist task and mark blocked/queued; never bypass service limits. Provider routing must be replaceable; keep secrets outside logs and repositories. Validate actual Codex dispatch and model access before declaring autonomous operation. Add providers only against measured bottlenecks and owner-approved budgets. This decision applies to VHQ; coordinated factory implementation files remain untouched.

## Supplemental execution strategy — OpenCode
OpenCode is an additional execution client, not a model. Prefer Codex for complex changes and OpenCode with verified zero-price models (including DeepSeek free variants where available) for bounded tasks. OpenRouter free models are optional after eligibility, privacy and quality checks. Resolve exact model IDs from official catalogs at runtime; allowlist zero-cost routes only, prohibit paid fallback and auto top-up, and fail closed on unknown pricing. Trial credits may be used only with hard no-charge controls and verified expiry/balance. On 429 or exhaustion, persist work and rotate to another authorized free route or queue. Treat generated patches as untrusted and require independent tests. Do not send confidential customer data to free providers without explicit authorization. Implementation and live quota verification pending; no claims of actual connectivity. References: https://opencode.ai/docs/console/models/ and https://openrouter.ai/collections/free-models/.
