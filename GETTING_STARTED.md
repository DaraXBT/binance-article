# xArticle Getting Started

This guide is for a tester or end user using a running xArticle instance.

## Entry Flow

### If the app is protected

1. Open `/`
2. Enter the app access code on `/access`
3. After success, you will land on `/workspace`

### Workspace choice

On the workspace screen you will see two choices:

- `Create new key`
  - Creates a new workspace for this browser
  - Shows a one-time recovery key
- `Use existing key`
  - Reconnects this browser to an existing workspace using its recovery key

Save the recovery key if you create a new workspace. That is how you reconnect from another browser later.

## Dashboard Flow

After a workspace is attached, you will reach the dashboard.

From there you can:

- Draft an article prompt directly on the homepage
- Open `/new` for the guided article flow
- Open existing articles from the sidebar

## Generation Lock Flow

If the admin enabled generation locking:

- The dashboard still opens normally
- AI generation actions are visible but disabled
- You must unlock the browser with the latest article access code from the admin

Once unlocked, the same browser session can:

- Generate from the homepage
- Generate from `/new`
- Retry failed images from an article page

If the admin rotates the generation secret, the browser will lose generation access on the next protected request and must be unlocked again with a fresh code.

## Create an Article from the Dashboard

1. Enter or paste your topic/prompt into the homepage composer
2. Optionally use `AI Suggest`
3. Choose slide count and illustration style
4. Click `Generate article`

You will be taken to the article page after generation starts.

## Create an Article from `/new`

`/new` supports multiple creation modes.

### Prompt mode

Use it when you want AI to help shape the article instructions before generation.

### Text mode

Use it when you already have article content.

### URL mode

Use it when you want xArticle to fetch and process a webpage as the source.

In all cases:

1. Fill in the source content
2. Choose illustration style and slide count
3. Open the generate step
4. Unlock generation if needed
5. Wait for the workflow to finish

## Article Page

On `/articles/[id]` you can:

- Review generated slides
- Edit titles, bullets, notes, and order
- Preview the current slide
- Review blog and X captions
- Retry failed images
- Delete the article

If generation locking is enabled, `Retry Failed Images` also requires the browser to be unlocked.

## What the Three Keys Mean

### App access code

- Gets you into the app
- Shared gate at `/access`

### Workspace recovery key

- Reattaches a browser to a workspace
- Chosen through `Create new key` or `Use existing key`

### Article access code

- Unlocks token-spending generation for this browser session
- Provided by the admin
- One-time and browser/session-bound

## Common Problems

### I can open the dashboard but cannot generate

The browser has not been unlocked for generation yet, or the admin rotated the generation secret.

### My old article access code no longer works

The admin likely rotated `GENERATE_ACCESS_CODE`. Request a new invite code.

### I lost my workspace after opening a new browser

Recover it with the saved workspace recovery key.
