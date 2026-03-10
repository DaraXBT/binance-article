# AI Suggest Yellow Gradient Border Design

**Goal:** Make the AI Suggest button border animation more recognizable by switching from the current violet glow to a noticeable yellow/amber gradient treatment.

## Summary
The existing AI Suggest glow is structurally correct, but its violet border reads as too subtle. The update should keep the same component structure and state logic while changing only the visual treatment: a warmer yellow/amber/orange gradient border with a stronger idle glow.

## Scope
- Keep the current AI Suggest button markup and helper-based state gating
- Keep motion-safe behavior
- Keep the glow hidden while suggesting/loading
- Keep the Generate article button unchanged
- Do not add new components, APIs, or dependencies

## Implementation
### `components/home/dashboard-home.tsx`
- Keep `getAiSuggestGlowClassName(...)`
- Change the glow layer classes from violet border styling to a yellow gradient border treatment
- Preserve the existing state conditions:
  - visible only when a topic exists and suggestion is idle
  - hidden while `isSuggesting`
  - hidden when no topic is entered

### `app/globals.css`
- Update `@keyframes ai-suggest-glow`
- Replace violet-toned shadow values with amber/yellow values
- Increase visibility slightly so the effect is easier to notice without feeling oversized or flashy

## Visual Behavior
- **Idle:** clear yellow gradient border with a noticeable glow
- **Hover:** slightly brighter emphasis
- **Loading:** glow disappears; spinner/loading label remains primary feedback
- **Disabled/no topic:** no glow

## Verification
- Focused dashboard test still passes
- Manual browser check shows the effect is visibly stronger than the violet version
- No layout shift or size change
- Generate article button remains untouched

## Notes
- This is a visual refinement only
- No git commit is included here because commits are only created on explicit user request
