# xArticle Getting Started

The application interface is English-only. Source articles and generated image
labels can remain in the language supplied by the user.

## Join and sign in

1. Open the private join link from an xArticle administrator, or open `/join`
   and enter its access code. The shared code grants application access; it
   does not grant access to the administrator's articles.
2. Continue with Google. Enrollment creates a separate personal account and
   article library automatically.
3. Sign in with Google on later visits.

Private pages redirect logged-out visitors to `/login`. Suspended and revoked accounts remain disabled even if an old browser session or publisher-device token still exists.

## Open your personal library

After enrollment, xArticle opens `/workspace` directly. Despite the route name,
there is no workspace to create or select and no account key prefix to manage.
The internal personal data scope is derived from the signed-in account.

When the server confirms that a pristine account can still receive legacy data,
the account menu shows **Import old data**. Enter the original `dwk_...` key to
perform the one-time import. Unknown, expired, and already-used keys all return
the same response. The import choice appears before a resumed public draft can
write its first article.

## Open account settings

Use the account control pinned at the bottom of the article rail, then select
**Settings**. This opens the responsive **Connections** panel, where users
manage their Gemini key and publisher devices; xArticle administrators also
manage enrollment and account access. When the
desktop rail is icon-only, the account menu opens beside its avatar; it remains
inside the full profile row when the rail is expanded or on mobile.

## Create an article

From the dashboard or `/new`:

1. Enter source text, a topic prompt, or a URL. On `/new`, switch between
   **Paste text**, **Import URL**, and **Topic prompt** with the tabs on the
   first step; imported URLs must be HTTPS without embedded credentials.
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

Generation grants bind to the verified account session and its internal personal tenant. They do not replace account authentication.

## Use your own Gemini key

Open **Settings → Connections** and use the **Gemini connection** card. Paste a
key from Google AI Studio, save it, and use **Test connection** if you want to
verify it again. Saving does not switch generation automatically: choose
**Your Gemini key** under **Generation source** to activate it. Choose
**Platform credits** to switch back. Replacing preserves the current selection;
deleting removes xArticle’s encrypted copy but does not revoke the key at Google.

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
3. Open the Binance publishing dialog and choose **Post** or **Article**. A Post
   may contain text, one to four images, or both. An Article requires a title
   and body; its cover and zero to ten body images are independently optional.
4. Review the exact text or title/body, optional media, device, and revision.
5. Approve from the web app.
6. Let the companion perform the single final click.

The companion stores its device token in the operating-system keyring. Binance cookies, Chrome data, and local drafts remain on that computer. If Binance's result is ambiguous, the command ends as `outcome_unknown`; create a new reviewed command only after checking Binance manually.
Before the final click begins, you can safely cancel the prepared publication from the same review panel. Expired commands close automatically and must be prepared again.

## Publish to X

1. Start the paired companion. On first use, sign in to X manually in the
   companion-managed Chrome profile it opens; that local profile keeps the
   session for later runs.
2. Open the X publishing dialog and choose **Post** or **Article**. A Post may
   contain up to 280 characters, one to four images, or both. An Article
   requires a title and body; its cover and zero to ten body images are
   independently optional. X Articles also require account entitlement.
3. Inspect the live X Post composer or Article editor opened by the companion.
4. Approve the exact revision in the web app.
5. The companion revalidates the exact editor snapshot and performs one publish
   click.

Success requires an exact canonical `https://x.com/<handle>/status/<id>` Post
URL or `https://x.com/i/article/<id>` Article URL. If the result cannot be
verified, the command ends as `outcome_unknown` and is not retried.

## Companion and fallback files

The paired companion posts directly from its authenticated, companion-managed
local Chrome publishing profiles; no ZIP is required for that normal path.
Versioned companion ZIPs are only for installing the companion on another
computer. The **Download fallback ZIP** actions are optional manual recovery
paths when the companion is not available and must stay on the user's computer.

Active and pending devices are listed under **Settings → Connections**. Revoke
a lost or replaced device there; a revoked companion must be paired again.

## Common issues

- **New-user sign-in is rejected:** choose **Join with an access code**; normal
  sign-in intentionally accepts existing accounts only.
- **Account disabled:** contact an xArticle administrator; old sessions and paired devices cannot bypass suspension.
- **Generation locked:** request a fresh one-time generation grant.
- **Legacy key unavailable:** the key is malformed, expired, already consumed, or belongs to data that was already imported.
- **Publisher asks to pair again:** the device token was revoked or its account is no longer active.
- **Publisher appears offline:** start the companion and confirm `bun run doctor`
  has no blocking errors.
- **Publisher upgrade required:** install the latest companion and pair the
  device again so it advertises protocol version 2.
- **X Article unavailable:** sign in to X in the managed profile and confirm the
  publishing account has X Articles entitlement. Regular X Posts remain usable.
- **Outcome unknown:** inspect the social platform manually before creating a
  new reviewed command; never retry the old click automatically.

For system boundaries and state transitions, see
[docs/architecture.md](./docs/architecture.md).
