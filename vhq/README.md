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
