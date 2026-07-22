// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AiPromptBox,
  AiPromptBoxTextarea,
  AiPromptBoxToolbar,
} from './ai-prompt-box';

describe('AiPromptBox', () => {
  afterEach(() => cleanup());

  it('exposes the compound shell and toolbar while forwarding the textarea ref', () => {
    const textareaRef = React.createRef<HTMLTextAreaElement>();
    const { container } = render(
      <AiPromptBox busy invalid>
        <AiPromptBoxTextarea ref={textareaRef} aria-label="Prompt" defaultValue="Draft" />
        <AiPromptBoxToolbar
          leading={<button type="button">Leading action</button>}
          trailing={<button type="button">Trailing action</button>}
        />
      </AiPromptBox>,
    );

    const shell = container.querySelector('[data-slot="ai-prompt-box"]');
    const content = container.querySelector('[data-slot="ai-prompt-box-content"]');
    const textarea = screen.getByRole('textbox', { name: 'Prompt' });

    expect(shell).toBeTruthy();
    expect(shell?.getAttribute('data-busy')).toBe('true');
    expect(shell?.getAttribute('data-invalid')).toBe('true');
    expect(shell?.getAttribute('aria-busy')).toBe('true');
    expect(shell?.classList.contains('overflow-hidden')).toBe(false);
    expect(shell?.classList.contains('ring-[3px]')).toBe(false);
    expect(shell?.classList.contains('data-[focus-origin=keyboard]:has-[.ai-prompt-box-textarea:focus-visible]:ring-[3px]')).toBe(false);
    expect(content?.classList.contains('overflow-hidden')).toBe(true);
    expect(content?.classList.contains('rounded-[inherit]')).toBe(true);
    expect(container.querySelector('[data-slot="ai-prompt-box-toolbar"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="ai-prompt-box-toolbar-leading"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="ai-prompt-box-toolbar-trailing"]')).toBeTruthy();
    expect(textareaRef.current).toBe(textarea);
    expect(textarea.classList.contains('focus-visible:ring-0!')).toBe(true);
  });

  it('keeps pointer typing clean while retaining a keyboard-only card halo', () => {
    const { container } = render(
      <>
        <button type="button">Outside action</button>
        <AiPromptBox>
          <AiPromptBoxTextarea aria-label="Prompt" />
        </AiPromptBox>
      </>,
    );
    const shell = container.querySelector('[data-slot="ai-prompt-box"]');
    const textarea = screen.getByRole('textbox', { name: 'Prompt' });
    const outsideAction = screen.getByRole('button', { name: 'Outside action' });

    fireEvent.pointerDown(textarea);
    fireEvent.focus(textarea);
    expect(shell?.getAttribute('data-focus-origin')).toBe('pointer');
    expect(shell?.hasAttribute('data-focus-visible')).toBe(false);

    fireEvent.keyDown(textarea, { key: 'a' });
    expect(shell?.getAttribute('data-focus-origin')).toBe('pointer');

    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(shell?.getAttribute('data-focus-origin')).toBe('keyboard');
    fireEvent.focus(textarea);
    expect(shell?.getAttribute('data-focus-visible')).toBe('true');

    fireEvent.blur(textarea, { relatedTarget: document.body });
    expect(shell?.hasAttribute('data-focus-origin')).toBe(false);
    expect(shell?.hasAttribute('data-focus-visible')).toBe(false);

    fireEvent.focus(textarea);
    expect(shell?.getAttribute('data-focus-origin')).toBe('keyboard');
    expect(shell?.getAttribute('data-focus-visible')).toBe('true');

    fireEvent.blur(textarea, { relatedTarget: outsideAction });
    fireEvent.pointerDown(outsideAction);
    fireEvent.focus(textarea);
    expect(shell?.getAttribute('data-focus-origin')).toBe('pointer');
    expect(shell?.hasAttribute('data-focus-visible')).toBe(false);
  });

  it('uses content sizing up to the established height cap and then scrolls internally', () => {
    render(<AiPromptBoxTextarea aria-label="Prompt" rows={3} />);

    const textarea = screen.getByRole('textbox', { name: 'Prompt' });
    expect(textarea.getAttribute('rows')).toBe('3');
    expect(textarea.classList.contains('field-sizing-content')).toBe(true);
    expect(textarea.classList.contains('min-h-24')).toBe(true);
    expect(textarea.classList.contains('max-h-48')).toBe(true);
    expect(textarea.classList.contains('overflow-y-auto')).toBe(true);
    expect(textarea.classList.contains('resize-none')).toBe(true);
    expect(textarea.classList.contains('py-3')).toBe(true);
    expect(textarea.classList.contains('pt-0')).toBe(false);
    expect(textarea.classList.contains('pt-4')).toBe(false);
    expect(textarea.classList.contains('placeholder:text-muted-foreground')).toBe(true);
    expect(textarea.classList.contains('placeholder:text-muted-foreground/60')).toBe(false);
  });
});
