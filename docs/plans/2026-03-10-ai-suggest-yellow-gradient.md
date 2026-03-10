# AI Suggest Yellow Gradient Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the AI Suggest button border animation from subtle violet to a more recognizable yellow/amber gradient glow without changing the existing button behavior.

**Architecture:** Keep the current helper-driven AI Suggest glow structure and only refine the visual styling. The change stays local to `components/home/dashboard-home.tsx` and `app/globals.css`, preserving the existing idle/loading/no-topic state logic while making the glow brighter and warmer.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Vitest

---

### Task 1: Add a failing test for the yellow gradient glow classes

**Files:**
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `components/home/dashboard-home.tsx:110-120`

**Step 1: Write the failing test**

Add a new focused test for `getAiSuggestGlowClassName` in `components/home/dashboard-home.test.tsx` that asserts the idle state uses the new warm gradient markers instead of the current violet border token.

Use assertions shaped like:

```ts
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false })).toContain('from-yellow-400')
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false })).toContain('via-amber-400')
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false })).toContain('to-orange-400')
```

Keep the existing idle/loading/no-topic helper tests intact.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: FAIL because the helper still returns the violet-border styling.

**Step 3: Write minimal implementation**

Update `getAiSuggestGlowClassName` in `components/home/dashboard-home.tsx` so the visible/idle branch returns a more recognizable gradient-based border layer.

Use a pattern like:

```ts
export function getAiSuggestGlowClassName(...) {
  return hasTopic && !isSuggesting
    ? 'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md opacity-100 transition-opacity duration-200 bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 p-px motion-safe:animate-[ai-suggest-glow_2.4s_ease-in-out_infinite]'
    : 'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md opacity-0 transition-opacity duration-200 bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 p-px'
}
```

If needed, keep the actual visible border effect on an inner overlay element or mask-free single layer, but do not introduce a new component. Keep the helper narrow and preserve the existing state behavior.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.test.tsx components/home/dashboard-home.tsx
git commit -m "feat: update ai suggest glow to yellow gradient"
```

---

### Task 2: Update the keyframes for a warmer, more visible glow

**Files:**
- Modify: `app/globals.css:178-188`
- Modify: `components/home/dashboard-home.tsx:110-120`

**Step 1: Write the failing visual expectation in code**

Before editing CSS, make sure the helper returns the final yellow-gradient class tokens from Task 1. This is the code-side failing expectation for the warmer visual treatment.

**Step 2: Run focused tests to confirm code compiles before CSS changes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS on helper assertions, while the live CSS glow still uses the old violet-toned keyframe values.

**Step 3: Write minimal implementation**

Update `@keyframes ai-suggest-glow` in `app/globals.css` to a warmer amber/yellow glow with stronger visibility than the current version.

Use values in this shape:

```css
@keyframes ai-suggest-glow {
  0%,
  100% {
    box-shadow:
      0 0 0 1px rgba(250, 204, 21, 0.35),
      0 0 14px 1px rgba(245, 158, 11, 0.18);
    opacity: 0.82;
  }
  50% {
    box-shadow:
      0 0 0 1px rgba(251, 191, 36, 0.55),
      0 0 24px 3px rgba(249, 115, 22, 0.28);
    opacity: 1;
  }
}
```

Do not add transforms or scale. Keep layout stable.

**Step 4: Run test to verify the focused suite still passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add app/globals.css components/home/dashboard-home.tsx
git commit -m "feat: brighten ai suggest glow animation"
```

---

### Task 3: Verify loading and no-topic states still suppress the glow

**Files:**
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `components/home/dashboard-home.tsx:110-120`

**Step 1: Write the failing test**

Tighten the helper tests in `components/home/dashboard-home.test.tsx` so they also assert the loading and no-topic branches keep the gradient classes but remain visually suppressed via `opacity-0`, and that only the idle state includes the animation token.

Example assertions:

```ts
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true })).toContain('opacity-0')
expect(getAiSuggestGlowClassName({ hasTopic: false, isSuggesting: false })).toContain('opacity-0')
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true })).not.toContain('motion-safe:animate-[ai-suggest-glow')
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: FAIL if the helper still leaks the animation token or visible-state classes into non-idle states.

**Step 3: Write minimal implementation**

Adjust `getAiSuggestGlowClassName` only if the new assertions fail. Keep the final contract:
- idle with topic → visible gradient glow + motion-safe animation
- suggesting → gradient layer present but hidden, no animation token
- no topic → gradient layer present but hidden, no animation token

Do not change button loading behavior.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.test.tsx components/home/dashboard-home.tsx
git commit -m "test: cover yellow gradient glow states"
```

---

### Task 4: Run final verification

**Files:**
- Verify: `components/home/dashboard-home.tsx`
- Verify: `app/globals.css`
- Verify: `components/home/dashboard-home.test.tsx`

**Step 1: Run focused automated tests**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: Either PASS, or the same known repo-level failure if `eslint` is still unavailable. If lint fails due to missing `eslint`, document that exact blocker and do not add dependency work.

**Step 3: Run the app for manual verification**

Run:

```bash
APP_ACCESS_CODE=ANGEL npm run dev
```

Expected: dev server starts and the dashboard is reachable after unlocking.

**Step 4: Verify the UI in browser**

Manual checklist:
1. Open `/access` and unlock with `ANGEL`.
2. Open the dashboard composer.
3. Enter a topic and confirm the AI Suggest border is now clearly yellow/amber/orange.
4. Confirm the glow is more recognizable than the violet version.
5. Confirm there is no layout shift or button size change.
6. Confirm the glow disappears during suggesting/loading.
7. Confirm the Generate article button remains unchanged.

**Step 5: Commit**

```bash
git add app/globals.css components/home/dashboard-home.tsx components/home/dashboard-home.test.tsx
git commit -m "feat: add yellow gradient ai suggest glow"
```
