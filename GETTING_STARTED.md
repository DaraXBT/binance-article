# xArticle Getting Started

The application interface is English-only. Source articles and generated image
labels can remain in the language supplied by the user.

## Join and sign in

1. Open the private invitation link from the owner.
2. Enroll with the invited Google account.
3. Sign in with Google on later visits.

Private pages redirect logged-out visitors to `/login`. Suspended and revoked accounts remain disabled even if an old browser session or publisher-device token still exists.

## Create or claim a workspace

New users choose **Create workspace**. The workspace is attached to the account immediately; there is no new recovery key to save.

Users migrating an older browser-based workspace may choose **Recover existing workspace** and enter its original `dwk_...` key. This is a one-time claim available only during the 30-day migration window. Unknown, expired, and already-used keys all return the same response.

## Create an article

From the dashboard or `/new`:

1. Enter source text, a topic prompt, or a URL.
2. Select slide count and illustration style.
3. If generation locking is enabled, enter the one-time generation grant from the owner.
4. Start generation and wait for the background job.
5. Review and edit slides, captions, images, and the dedicated cover in
   `/articles/[id]`.

`binance-master` is the default illustration system. It automatically chooses
one Scene, Mechanism, Briefing, or Primer register per image; another available
style can be selected explicitly before generation.

A full generation automatically attempts every slide image and one dedicated
article cover. The cover is a separate wide source image designed for the
Binance 5:2 safe frame and output, not the first slide. If slide images fail,
**Retry failed images** retries all failed slides in one job; retry the cover
separately. When an existing image is available, it stays visible behind the
generation loader during regeneration.

Generation grants bind to the verified account session and workspace. They do not replace account authentication.

## Use your own Gemini key (workspace owner)

Open **Settings → Connections** and use the **Gemini connection** card. Paste a
key from Google AI Studio, save it, and use **Test connection** if you want to
verify it again. Saving does not switch generation automatically: choose
**Workspace Gemini key** under **Generation source** to activate it. Choose
**Platform credits** to switch back. Replacing preserves the current selection;
deleting removes xArticle’s encrypted copy but does not revoke the key at Google.

Workspace members see that the connection is managed by the owner and can use
the active source without seeing any key material.

The Gemini connection affects prompt, article, slide-image, and cover
generation only. Binance/X posting still uses the separately paired local
publisher companion and never receives the Gemini key.

## Publish to Binance Square

1. Open **Settings → Connections**, install the local publisher companion by
   following its [installation guide](./publisher-companion/README.md), and pair
   it using the one-time code shown by the web app.
2. Start the companion. On first use, sign in to Binance manually in the
   companion-managed Chrome profile it opens; that local profile keeps the
   session for later runs.
3. Generate the dedicated cover if it is not ready, then prepare the Binance
   publication from the article studio.
4. Review the exact title, body, cover, images, device, and revision.
5. Approve from the web app.
6. Let the companion perform the single final click.

The companion stores its device token in the operating-system keyring. Binance cookies, Chrome data, and local drafts remain on that computer. If Binance's result is ambiguous, the command ends as `outcome_unknown`; create a new reviewed command only after checking Binance manually.
Before the final click begins, you can safely cancel the prepared publication from the same review panel. Expired commands close automatically and must be prepared again.

## Publish a regular X post

1. Start the paired companion. On first use, sign in to X manually in the
   companion-managed Chrome profile it opens; that local profile keeps the
   session for later runs.
2. Open the article's **X post** dialog, review one caption and up to four
   selected images, then choose **Prepare on X**.
3. Inspect the live X composer opened by the companion.
4. Approve the exact revision in the web app.
5. The companion revalidates the composer and performs one Post click.

Success requires an exact canonical `https://x.com/<handle>/status/<id>` URL.
If the result cannot be verified, the command ends as `outcome_unknown` and is
not retried.

## Companion and fallback files

The paired companion posts directly from its authenticated, companion-managed
local Chrome publishing profiles; no ZIP is required for that normal path.
Versioned companion ZIPs are only for installing the companion on another
computer. The **Download fallback ZIP** actions are optional manual recovery
paths when the companion is not available and must stay on the user's computer.

Active and pending devices are listed under **Settings → Connections**. Revoke
a lost or replaced device there; a revoked companion must be paired again.

## Common issues

- **Login is rejected:** use the invited Google account.
- **Account disabled:** contact the owner; old sessions and paired devices cannot bypass suspension.
- **Generation locked:** request a fresh one-time generation grant.
- **Legacy key unavailable:** the key is malformed, expired, already consumed, or belongs to a workspace that was already claimed.
- **Publisher asks to pair again:** the device token was revoked or its account/membership is no longer active.
- **Publisher appears offline:** start the companion and confirm `bun run doctor`
  has no blocking errors.
- **Cover is required:** generate the dedicated article cover before preparing
  a Binance Square command.
- **Outcome unknown:** inspect the social platform manually before creating a
  new reviewed command; never retry the old click automatically.

For system boundaries and state transitions, see
[docs/architecture.md](./docs/architecture.md).
