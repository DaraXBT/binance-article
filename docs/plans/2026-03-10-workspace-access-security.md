# Workspace Access Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal access-code gate for private app usage and restore a compact workspace security card on the dashboard so users can save or recover their workspace key.

**Architecture:** Keep the existing per-workspace recovery-key system in `lib/workspace.ts` as the source of truth for workspace ownership and recovery. Add a separate optional app-level access code from env for first-entry gating, implemented with one small helper module, one API route that sets an httpOnly cookie, one redirecting middleware, and a compact dashboard security card that reuses the existing workspace bootstrap and recovery APIs.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Next middleware, TanStack Query, Vitest, Tailwind CSS

---

### Task 1: Add optional app-access helpers and verification API

**Files:**
- Create: `lib/app-access.ts`
- Create: `app/api/access/route.ts`
- Create: `app/api/access/route.test.ts`

**Step 1: Write the failing API test for a valid access code**

In `app/api/access/route.test.ts`, add a test that sets `process.env.APP_ACCESS_CODE = 'ANGEL'`, calls the POST handler with `{ code: 'ANGEL' }`, and expects:
- status `200`
- body `{ success: true }`
- a `set-cookie` header for the app-access cookie

Use this shape:

```ts
it('accepts the configured app access code and sets the access cookie', async () => {
  process.env.APP_ACCESS_CODE = 'ANGEL';

  const { POST } = await import('@/app/api/access/route');
  const response = await POST(
    new Request('http://localhost/api/access', {
      method: 'POST',
      body: JSON.stringify({ code: 'ANGEL' }),
    }) as never
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ success: true });
  expect(response.headers.get('set-cookie')).toContain('deckforge_app_access');
});
```

**Step 2: Write the failing API test for an invalid access code**

In the same file, add a second test that posts `{ code: 'WRONG' }` and expects:
- status `400`
- body `{ error: 'Invalid access code' }`
- no access cookie to be set

```ts
it('rejects an invalid app access code', async () => {
  process.env.APP_ACCESS_CODE = 'ANGEL';

  const { POST } = await import('@/app/api/access/route');
  const response = await POST(
    new Request('http://localhost/api/access', {
      method: 'POST',
      body: JSON.stringify({ code: 'WRONG' }),
    }) as never
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: 'Invalid access code' });
  expect(response.headers.get('set-cookie')).toBeNull();
});
```

**Step 3: Run the new API test file to verify it fails**

Run: `npm test -- app/api/access/route.test.ts`
Expected: FAIL because `app/api/access/route.ts` and `lib/app-access.ts` do not exist yet.

**Step 4: Write the minimal helper module**

Create `lib/app-access.ts` with:
- a cookie name constant
- a helper that reads `process.env.APP_ACCESS_CODE?.trim()`
- a helper that tells whether the app gate is enabled
- a helper that compares a submitted code against the configured code after trimming
- a helper that writes the httpOnly cookie to a `NextResponse`
- a helper that checks the cookie from `NextRequest`

Use this minimal shape:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

export const APP_ACCESS_COOKIE_NAME = 'deckforge_app_access';

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function getConfiguredAppAccessCode() {
  return process.env.APP_ACCESS_CODE?.trim() ?? '';
}

export function isAppAccessEnabled() {
  return getConfiguredAppAccessCode().length > 0;
}

export function isValidAppAccessCode(input: string) {
  const configured = getConfiguredAppAccessCode();
  return configured.length > 0 && input.trim() === configured;
}

