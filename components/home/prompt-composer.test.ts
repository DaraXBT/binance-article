// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseComposerIllustrationStyle,
  parseComposerSlideCount,
  PromptComposer,
} from './prompt-composer';
import { ILLUSTRATION_STYLES } from '@/lib/config';
import { getIllustrationStyleCopy } from '@/lib/illustration-style-i18n';

type PromptComposerProps = React.ComponentProps<typeof PromptComposer>;
type PromptComposerWithoutSuggestProps = Extract<
  PromptComposerProps,
  { showSuggest?: false }
>;

const labels: PromptComposerProps['labels'] = {
  prompt: 'Article idea',
  placeholder: 'Describe the article',
  slideCount: 'Slides',
  illustrationStyle: 'Style',
  generate: 'Create article',
  generating: 'Creating article',
  suggest: 'AI Suggest',
  suggesting: 'Suggesting',
};

function renderPromptComposer(overrides: Partial<PromptComposerWithoutSuggestProps> = {}) {
  const props: PromptComposerWithoutSuggestProps = {
    prompt: '',
    onPromptChange: () => undefined,
    slideCount: 5,
    onSlideCountChange: () => undefined,
    illustrationStyle: 'lab-notes',
    onIllustrationStyleChange: () => undefined,
    onGenerate: () => undefined,
    labels,
    ...overrides,
  };

  return render(React.createElement(PromptComposer, props));
}

