# AI Suggest Border Sweep Design

**Goal:** Replace the current AI Suggest glow pulse with a more recognizable yellow/amber border sweep animation.

## Summary
The current yellow glow is visible but still does not read clearly enough. Instead of a full pulsing halo, the AI Suggest button should use a moving gold highlight that travels across the border. This keeps the button feeling active and premium while improving readability by reducing the constant full-edge glow.

## Scope
- Replace the current `ai-suggest-glow` pulse effect with a border sweep effect
- Keep the yellow/amber/orange palette
- Keep the current AI Suggest button structure and helper-based state gating
- Keep the effect active only when a topic exists and the button is idle
- Keep the effect hidden while suggesting/loading
- Keep the Generate article button unchanged
- Do not add new components, APIs, or dependencies

## Implementation
### `components/home/dashboard-home.tsx`
- Keep the current AI Suggest helper-based class logic
- Update the decorative border layer classes so they support a moving highlight treatment instead of a uniform glow pulse
- Preserve the same state conditions:
  - active only when `hasTopic` is true and `isSuggesting` is false
  - hidden when loading or no topic is entered

### `app/globals.css`
- Replace or update the existing `@keyframes ai-suggest-glow`
- Introduce a border sweep animation using a warm gold/yellow gradient movement
- Keep the animation motion-safe and layout-stable

## Visual Behavior
- **Idle:** a bright yellow/amber highlight sweeps across the border
- **Hover:** slightly stronger visibility if needed, but no size or layout shift
- **Loading:** the border sweep disappears and existing loading feedback remains primary
- **Disabled/no topic:** no animation

## Verification
- Focused dashboard test still passes
- If needed, helper tests are updated to check the new active animation hook/state behavior
- Manual browser check confirms the sweep reads more clearly than the current glow pulse
- No layout shift or button size change
- Generate article button remains untouched

## Notes
- This is a visual refinement only
- No git commit is included because commits require explicit user request