export function grantAppAccess(response: NextResponse) {
  response.cookies.set(APP_ACCESS_COOKIE_NAME, hashValue(getConfiguredAppAccessCode()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export function hasGrantedAppAccess(request: NextRequest) {
  const configured = getConfiguredAppAccessCode();
  if (!configured) {
    return true;
  }

  return request.cookies.get(APP_ACCESS_COOKIE_NAME)?.value === hashValue(configured);
}
```

**Step 5: Write the minimal API route**

Create `app/api/access/route.ts` that:
- reads `{ code }` from `request.json()`
- trims the input
- returns `400` for invalid code
- returns `200` and sets the access cookie for valid code

Use this minimal shape:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { grantAppAccess, isValidAppAccessCode } from '@/lib/app-access';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const code = typeof body?.code === 'string' ? body.code : '';

  if (!isValidAppAccessCode(code)) {
    return NextResponse.json({ error: 'Invalid access code' }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });
  grantAppAccess(response);
  return response;
}
```

**Step 6: Run the API test file again**

Run: `npm test -- app/api/access/route.test.ts`
Expected: PASS.

**Step 7: Commit the API gate foundation**

```bash
git add lib/app-access.ts app/api/access/route.ts app/api/access/route.test.ts
git commit -m "feat: add optional app access gate"
```

---

### Task 2: Gate app entry with middleware and a minimal access page

**Files:**
- Create: `middleware.ts`
- Create: `app/access/page.tsx`
- Create: `components/access/access-gate-form.tsx`
- Create: `middleware.test.ts`
- Modify: `lib/i18n.ts`

**Step 1: Write the failing middleware redirect test**

Create `middleware.test.ts` with a test that:
- sets `process.env.APP_ACCESS_CODE = 'ANGEL'`
- calls middleware for `http://localhost/`
- expects a redirect to `/access`

Use this shape:

```ts
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

describe('middleware', () => {
  it('redirects to /access when app access is enabled and no cookie is present', async () => {
    process.env.APP_ACCESS_CODE = 'ANGEL';
    const { middleware } = await import('@/middleware');

    const response = middleware(new NextRequest('http://localhost/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/access');
  });
});
```

**Step 2: Write the failing middleware allow-through test**

Add a second test that includes the correct cookie and expects `NextResponse.next()` behavior instead of a redirect.

```ts
it('allows the request through when the app access cookie is present', async () => {
  process.env.APP_ACCESS_CODE = 'ANGEL';
  const { middleware } = await import('@/middleware');
  const request = new NextRequest('http://localhost/', {
    headers: {
      cookie: 'deckforge_app_access=<replace-with-helper-generated-value>',
    },
  });

  const response = middleware(request);

  expect(response.status).toBe(200);
});
```

When writing the real test, import the same helper used in `lib/app-access.ts` so the cookie value matches the implementation instead of hardcoding a hash.

**Step 3: Run the middleware test file to verify it fails**

Run: `npm test -- middleware.test.ts`
Expected: FAIL because `middleware.ts` does not exist yet.

**Step 4: Write the minimal middleware**

Create `middleware.ts` that:
- skips `_next`, static assets, `favicon`, and `/api/access`
- skips `/access`
- if the env code is not configured, allows all requests
- if the cookie is present and valid, allows the request
- otherwise redirects to `/access`

Use this shape:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { hasGrantedAppAccess, isAppAccessEnabled } from '@/lib/app-access';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === '/access' ||
    pathname.startsWith('/api/access') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  if (!isAppAccessEnabled() || hasGrantedAppAccess(request)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/access', request.url));
}
```

**Step 5: Add gate copy to `lib/i18n.ts`**

Add only the new strings needed for the access page in both languages. Keep the existing workspace/recovery strings if they already exist.

Add keys under `dashboard` only if you truly reuse the dashboard namespace. Otherwise prefer a small `accessGate` group.

Minimum new copy:
- title
- description
- input placeholder
- submit action
- loading label
- invalid-code error

**Step 6: Create the access page and client form**

Create `app/access/page.tsx` as a server component that renders a centered card.

Create `components/access/access-gate-form.tsx` as a client component that:
- tracks `code`, `error`, `isSubmitting`
- posts to `/api/access`
- on success, redirects with `window.location.href = '/'`
- shows inline error text on failure

Use this minimal shape for the client form:

```tsx
'use client';

import { useState } from 'react';

export function AccessGateForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const response = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setError(data?.error || 'Invalid access code');
      setIsSubmitting(false);
      return;
    }

    window.location.href = '/';
  };

  return <form onSubmit={handleSubmit}>{/* input + button */}</form>;
}
```

Keep the page visually simple: one centered card, one input, one button.

**Step 7: Run the middleware test file again**

Run: `npm test -- middleware.test.ts`
Expected: PASS.

**Step 8: Commit the entry gate**

```bash
git add middleware.ts middleware.test.ts app/access/page.tsx components/access/access-gate-form.tsx lib/i18n.ts
git commit -m "feat: gate app entry with access code"
```

---

### Task 3: Restore a compact workspace security card on the dashboard

**Files:**
- Modify: `components/home/dashboard-home.tsx`
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `lib/hooks.ts` (only if the current exports need response typing cleanup)
- Modify: `lib/i18n.ts` (only if existing workspace labels are missing)

**Step 1: Write the failing dashboard render test**

In `components/home/dashboard-home.test.tsx`, add a test that renders `DashboardHome` with the existing mocked `useWorkspace()` value and expects the security card copy to be present.

Use the existing mock values already in the test file:
- `accessKeyPrefix: 'dwk_test'`
- `recoveryKey: null`

Add assertions for:
- the workspace prefix label
- the displayed prefix value
- the recover form title
- the recover action label

Use this shape:

```ts
it('renders the workspace security card with recovery controls', async () => {
  const { DashboardHome } = await import('@/components/home/dashboard-home');
  const html = renderToStaticMarkup(React.createElement(DashboardHome));

  expect(html).toContain(messages.dashboard.accessKeyPrefixLabel);
  expect(html).toContain('dwk_test');
  expect(html).toContain(messages.dashboard.useAccessKeyTitle);
  expect(html).toContain(messages.dashboard.useAccessKeyAction);
});
```

**Step 2: Write the failing one-time recovery-key render test**

Add another test that temporarily changes the mocked `useWorkspace()` response to include `recoveryKey: 'dwk_secret_123'` and expects the one-time key save block to render.

```ts
it('shows the one-time recovery key block when bootstrap returns a recovery key', async () => {
  vi.doMock('@/lib/hooks', () => ({
    useDecks: () => ({ data: [], isLoading: false, isError: false, refetch }),
    useWorkspace: () => ({ data: { accessKeyPrefix: 'dwk_test', recoveryKey: 'dwk_secret_123' } }),
    useRecoverWorkspace: () => ({ isPending: false, mutate }),
    useUpdateDeck: () => ({ isPending: false, mutate }),
    useDeleteDeck: () => ({ isPending: false, mutate }),
  }));

  const { DashboardHome } = await import('@/components/home/dashboard-home');
  const html = renderToStaticMarkup(React.createElement(DashboardHome));

  expect(html).toContain(messages.dashboard.saveAccessKeyTitle);
  expect(html).toContain('dwk_secret_123');
});
```

When implementing the real test, prefer updating the shared mock in a stable way instead of duplicating the whole module if you can avoid it.

**Step 3: Run the dashboard component test file to verify it fails**

Run: `npm test -- components/home/dashboard-home.test.tsx`
Expected: FAIL because the current prompt-first dashboard no longer renders the workspace security UI.

**Step 4: Add workspace state back into `DashboardHome`**

In `components/home/dashboard-home.tsx`:
- import `useWorkspace` and `useRecoverWorkspace`
- read `const { data: workspace } = useWorkspace()`
- create local state for the recovery input and inline status/error message
- submit the recovery input through `useRecoverWorkspace()`
- on success, clear the input and refresh the dashboard query state if needed

Follow existing patterns already used in the file for `composerError` and `isSubmitting`. Do not create a new custom hook for this.

**Step 5: Render a compact security card below the main composer**

Inside the main content column in `components/home/dashboard-home.tsx`, add one card below the prompt form that contains:
- the workspace security title/description
- the access key prefix
- the one-time recovery key block only when `workspace?.recoveryKey` exists
- the recovery input and button

Keep the full recovery key out of the sidebar. Keep this card in the main content area.

Use the existing dashboard strings first:
- `privateWorkspace`
- `workspaceDescription`
- `accessKeyPrefixLabel`
- `saveAccessKeyTitle`
- `saveAccessKeyDescription`
- `useAccessKeyTitle`
- `useAccessKeyDescription`
- `accessKeyPlaceholder`
- `useAccessKeyAction`
- `recoveringWorkspace`
- `accessKeyRequired`
- `workspaceRecovered`
- `recoverWorkspaceFailed`

Only add new strings if the current copy is missing or clearly wrong.

**Step 6: Run the dashboard component test file again**

Run: `npm test -- components/home/dashboard-home.test.tsx`
Expected: PASS.

**Step 7: Commit the dashboard security card**

```bash
git add components/home/dashboard-home.tsx components/home/dashboard-home.test.tsx lib/i18n.ts lib/hooks.ts
git commit -m "feat: restore workspace security card"
```

---

### Task 4: Verify regression coverage and manual flows end to end

**Files:**
- Verify: `app/api/access/route.ts`
- Verify: `middleware.ts`
- Verify: `components/access/access-gate-form.tsx`
- Verify: `components/home/dashboard-home.tsx`
- Verify: `app/api/workspace/route.ts`
- Verify: `app/api/workspace/recover/route.ts`
- Verify: `lib/workspace.ts`

**Step 1: Run the focused automated tests together**

Run:

```bash
npm test -- app/api/access/route.test.ts middleware.test.ts app/api/workspace/route.test.ts lib/workspace.test.ts components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 2: Run the article route regression tests**

