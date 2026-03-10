# New Prompt AI Suggest Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the dashboard-style AI Suggest button to `/new?mode=prompt` so users can generate prompt instructions from a topic inside the new-article wizard.

**Architecture:** Keep the change scoped to the prompt wizard step and shared prompt-generation behavior. Reuse the existing request/helper logic and AI Suggest border-sweep visual contract already established on the dashboard so `/` and `/new?mode=prompt` stay consistent without changing text mode, URL mode, or wizard navigation.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Vitest

---

### Task 1: Add a focused PromptStep test for AI Suggest rendering and request flow

**Files:**
- Create: `app/new/steps/prompt-step.test.tsx`
- Modify: `app/new/steps/prompt-step.tsx`
- Modify: `components/home/dashboard-home.tsx`

**Step 1: Write the failing test**

Create `app/new/steps/prompt-step.test.tsx` with focused coverage for the prompt wizard step. Mock `useLanguage`, `Input`, `Textarea`, and any icon/button primitives just as lightly as needed.

Add a test shaped like:

```ts
it('renders AI Suggest and fills the prompt from the shared prompt API helper', async () => {
  const onUpdate = vi.fn();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ prompt: 'Generated prompt body' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );

  render(
    <PromptStep
      formData={{ title: 'Bitcoin ETF inflows', articleContent: '' }}
      onUpdate={onUpdate}
      fetchImpl={fetchMock}
    />
  );

  await user.click(screen.getByRole('button', { name: /ai suggest/i }));

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/articles/generate-prompt',
    expect.objectContaining({ method: 'POST' })
  );
  expect(onUpdate).toHaveBeenCalledWith({ articleContent: 'Generated prompt body' });
});
```

Also assert the rendered output includes the AI Suggest border-sweep hook, for example:

```ts
expect(screen.getByRole('button', { name: /ai suggest/i }).parentElement?.innerHTML).toContain('ai-suggest-glow')
expect(screen.getByRole('button', { name: /ai suggest/i }).parentElement?.innerHTML).toContain('ai-suggest-sweep')
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- app/new/steps/prompt-step.test.tsx
```

Expected: FAIL because the test file does not exist yet or because `PromptStep` does not expose the shared AI Suggest behavior/API shape.

**Step 3: Write minimal implementation**

Update `app/new/steps/prompt-step.tsx` so it can use the shared prompt-generation helper instead of its local fetch block.

Preferred shape:

```ts
import {
  getAiSuggestGlowClassName,
  requestPromptSuggestion,
} from '@/components/home/dashboard-home';

interface PromptStepProps {
  formData: {
    title: string;
    articleContent: string;
  };
  onUpdate: (updates: any) => void;
  fetchImpl?: typeof fetch;
}
```

Then replace the current `handleAutoGenerate` logic with:

```ts
const suggestedPrompt = await requestPromptSuggestion({
  title: formData.title,
  fetchImpl,
});
onUpdate({ articleContent: suggestedPrompt });
```

And replace the old `✨ AI Prompt` button treatment with the dashboard-style wrapper:

```tsx
<div className="relative inline-flex">
  <span
    aria-hidden="true"
    className={getAiSuggestGlowClassName({
      hasTopic: Boolean(formData.title.trim()),
      isSuggesting: isGenerating,
    })}
  />
  <button type="button" ...>
    {isGenerating ? 'Suggesting...' : 'AI Suggest'}
  </button>
</div>
```

Do not change text mode or URL mode. Keep the prompt success/error behavior local to `PromptStep`.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- app/new/steps/prompt-step.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add app/new/steps/prompt-step.test.tsx app/new/steps/prompt-step.tsx components/home/dashboard-home.tsx
git commit -m "feat: add ai suggest to prompt wizard step"
```

---

### Task 2: Cover disabled, loading, and error states for PromptStep AI Suggest

**Files:**
- Modify: `app/new/steps/prompt-step.test.tsx`
- Modify: `app/new/steps/prompt-step.tsx`
- Modify: `lib/i18n.ts`

**Step 1: Write the failing test**

Extend `app/new/steps/prompt-step.test.tsx` with focused state coverage.

Add assertions shaped like:

```ts
it('keeps AI Suggest unavailable when the title is empty', () => {
  render(<PromptStep formData={{ title: '', articleContent: '' }} onUpdate={vi.fn()} />);
  expect(screen.getByRole('button', { name: /ai suggest/i })).toBeDisabled();
});

