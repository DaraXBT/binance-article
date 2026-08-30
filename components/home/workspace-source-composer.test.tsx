// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSourceComposer } from './workspace-source-composer';

const labels = {
  sourceLabel: 'Article source', sourcePrompt: 'Topic', sourceText: 'Paste text', sourceUrl: 'Import URL',
  topicLabel: 'Topic', topicPlaceholder: 'Enter a topic', textLabel: 'Article text', textPlaceholder: 'Paste text',
  urlLabel: 'Webpage URL', urlPlaceholder: 'https://example.com/article', urlHint: 'HTTPS only',
  urlInvalid: 'Enter a valid HTTPS URL', slideCount: 'Slides', illustrationStyle: 'Style',
  generate: 'Generate article', generateUrl: 'Import & generate', generating: 'Generating article...',
  suggest: 'AI Suggest', suggesting: 'Suggesting...',
};

function renderComposer(overrides: Partial<ComponentProps<typeof WorkspaceSourceComposer>> = {}) {
  return render(<WorkspaceSourceComposer
    source="prompt"
    onSourceChange={() => undefined}
    value=""
    onValueChange={() => undefined}
    slideCount={5}
    onSlideCountChange={() => undefined}
    illustrationStyle="binance-master"
    onIllustrationStyleChange={() => undefined}
    onGenerate={() => undefined}
    onSuggest={() => undefined}
    labels={labels}
    {...overrides}
  />);
}

describe('WorkspaceSourceComposer', () => {
  afterEach(cleanup);

  it('offers all consolidated source modes', () => {
    renderComposer();
    expect(screen.getByRole('tab', { name: 'Topic' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Paste text' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Import URL' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI Suggest' })).toBeTruthy();
  });

  it('uses a URL input and blocks invalid URL generation', () => {
    renderComposer({ source: 'url', value: 'http://example.com/article' });
    const input = screen.getByRole('textbox', { name: 'Webpage URL' });
    expect(input.getAttribute('type')).toBe('url');
    expect(input.parentElement?.className).toContain('pb-3');
    expect(screen.queryByRole('button', { name: 'AI Suggest' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Import & generate' }).hasAttribute('disabled')).toBe(true);
  });

  it('submits a valid URL and reports source changes', () => {
    const onGenerate = vi.fn();
    const onSourceChange = vi.fn();
    renderComposer({ source: 'url', value: 'https://example.com/article', onGenerate, onSourceChange });
    fireEvent.click(screen.getByRole('button', { name: 'Import & generate' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Paste text' }));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onSourceChange).toHaveBeenCalledWith('text');
  });
});
