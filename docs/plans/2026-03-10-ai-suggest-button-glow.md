# AI Suggest Button Glow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a subtle animated glow border to the dashboard AI Suggest button without changing its existing loading or submission behavior.

**Architecture:** Keep the change local to the dashboard composer and shared global CSS. Reuse the existing `Button` primitive and Tailwind-first styling approach by adding a lightweight wrapper around the AI Suggest button plus one dedicated keyframe in `app/globals.css`. The animation should only run when the button is enabled and idle, and should stop while the AI suggestion request is in progress.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Vitest

---

### Task 1: Add a failing component test for the animated AI Suggest button

**Files:**
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `components/home/dashboard-home.tsx`

**Step 1: Write the failing test**

Add one focused assertion to the existing dashboard home render test coverage so it verifies the idle AI Suggest control renders a dedicated glow wrapper/class hook. Extend the existing `renders a prompt-first home composer...` test or add a nearby new test that checks the static markup contains a specific marker class such as `ai-suggest-glow` around the AI Suggest button.

Example assertion shape:

```ts
expect(html).toContain('ai-suggest-glow')
expect(html).toContain(messages.dashboard.aiSuggest)
```

Use a deterministic class/data hook that will exist in production markup. Do not test computed animation behavior in Vitest; only test that the intended animated element is rendered.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: FAIL because the dashboard markup does not yet contain the new glow wrapper/class.

**Step 3: Write minimal implementation**

In `components/home/dashboard-home.tsx`, update only the AI Suggest button section inside the composer action row:

- wrap the AI Suggest button in a `relative` container
- add one absolutely positioned decorative border layer
- give that decorative layer a stable test hook/class like `ai-suggest-glow`
- only apply the animated state when:
  - `topic.trim()` is truthy
  - `isSuggesting` is false
- preserve the existing button text and spinner logic
- keep layout dimensions stable

Implementation shape to follow:

```tsx
<div className="relative inline-flex">
  <span
    aria-hidden="true"
    className={cn(
      'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md border transition-opacity',
      topic.trim() && !isSuggesting
        ? 'opacity-100 animate-[ai-suggest-glow_2.4s_ease-in-out_infinite]'
        : 'opacity-0'
    )}
  />
  <Button ...>
    ...
  </Button>
</div>
```

Use the repo’s existing class composition approach already present in the file. Keep the effect subtle and do not create a new reusable component for this one-off behavior.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.test.tsx components/home/dashboard-home.tsx
git commit -m "feat: add ai suggest glow hook"
```

---

### Task 2: Add the glow animation CSS

**Files:**
- Modify: `app/globals.css:151-177`
- Modify: `components/home/dashboard-home.tsx`

**Step 1: Write the failing visual expectation in code**

Before editing CSS, ensure the wrapper markup from Task 1 uses the final animation class name so the CSS addition has an explicit target. Confirm the class references a new keyframe name that does not yet exist, for example:

```tsx
animate-[ai-suggest-glow_2.4s_ease-in-out_infinite]
```

This acts as the failing implementation hook: the markup points to an animation that is not yet defined.

**Step 2: Run a quick verification to confirm no keyframe exists yet**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS on markup only, with no CSS verification yet. Then inspect `app/globals.css` manually and confirm there is no existing `@keyframes ai-suggest-glow` block.

**Step 3: Write minimal implementation**

Add one new keyframe block near the existing animation definitions in `app/globals.css`, immediately after the current stepper animations so animation utilities stay grouped.

Use a subtle pulse that changes border color/shadow intensity without changing button size:

```css
@keyframes ai-suggest-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(168, 85, 247, 0), 0 0 0 1px rgba(168, 85, 247, 0.28);
    opacity: 0.72;
  }
  50% {
    box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.4), 0 0 18px 2px rgba(168, 85, 247, 0.18);
    opacity: 1;
  }
}
```

Apply the decorative layer classes so they match the existing card/button radius and remain unobtrusive:

```tsx
className={cn(
  'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md border border-violet-500/40',
  'transition-opacity duration-200',
  topic.trim() && !isSuggesting
    ? 'opacity-100 animate-[ai-suggest-glow_2.4s_ease-in-out_infinite]'
    : 'opacity-0'
)}
```

If hover emphasis is included, keep it minimal, for example by slightly increasing border opacity on the wrapper with `group-hover` classes. Do not add transforms, scale, or extra pseudo-elements.

**Step 4: Run test to verify existing tests still pass**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add app/globals.css components/home/dashboard-home.tsx
git commit -m "feat: animate ai suggest button border"
```