describe('PromptComposer', () => {
  afterEach(() => cleanup());

  it('accepts only supported slide counts', () => {
    expect(parseComposerSlideCount('7')).toBe(7);
    expect(parseComposerSlideCount('')).toBeNull();
    expect(parseComposerSlideCount('0')).toBeNull();
    expect(parseComposerSlideCount('2')).toBeNull();
  });

  it.each([
    'pixel-art',
    'fantasy-animation',
    'lab-notes',
    'binance',
    'binance-master',
    'binance-briefing',
    'binance-mondo-panoramic',
    'binance-sketch-notes',
    'binance-vector-illustration',
  ])('accepts configured illustration style %s', (style) => {
    expect(parseComposerIllustrationStyle(style)).toBe(style);
  });

  it('rejects unconfigured illustration styles', () => {
    expect(parseComposerIllustrationStyle('')).toBeNull();
    expect(parseComposerIllustrationStyle('unknown')).toBeNull();
  });

  it('uses the shared prompt-box shell and accessible icon-backed selectors', () => {
    const { container } = renderPromptComposer();

    expect(container.querySelector('[data-slot="ai-prompt-box"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="ai-prompt-box-toolbar"]')).toBeTruthy();
    expect(screen.getByRole('textbox').classList.contains('studio-prompt-input')).toBe(true);
    const slides = screen.getByRole('combobox', { name: 'Slides' });
    const style = screen.getByRole('combobox', { name: 'Style' });
    expect(slides.classList.contains('studio-composer-chip')).toBe(true);
    expect(style.classList.contains('studio-composer-chip')).toBe(true);
    expect(slides.querySelector('svg')).toBeTruthy();
    expect(style.querySelector('svg')).toBeTruthy();
  });

  it('uses a compact standard-height home input', () => {
    renderPromptComposer();

    const input = screen.getByRole('textbox');
    expect(input.getAttribute('rows')).toBe('3');
    expect(input.getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');
    expect(input.classList.contains('min-h-24')).toBe(true);
    expect(input.classList.contains('max-h-48')).toBe(true);
    expect(input.classList.contains('min-h-32')).toBe(false);
    expect(input.classList.contains('sm:min-h-36')).toBe(false);
  });

  it.each(ILLUSTRATION_STYLES)(
    'shows $name as the canonical English style label',
    (style) => {
      renderPromptComposer({ illustrationStyle: style.id });

      expect(screen.getByRole('combobox', { name: 'Style' }).textContent)
        .toContain(style.name);
    },
  );

  it('uses the active locale for the selected style and its visible menu description', () => {
    const copy = getIllustrationStyleCopy('km', 'binance-master');
    const nextStyle = getIllustrationStyleCopy('km', 'pixel-art');
    const onIllustrationStyleChange = vi.fn();
    renderPromptComposer({
      language: 'km',
      illustrationStyle: 'binance-master',
      onIllustrationStyleChange,
    });

    const selector = screen.getByRole('combobox', { name: 'Style' });
    expect(selector.textContent).toContain(copy.name);
    expect(selector.textContent).not.toContain(copy.description);
    expect(selector.textContent).not.toContain('Binance All-In-One');

    fireEvent.click(selector);
    expect(screen.getByText(copy.description)).toBeTruthy();

    fireEvent.click(screen.getByRole('option', { name: new RegExp(nextStyle.name) }));
    expect(onIllustrationStyleChange).toHaveBeenCalledWith('pixel-art');
  });

  it('keeps prompt editing controlled by the caller', () => {
    const onPromptChange = vi.fn();
    renderPromptComposer({ prompt: 'Initial draft', onPromptChange });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated draft' },
    });

    expect(onPromptChange).toHaveBeenCalledOnce();
    expect(onPromptChange).toHaveBeenCalledWith('Updated draft');
  });

  it('keeps labels and feedback instance-safe when two composers render together', () => {
    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(PromptComposer, {
          prompt: 'First draft',
          onPromptChange: () => undefined,
          slideCount: 5,
          onSlideCountChange: () => undefined,
          illustrationStyle: 'lab-notes',
          onIllustrationStyleChange: () => undefined,
          onGenerate: () => undefined,
          labels: { ...labels, prompt: 'First article idea' },
          error: 'First error',
        }),
        React.createElement(PromptComposer, {
          prompt: 'Second draft',
          onPromptChange: () => undefined,
          slideCount: 3,
          onSlideCountChange: () => undefined,
          illustrationStyle: 'pixel-art',
          onIllustrationStyleChange: () => undefined,
          onGenerate: () => undefined,
          labels: { ...labels, prompt: 'Second article idea' },
          helperText: 'Second helper',
        }),
      ),
    );

    const first = screen.getByRole('textbox', { name: 'First article idea' });
    const second = screen.getByRole('textbox', { name: 'Second article idea' });

    expect(first.id).not.toBe(second.id);
    expect(first.getAttribute('aria-describedby')).not.toBe(second.getAttribute('aria-describedby'));
    const firstFeedback = document.getElementById(first.getAttribute('aria-describedby')!);
    expect(firstFeedback?.textContent).toBe('First error');
    expect(firstFeedback?.classList.contains('text-destructive-text')).toBe(true);
    expect(document.getElementById(second.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Second helper');
  });

  it.each([
    ['Cmd+Enter', { metaKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
  ])('submits exactly once with %s', (_shortcut, modifier) => {
    const onGenerate = vi.fn();
    renderPromptComposer({
      prompt: 'Explain stablecoin settlement for treasury teams.',
      onGenerate,
    });

    const wasNotCancelled = fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      ...modifier,
    });

    expect(wasNotCancelled).toBe(false);
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('leaves plain Enter unhandled so the textarea can insert a newline', () => {
    const onGenerate = vi.fn();
    renderPromptComposer({
      prompt: 'Explain stablecoin settlement for treasury teams.',
      onGenerate,
    });

    const wasNotCancelled = fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
    });

    expect(wasNotCancelled).toBe(true);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('does not submit modifier+Enter while an IME composition is active', () => {
    const onGenerate = vi.fn();
    renderPromptComposer({
      prompt: 'Explain stablecoin settlement for treasury teams.',
      onGenerate,
    });

    const wasNotCancelled = fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    });

    expect(wasNotCancelled).toBe(true);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty prompt', { prompt: '   ' }],
    ['a busy composer', {
      prompt: 'Explain stablecoin settlement for treasury teams.',
      isGenerating: true,
    }],
  ])('guards keyboard and button submission for %s', (_state, overrides) => {
    const onGenerate = vi.fn();
    const { container } = renderPromptComposer({ ...overrides, onGenerate });
    const textbox = screen.getByRole('textbox');
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');

    fireEvent.keyDown(textbox, { key: 'Enter', ctrlKey: true });
    fireEvent.submit(container.querySelector('form')!);

    expect(submit?.disabled).toBe(true);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('keeps the responsive Generate control labeled for assistive technology', () => {
    renderPromptComposer({
      prompt: 'Explain stablecoin settlement for treasury teams.',
    });

    const submit = screen.getByRole('button', { name: 'Create article' });
    const visualLabel = Array.from(submit.querySelectorAll('span'))
      .find((element) => element.textContent === 'Create article');

    expect(submit.getAttribute('aria-label')).toBe('Create article');
    expect(submit.classList.contains('max-[389px]:size-9')).toBe(true);
    expect(submit.classList.contains('max-[389px]:p-0')).toBe(true);
    expect(visualLabel).toBeTruthy();
    expect(visualLabel?.classList.contains('hidden')).toBe(true);
    expect(visualLabel?.classList.contains('min-[390px]:inline')).toBe(true);
  });

  it('keeps the workspace AI Suggest action shrink-safe and labeled', () => {
    const onSuggest = vi.fn();
    const { container } = render(
      React.createElement(PromptComposer, {
        prompt: 'Explain stablecoin settlement for treasury teams.',
        onPromptChange: () => undefined,
        slideCount: 5,
        onSlideCountChange: () => undefined,
        illustrationStyle: 'lab-notes',
        onIllustrationStyleChange: () => undefined,
        onGenerate: () => undefined,
        onSuggest,
        showSuggest: true,
        labels: {
          ...labels,
          suggest: 'AI Suggest',
          suggesting: 'Generating a detailed prompt suggestion…',
        },
        isSuggesting: true,
      }),
    );

    const suggest = screen.getByRole('button', {
      name: 'Generating a detailed prompt suggestion…',
    });
    const visualLabel = suggest.querySelector('span');
    const trailing = container.querySelector('[data-slot="ai-prompt-box-toolbar-trailing"] > div');

    expect(suggest.classList.contains('min-w-0')).toBe(true);
    expect(suggest.classList.contains('shrink')).toBe(true);
    expect(visualLabel?.classList.contains('truncate')).toBe(true);
    expect(trailing?.classList.contains('grid-cols-[minmax(0,1fr)_auto]')).toBe(true);
  });
});
