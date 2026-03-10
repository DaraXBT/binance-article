# New Prompt AI Suggest Design

**Goal:** Add the clearer AI Suggest action to `/new?mode=prompt` so users can generate prompt instructions from a topic without leaving the new-article wizard.

## Summary
The `/new?mode=prompt` step already supports AI-generated instructions, but it uses a local fetch implementation and a smaller custom button that does not match the newer dashboard AI Suggest treatment. The update should keep the wizard flow intact while making the prompt-generation action visually consistent and more recognizable by reusing the same AI Suggest request behavior and border-sweep treatment already established on the dashboard.

## Scope
- Add the dashboard-style AI Suggest control only to `/new?mode=prompt`
- Reuse the existing prompt-generation API contract at `/api/articles/generate-prompt`
- Reuse the same yellow/amber AI Suggest visual language where practical
- Keep the wizard step layout, validation, and navigation flow unchanged
- Keep text mode and URL mode unchanged
- Do not add new routes, dependencies, or modes

## Implementation
### `app/new/steps/prompt-step.tsx`
- Replace the current small `✨ AI Prompt` button treatment with the clearer AI Suggest control used for prompt generation
- Keep the interaction tied to the topic/title input:
  - no title → action unavailable
  - title present + idle → visible AI Suggest affordance
  - generating → loading label/spinner, action disabled, textarea disabled
- On success, write the generated prompt into `formData.articleContent`
- On failure, keep the inline error message near the prompt field

### Shared prompt-generation behavior
- Reuse the existing prompt-generation request behavior already used on the dashboard instead of maintaining a separate local fetch flow
- Prefer sharing the request helper so `/` and `/new?mode=prompt` stay aligned on request shape, success handling, and error handling

### Shared visual treatment
- Reuse the same AI Suggest border-sweep contract already introduced on the dashboard
- Keep the visual treatment local to the button wrapper/classes unless a tiny shared helper is clearly simpler than duplication
- The Generate/Next buttons and stepper should remain visually unchanged

## State Behavior
- **Idle with title:** AI Suggest is enabled and visibly highlighted
- **No title:** AI Suggest is disabled/inactive
- **Generating:** AI Suggest switches to loading text, disables interaction, and the prompt textarea is disabled
- **Error:** inline error remains visible without breaking wizard progression rules
- **Success:** generated prompt populates the textarea and the user can edit it before continuing

## Testing
- Add focused tests for `PromptStep` behavior:
  - renders AI Suggest in prompt mode
  - requires a title before suggestion is available
  - calls `/api/articles/generate-prompt` when triggered
  - fills the prompt textarea on success
  - disables the textarea/button while generating
  - shows inline error text on failure
- If shared helper/classes are reused from the dashboard, add assertions that the rendered prompt-step AI Suggest control includes the expected sweep hook/class contract

## Verification
- Automated tests for `PromptStep` pass
- Existing dashboard helper tests still pass if shared helpers are touched
- Manual browser check on `/new?mode=prompt` confirms:
  - AI Suggest appears only in prompt mode
  - title entry enables the action
  - the prompt textarea fills after suggestion
  - loading state disables the prompt field
  - text and layout remain readable and stable
  - other `/new` modes remain unchanged

## Notes
- This is a focused UX consistency improvement for the prompt wizard only
- No git commit is included here because commits require explicit user request