Run:

```bash
npm test -- app/api/articles/[id]/route.test.ts
```

Expected: PASS. This confirms the sidebar article actions work did not regress while touching `DashboardHome`.

**Step 3: Run lint**

Run: `npm run lint`
Expected: PASS.

If lint fails because `eslint` is not installed in this repo snapshot, record the exact output and stop. Do not add or change dependencies as part of this task.

**Step 4: Manually verify the gated entry flow**

Run: `npm run dev`
Expected: local app starts.

Then verify in browser:
1. Set `APP_ACCESS_CODE=ANGEL` in local env.
2. Open `/` in a clean browser session.
3. Confirm you are redirected to `/access`.
4. Enter a wrong code and confirm the page stays put with an inline error.
5. Enter `ANGEL` and confirm you land on `/`.
6. Refresh `/` and confirm you stay inside the app.

**Step 5: Manually verify workspace security UX**

In the same browser session:
1. Confirm the dashboard shows a workspace security card in the main content area, not the sidebar.
2. Confirm the prefix renders.
3. On a newly created workspace, confirm the one-time full recovery key is shown.
4. Refresh and confirm the full recovery key is no longer shown.
5. Paste a valid recovery key in the recover input and confirm the workspace reconnects.
6. Paste an invalid recovery key and confirm the error stays inline.
7. Confirm sidebar article rename/delete still behave normally.

**Step 6: Commit the verified integration**

```bash
git add app/api/access/route.ts app/api/access/route.test.ts middleware.ts middleware.test.ts app/access/page.tsx components/access/access-gate-form.tsx components/home/dashboard-home.tsx components/home/dashboard-home.test.tsx lib/app-access.ts lib/i18n.ts
git commit -m "feat: add gated access and workspace recovery ui"
```

---

## Notes for the implementing engineer

- Follow @superpowers:test-driven-development strictly: test first, watch it fail, then write the smallest passing code.
- If middleware tests behave unexpectedly, use @superpowers:systematic-debugging before changing the design.
- Do not move the full workspace key into the sidebar.
- Do not change the existing recovery-key hashing/storage model in `lib/workspace.ts` unless a failing test proves it is necessary.
- Keep the access gate optional. If `APP_ACCESS_CODE` is unset or empty, the app should behave exactly as it does today.
