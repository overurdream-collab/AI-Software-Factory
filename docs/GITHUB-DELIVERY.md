# GitHub delivery — C
## Host authentication
Register a dedicated private GitHub App (not the ChatGPT connector), install only on explicitly authorized repositories. Repository permissions: Contents read/write, Pull requests read/write, Issues read, Checks read, Metadata read. Disable webhooks if unused. No Administration, Workflows write or organization permissions. Organization approval/rulesets still apply.
Keep App ID, installation ID and PEM private key in trusted host secret storage. Never pass them to candidate containers, model prompts, logs or repository files. No default GITHUB_TOKEN fallback.
```js
import {readFile} from 'node:fs/promises';
import {githubAppTokenProvider,githubRemote} from './src/github-delivery.mjs';
const allowlist = ['overurdream-collab/AI-Software-Factory'];
const tokenProvider = githubAppTokenProvider({
 appId: process.env.FACTORY_GITHUB_APP_ID,
 installationId: process.env.FACTORY_GITHUB_INSTALLATION_ID,
 privateKey: await readFile(process.env.FACTORY_GITHUB_PRIVATE_KEY_FILE),
 allowlist
});
const remote = githubRemote({tokenProvider,allowlist});
```
On a trusted Actions job the coordinator may supply the PEM from a repository/environment secret instead of a file. C does not change workflows. Confirm installation approval and permissions before live testing; 403 diagnostics expose status and accepted-permissions header, not response body or credentials. A 403 may also reflect rate limits or policy; do not bypass policy. No automatic merge.
## Delivery
intakeIssue uses D's enqueueSpec; deliverDurable uses D's reservation and independent stored review; prepareRemotePatch uses B's clean workspace helpers, applies reviewed patch and verifies tree before REST blob/tree/commit creation. Stable branch and PR reconciliation; pending checks remain pending. Head-only check policy fails closed for merge-test SHA. No network inside SQLite transaction.
## Verification status
Previous head 7dbc376463e730eb1c2777ab38e4d4a932ebfa7a: Factory CI 45541758665 and Isolated execution pilot 45541758583 reported success. New auth tests use generated local RSA key and fake fetch; no live credentials. App registration, installation and secret provisioning require owner action; connector cannot do these. Actual independent factory PR creation, D SQLite crash recovery, and F live acceptance remain unverified. Do not confuse C's connector-created PR #5 with factory delivery.

## Verified CI — authentication increment
Head c559e32abba47ba5871f97a2ec078458fdd2f9df, PR test merge 177b7338cc966e1d354d27f46d59926571ac3fef. Factory CI 45547102819 job 138979247461: 40 tests, 37 pass, 0 fail, 3 skipped. Both authentication tests passed (fake HTTP transport). Isolated execution pilot 45547102816 job 138979247153: 3 pass, 0 fail, 0 skipped. Dedicated app credentials remain unprovisioned/unverified; no claim of live PR creation or resolution of actual 403.