---

### Task 3: Verify loading and disabled states stay correct

**Files:**
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `components/home/dashboard-home.tsx`

**Step 1: Write the failing test**

Add a focused test that verifies the AI Suggest button still swaps to the loading label when suggesting and that the glow hook can be suppressed for non-idle states through deterministic markup.

Because the current test file uses static rendering and mocked hooks, keep this lightweight by extracting a small pure helper from `dashboard-home.tsx` if needed, or by asserting the rendered button markup includes the loading label when a local exported helper/class-selection function is invoked.

Recommended simpler path:
- export a tiny helper from `dashboard-home.tsx` that returns the glow layer class string based on `{ hasTopic, isSuggesting }`
- test:

```ts
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false })).toContain('animate-[ai-suggest-glow')
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true })).toContain('opacity-0')
expect(getAiSuggestGlowClassName({ hasTopic: false, isSuggesting: false })).toContain('opacity-0')
```

This is preferable to adding a more complex client-interaction test harness.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: FAIL because the helper does not yet exist.

**Step 3: Write minimal implementation**

In `components/home/dashboard-home.tsx`, add a small exported helper near the top-level helper functions:

```ts
export function getAiSuggestGlowClassName({
  hasTopic,
  isSuggesting,
}: {
  hasTopic: boolean
  isSuggesting: boolean
}) {
  return hasTopic && !isSuggesting
    ? 'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md border border-violet-500/40 opacity-100 animate-[ai-suggest-glow_2.4s_ease-in-out_infinite] transition-opacity duration-200'
    : 'ai-suggest-glow pointer-events-none absolute inset-0 rounded-md border border-violet-500/40 opacity-0 transition-opacity duration-200'
}
```

Then use it in the component:

```tsx
<span
  aria-hidden="true"
  className={getAiSuggestGlowClassName({
    hasTopic: Boolean(topic.trim()),
    isSuggesting,
  })}
/>
```

Keep the helper narrow and specific. Do not generalize it into a design-system utility.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.test.tsx components/home/dashboard-home.tsx
git commit -m "test: cover ai suggest glow states"
```

---

### Task 4: Run final verification

**Files:**
- Modify: none
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

Expected: Either PASS, or the same known repo-level failure if `eslint` is still unavailable. If lint fails due to missing `eslint`, document that exact blocker instead of adding unrelated dependency work.

**Step 3: Run the app for manual verification**

Run:

```bash
APP_ACCESS_CODE=ANGEL npm run dev
```

Expected: dev server starts on `http://localhost:3000`.

**Step 4: Verify the UI in browser**

Manual checklist:
1. Open `/access` and unlock with `ANGEL`.
2. Go to the dashboard home composer.
3. Confirm AI Suggest shows a subtle animated border only after a topic is entered.
4. Confirm the border does not change layout or button size.
5. Confirm hover slightly strengthens the effect, if implemented.
6. Confirm clicking AI Suggest switches to the existing loading state.
7. Confirm the glow stops while loading.
8. Confirm the Generate article button remains unchanged.

**Step 5: Commit**

```bash
git add app/globals.css components/home/dashboard-home.tsx components/home/dashboard-home.test.tsx
git commit -m "feat: add glow animation to ai suggest"
```