it('disables the textarea and shows loading copy while generating', async () => {
  let resolveFetch: ((value: Response) => void) | undefined;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
  );

  render(...);
  await user.click(screen.getByRole('button', { name: /ai suggest/i }));

  expect(screen.getByRole('button', { name: /suggesting/i })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: /detailed instructions/i })).toBeDisabled();

  resolveFetch?.(
    new Response(JSON.stringify({ prompt: 'Done' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
});

it('shows the inline error when prompt generation fails', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: 'Failed to generate prompt' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  );

  render(...);
  await user.click(screen.getByRole('button', { name: /ai suggest/i }));

  expect(screen.getByText(/failed to generate prompt/i)).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- app/new/steps/prompt-step.test.tsx
```

Expected: FAIL until the final loading/error/disabled copy and accessibility contract match the new tests.

**Step 3: Write minimal implementation**

Adjust `app/new/steps/prompt-step.tsx` only as needed so the final contract is:
- empty title → AI Suggest disabled
- title present + idle → AI Suggest enabled with sweep treatment
- generating → loading label, disabled button, disabled textarea
- failed request → inline error shown

If needed, move hard-coded UI text to `lib/i18n.ts` under `newDeck.content` or a nearby `newDeck.prompt` section, for example:

```ts
aiSuggest: 'AI Suggest',
aiSuggestLoading: 'Suggesting...',
aiSuggestHintEmpty: 'Enter a topic title first, then ask AI for a suggestion.',
aiSuggestHintReady: 'Click AI Suggest to auto-generate instructions from your topic title, or write your own.',
```

Keep the change minimal and local to prompt mode.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- app/new/steps/prompt-step.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add app/new/steps/prompt-step.test.tsx app/new/steps/prompt-step.tsx lib/i18n.ts
git commit -m "test: cover prompt wizard ai suggest states"
```

---

### Task 3: Verify the shared helper still behaves correctly across dashboard and prompt step

**Files:**
- Modify: `components/home/dashboard-home.test.tsx`
- Modify: `app/new/steps/prompt-step.test.tsx`
- Modify: `components/home/dashboard-home.tsx` (only if required)

**Step 1: Write the failing test**

Add or tighten assertions so the shared AI Suggest helper contract remains explicit after reuse in the prompt wizard.

Example assertions:

```ts
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: false })).toContain('ai-suggest-sweep')
expect(getAiSuggestGlowClassName({ hasTopic: true, isSuggesting: true })).not.toContain('ai-suggest-sweep')
expect(getAiSuggestGlowClassName({ hasTopic: false, isSuggesting: false })).toContain('opacity-0')
```

And in `app/new/steps/prompt-step.test.tsx`, assert the prompt-step wrapper keeps using the shared contract instead of a separate custom token set.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx app/new/steps/prompt-step.test.tsx
```

Expected: FAIL if either surface diverges from the shared helper contract.

**Step 3: Write minimal implementation**

Only if needed, narrow any helper or prompt-step rendering mismatch so both surfaces use the same AI Suggest state contract:
- idle + topic → visible sweep
- suggesting → hidden sweep
- no topic → hidden sweep

Do not broaden the helper beyond what prompt step needs.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- components/home/dashboard-home.test.tsx app/new/steps/prompt-step.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.test.tsx app/new/steps/prompt-step.test.tsx components/home/dashboard-home.tsx
git commit -m "test: align ai suggest behavior across dashboard and prompt wizard"
```

---

### Task 4: Run final verification for prompt-mode AI Suggest

**Files:**
- Verify: `app/new/steps/prompt-step.tsx`
- Verify: `app/new/steps/prompt-step.test.tsx`
- Verify: `components/home/dashboard-home.tsx`
- Verify: `components/home/dashboard-home.test.tsx`
- Verify: `lib/i18n.ts`

**Step 1: Run focused automated tests**

Run:

```bash
npm test -- app/new/steps/prompt-step.test.tsx components/home/dashboard-home.test.tsx
```

Expected: PASS.

**Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: Either PASS, or the same repo-level blocker `sh: eslint: command not found`. If lint still fails for that reason, document it and do not add dependency work.

**Step 3: Run the app for manual verification**

Run:

```bash
APP_ACCESS_CODE=ANGEL npm run dev
```

Expected: dev server starts and `/new?mode=prompt` is reachable after unlock.

**Step 4: Verify the UI in browser**

Manual checklist:
1. Open `/access` and unlock with `ANGEL`.
2. Open `/new?mode=prompt`.
3. Confirm the AI Suggest button appears in prompt mode.
4. Confirm it is disabled until a topic title is entered.
5. Enter a topic title and confirm the yellow/amber sweep appears.
6. Click AI Suggest and confirm the button switches to loading copy while the prompt textarea is disabled.
7. Confirm the generated prompt fills the textarea on success.
8. Confirm inline error text appears on failure.
9. Confirm the stepper and Next/Generate navigation remain unchanged.
10. Confirm `/new` text mode and `/new?mode=url` are unchanged.

**Step 5: Commit**

```bash
git add app/new/steps/prompt-step.tsx app/new/steps/prompt-step.test.tsx components/home/dashboard-home.tsx components/home/dashboard-home.test.tsx lib/i18n.ts
git commit -m "feat: add ai suggest to prompt creation flow"
```
