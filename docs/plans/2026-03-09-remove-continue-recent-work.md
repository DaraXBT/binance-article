# Remove Continue Recent Work Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the main "Continue recent work" section from the dashboard while keeping the left sidebar article list and the rest of the dashboard unchanged.

**Architecture:** The dashboard already renders recent articles in a dedicated conditional branch inside `components/home/dashboard-home.tsx`. The simplest approach is to delete that branch and fall through directly to the existing empty-state branch when there are no articles, while leaving the sidebar list, workspace panels, and quick-start cards intact. This is a pure UI simplification with no API, data-model, or routing changes.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Vitest

---

### Task 1: Remove the dashboard recent-work section

**Files:**
- Modify: `components/home/dashboard-home.tsx:496-545`

**Step 1: Write the failing test**

There is no existing browser/UI test setup for this component, and `vitest.config.ts` is currently configured for `environment: 'node'`. For this tiny presentational removal, do not add a new test harness just for this change.

**Step 2: Run test to verify it fails**

Skip for this task. No targeted component test exists yet, and adding one would be more work than the requested UI change.

**Step 3: Write minimal implementation**

In `components/home/dashboard-home.tsx`, remove the `decks.length > 0` branch that renders:
- the `Clock3` icon heading,
- the `messages.dashboard.continueRecent` title,
- the status filter buttons,
- the `DeckCard` grid,
- the `messages.dashboard.noFilteredDecks` fallback.

After the change, the render flow should be:
- loading state,
- error state,
- otherwise the existing empty-state section.

Also remove now-unused imports/state related only to that section, specifically anything that becomes unused such as:
- `Clock3` import,
- `DeckCard` import,
- `statusFilter` state,
- recent-section filtering logic that only supported the removed section.

Keep these unchanged:
- left sidebar article list,
- search field in sidebar,
- workspace access-key cards,
- quick-start cards,
- top-bar actions.

**Step 4: Run checks to verify it passes**

Run: `npm run lint`
Expected: PASS with no unused import/state errors in `components/home/dashboard-home.tsx`

Run: `npm test`
Expected: PASS, or if unrelated existing failures occur, record them exactly before stopping.

**Step 5: Commit**

```bash
git add components/home/dashboard-home.tsx docs/plans/2026-03-09-remove-continue-recent-work.md
git commit -m "refactor: simplify dashboard home layout"
```

### Task 2: Manually verify the dashboard stays minimal

**Files:**
- Verify: `components/home/dashboard-home.tsx`
- Verify in browser: `/`

**Step 1: Start the app locally if needed**

Run: `npm run dev`
Expected: Next.js dev server starts successfully.

**Step 2: Open the dashboard**

Navigate to `/`
Expected: The dashboard shows the workspace area and quick-start cards, but not the "Continue recent work" heading or the recent card grid.

**Step 3: Verify existing article navigation remains available**

Check the left sidebar.
Expected: Existing articles still appear in the sidebar list and remain clickable.

**Step 4: Verify empty state behavior still works when applicable**

If testing with an empty workspace, confirm the existing empty-state section still renders.
Expected: The dashboard still shows the first-article CTA without layout issues.

**Step 5: Commit if manual verification required follow-up cleanup**

```bash
git add components/home/dashboard-home.tsx
git commit -m "refactor: simplify dashboard home layout"
```
