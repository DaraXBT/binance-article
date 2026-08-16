# Account Gemini connections

xArticle supports Gemini “bring your own key” (BYOK) for each personal account. The
feature is deliberately narrow: Gemini is the only user-managed provider in v1;
the DeepSeek path is dormant internal compatibility, and model names remain
operator-controlled.

## What a user does

1. From the dashboard, open the account control at the bottom of the article
   rail and select **Settings**, then open **AI & generation** in **Account
   settings**.
2. The user pastes a Gemini API key into the **Gemini connection** card.
   The field is a password input and is cleared immediately after submission.
3. xArticle checks the key against the configured Gemini text and image models.
   A key that cannot access either model is not saved.
4. After a successful save, **Platform credits** remains selected. The user
   explicitly chooses **Your Gemini key** when ready to use it.
5. **Test connection** rechecks the encrypted key. **Replace** validates and
   rotates it while preserving the current source selection. **Delete key**
   removes xArticle’s encrypted copy and returns generation to platform credits;
   it does not revoke the key at Google.

The product has no shared-workspace member role. Credential management belongs
to the signed-in personal account; server authorization still requires the
account's owner membership in its internal tenant namespace.

## How generation chooses a key

At the beginning of each prompt request or Workflow job, the server resolves
the authoritative internal workspace ID from the authenticated actor or
`JobRun`. The
resolver uses this order:

| Internal credential state | Key used |
|---|---|
| No saved row | Platform `GEMINI_API_KEY`; `GOOGLE_API_KEY` is runtime compatibility only and does not satisfy deployment preflight |
| Saved row, source is Platform | Platform key |
| Saved row, source is Workspace | Decrypted personal key |
| Credential lookup cannot establish workspace state | Fail closed; never assume the row is absent or fall back |
| Enabled row cannot be decrypted or validated | Fail closed; never fall back |

Within one request or Workflow attempt, the resolved key stays in Worker memory
and is passed explicitly to text, every slide image, the cover, and
user-triggered slide/cover retry jobs. A key rotation or deletion affects
attempts that have not resolved their credentials yet. A Cloudflare step retry
is a new invocation and resolves the source again; an already-running attempt
keeps its in-memory configuration. Workflow events remain strictly
`{ jobId, kind }`, and keys never enter job payloads, logs, results, or errors.

Generation access checks, rate limits, slide limits, storage safeguards, and
provider timeouts still apply to personal keys. A platform quota error suggests
switching to **Your Gemini key**; a personal-key error suggests **Test/Replace** or
switching back to platform credits.

## Operator configuration

Both the OpenNext web Worker and the article Workflow Worker need the same
versioned AES keyring:

- `AI_CREDENTIAL_KEYRING`: JSON mapping a key ID such as `v1` to an unpadded
  base64url-encoded 32-byte AES-256 key.
- `AI_CREDENTIAL_ACTIVE_KEY_ID`: the ID used for new encryptions.
- `GEMINI_API_KEY`: the platform fallback, still required even when BYOK is
  enabled.
- `GEMINI_TEXT_MODEL` and `GEMINI_IMAGE_MODEL`: keep these model values
  identical on both Workers; validation and generation use the same pair.

Generate a keyring value in an approved operator shell. The command output is
itself sensitive encryption-key material: capture it directly into the approved
secret manager and do not retain it in terminal logs, chat, or source control.

```bash
node -e "console.log(JSON.stringify({v1:Buffer.from(require('crypto').randomBytes(32)).toString('base64url')}))"
```

Provision the exact same keyring and active ID to both Workers before applying
the migration. Keep old key IDs during a rotation so existing rows can be
decrypted. After verifying a backup, add the new key ID to the keyring, set it
as active, and deploy that keyring to both Workers. Then rewrap old rows with
the guarded operator command:

```bash
ALLOW_AI_CREDENTIAL_REWRAP=1 \
CONFIRM_AI_CREDENTIAL_REWRAP_BACKUP=1 \
CONFIRM_AI_CREDENTIAL_WRITERS_UPDATED=1 \
OPERATOR_DATABASE_URL='postgresql://...' \
AI_CREDENTIAL_KEYRING='{"v1":"...","v2":"..."}' \
AI_CREDENTIAL_ACTIVE_KEY_ID='v2' \
npm run ai-credential:rewrap
```

The command uses compare-and-swap updates, processes bounded batches, performs
an authoritative final count of old-key rows, and never prints plaintext,
ciphertext, nonces, or key values. It fails if any old-key row remains. Retire
an old key ID only after the command succeeds and both Workers are confirmed to
use the new keyring.

## Initial feature deployment order

1. Provision `AI_CREDENTIAL_KEYRING` and `AI_CREDENTIAL_ACTIVE_KEY_ID` to both
   Workers; keep the platform Gemini key present.
2. Apply additive migration `0015_workspace_ai_credential`.
3. Deploy the Workflow Worker.
4. Deploy the web Worker and Account settings UI.

That sequence describes the original additive `0015` launch. For an existing
production database, select the procedure from its migration ledger. In
particular, a database ending at `0016` must apply and verify only `0017` from
an exact CI-green 0017-only checkout, then apply and verify only `0018` from the
exact final checkout before deploying the Workflow Worker and web Worker. Follow
the dedicated [0017 cutover](./cutover-0017-runbook.md) and
[0018 repair](./cutover-0018-runbook.md) runbooks; never let one migration
command apply both pending migrations.

No saved key is active until its user explicitly selects **Your Gemini key**, so
deploying the feature does not change existing generation behavior. The
database/source enum remains `workspace` for compatibility.
