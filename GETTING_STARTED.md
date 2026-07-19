# xArticle Getting Started

## Join and sign in

1. Open the private invitation link from the owner.
2. Enroll with the invited Google account.
3. Sign in with Google on later visits.
4. Optionally link Telegram from `/settings/connections`; Telegram cannot create an account.

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
5. Review and edit slides, captions, and images in `/articles/[id]`.

Generation grants bind to the verified account session and workspace. They do not replace account authentication.

## Publish to Binance Square

1. Install and pair the local publisher companion using the one-time code shown by the web app.
2. Keep Chrome open with Binance already signed in.
3. Prepare the Binance publication from the article studio.
4. Review the exact title, body, cover, images, device, and revision.
5. Approve from the web app or a linked private Telegram chat.
6. Let the companion perform the single final click.

The companion stores its device token in the operating-system keyring. Binance cookies, Chrome data, and local drafts remain on that computer. If Binance's result is ambiguous, the command ends as `outcome_unknown`; create a new reviewed command only after checking Binance manually.

## Common issues

- **Login is rejected:** use the invited Google account or a Telegram identity previously linked to it.
- **Account disabled:** contact the owner; old sessions and paired devices cannot bypass suspension.
- **Generation locked:** request a fresh one-time generation grant.
- **Legacy key unavailable:** the key is malformed, expired, already consumed, or belongs to a workspace that was already claimed.
- **Publisher asks to pair again:** the device token was revoked or its account/membership is no longer active.
