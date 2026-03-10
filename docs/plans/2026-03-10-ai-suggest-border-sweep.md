# AI Suggest Border Sweep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current AI Suggest yellow glow pulse with a more recognizable yellow/amber border sweep animation.

**Architecture:** Keep the existing helper-driven decorative border layer in `components/home/dashboard-home.tsx`, but change the active animation from a uniform glow pulse to a moving highlight effect. The change should stay local to the helper/class output and shared animation definitions in `app/globals.css`, preserving the existing idle/loading/no-topic state logic and keeping layout stable.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Vitest

---

### Task 1: Add a failing helper test for the border sweep animation hook

**Files:**
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `components/home/dashboard-home.tsx:110-120`

**Step 1: Write the failing test**

Add a focused helper assertion in `components/home/dashboard-home.test.tsx` that verifies the active AI Suggest state now uses a border-sweep-specific animation hook instead of the current glow pulse token.

Use an assertion shaped like:

```ts
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false })).toContain('motion-safe:animate-[ai-suggest-sweep')
```

Keep the existing suppressed-state assertions intact.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: FAIL because the helper still returns the old `motion-safe:animate-[ai-suggest-glow_2.4s_ease-in-out_infinite]` token.

**Step 3: Write minimal implementation**

Update `getAiSuggestGlowClassName` in `components/home/dashboard-home.tsx` so the active branch uses the new sweep animation token while keeping the same active/suppressed state contract.

Implementation shape:

```ts
export function getAiSuggestGlowClassName(...) {
  return hasTopic && !isSuggesting
    ? '... motion-safe:animate-[ai-suggest-sweep_2.2s_linear_infinite]'
    : '... opacity-0 ...'
}
```

Do not change loading logic. Do not add a new component.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.test.tsx components/home/dashboard-home.tsx
git commit -m "feat: switch ai suggest to border sweep animation"
```

---

### Task 2: Replace the glow pulse keyframes with a border sweep animation

**Files:**
- Modify: `app/globals.css:178-188`
- Modify: `components/home/dashboard-home.tsx:110-120`

**Step 1: Write the failing visual expectation in code**

Before editing CSS, ensure the helper already points at the new `ai-suggest-sweep` animation token from Task 1. This is the code-side hook for the CSS implementation.

**Step 2: Run focused tests to confirm helper changes still compile**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 3: Write minimal implementation**

Replace the old `@keyframes ai-suggest-glow` block in `app/globals.css` with a new sweep animation that moves a warm highlight across the border treatment.

Use a layout-stable pattern. For example, animate `background-position` or a masked highlight layer rather than transforms on the button itself.

Preferred shape:

```css
@keyframes ai-suggest-sweep {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 200% 50%;
  }
}
```

Then ensure the helper’s active class string includes the supporting gradient/background sizing utilities, for example:

```ts
'bg-[linear-gradient(90deg,rgba(250,204,21,0.2),rgba(251,191,36,0.95),rgba(249,115,22,0.25),rgba(250,204,21,0.2))] [background-size:200%_100%] motion-safe:animate-[ai-suggest-sweep_2.2s_linear_infinite]'
```

Keep the border layer subtle but clearly readable. No layout shift, no scale, no extra component.

**Step 4: Run test to verify focused tests still pass**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add app/globals.css components/home/dashboard-home.tsx
git commit -m "feat: add ai suggest border sweep effect"
```

---

### Task 3: Verify suppressed states still hide the sweep

**Files:**
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `components/home/dashboard-home.tsx:110-120`

**Step 1: Write the failing test**

Tighten the helper tests in `components/home/dashboard-home.test.tsx` so they explicitly assert that suggesting and no-topic states do not include the new sweep animation token.

Example assertions:

```ts
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true })).not.toContain('ai-suggest-sweep')
expect(getAiSuggestGlowClassName({ hasTopic: false, isSuggesting: false })).not.toContain('ai-suggest-sweep')
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true })).toContain('opacity-0')
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: FAIL if the helper still leaks the active animation token into suppressed states.

**Step 3: Write minimal implementation**

Adjust `getAiSuggestGlowClassName` only if needed so the final contract remains:
- idle + topic → visible yellow/amber sweep animation
- suggesting → hidden layer, no sweep animation token
- no topic → hidden layer, no sweep animation token

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.test.tsx components/home/dashboard-home.tsx
git commit -m "test: cover ai suggest border sweep states"
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

Expected: Either PASS, or the same known repo-level failure if `eslint` is still unavailable. If lint fails due to missing `eslint`, document that exact blocker.

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
3. Enter a topic and confirm the AI Suggest border now uses a moving yellow/amber sweep instead of a full pulse.
4. Confirm the sweep is more recognizable than the previous glow.
5. Confirm text remains readable.
6. Confirm no layout shift or button size change.
7. Confirm the sweep disappears during suggesting/loading.
8. Confirm the Generate article button remains unchanged.

**Step 5: Commit**

```bash
git add app/globals.css components/home/dashboard-home.tsx components/home/dashboard-home.test.tsx
git commit -m "feat: replace ai suggest glow with border sweep"
```
