'use client'

import * as React from 'react'

import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type AiPromptBoxProps = React.ComponentProps<'div'> & {
  busy?: boolean
  invalid?: boolean
}

type FocusOrigin = 'keyboard' | 'pointer'

function AiPromptBox({
  busy = false,
  invalid = false,
  className,
  children,
  onBlurCapture,
  onFocusCapture,
  onKeyDownCapture,
  onPointerDownCapture,
  ...props
}: AiPromptBoxProps) {
  const focusOriginRef = React.useRef<FocusOrigin>('keyboard')
  const [keyboardFocused, setKeyboardFocused] = React.useState(false)

  React.useEffect(() => {
    const handleDocumentPointerDown = () => {
      focusOriginRef.current = 'pointer'
    }
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        focusOriginRef.current = 'keyboard'
      }
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown, true)
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
      document.removeEventListener('keydown', handleDocumentKeyDown, true)
    }
  }, [])

  return (
    <div
      data-slot="ai-prompt-box"
      data-busy={busy || undefined}
      data-invalid={invalid || undefined}
      data-focus-origin={keyboardFocused ? 'keyboard' : undefined}
      data-focus-visible={keyboardFocused ? 'true' : undefined}
      aria-busy={busy || undefined}
      className={cn(
        'relative min-w-0 rounded-2xl border border-border/80 bg-card/95 shadow-sm',
        'transition-[border-color,background-color] duration-200 motion-reduce:transition-none',
        keyboardFocused && 'border-ring ring-[3px] ring-ring/40 ring-offset-2 ring-offset-background',
        'forced-colors:data-[focus-visible=true]:outline-2 forced-colors:data-[focus-visible=true]:outline-offset-2',
        invalid && keyboardFocused && 'ring-destructive/30',
        'data-[busy=true]:bg-card',
        className,
      )}
      onPointerDownCapture={(event) => {
        focusOriginRef.current = 'pointer'
        setKeyboardFocused(false)
        event.currentTarget.dataset.focusOrigin = 'pointer'
        delete event.currentTarget.dataset.focusVisible
        onPointerDownCapture?.(event)
      }}
      onFocusCapture={(event) => {
        const isKeyboardFocus = focusOriginRef.current === 'keyboard'
        setKeyboardFocused(isKeyboardFocus)
        event.currentTarget.dataset.focusOrigin = focusOriginRef.current
        if (isKeyboardFocus) event.currentTarget.dataset.focusVisible = 'true'
        else delete event.currentTarget.dataset.focusVisible
        onFocusCapture?.(event)
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Tab') {
          focusOriginRef.current = 'keyboard'
          event.currentTarget.dataset.focusOrigin = 'keyboard'
        }
        onKeyDownCapture?.(event)
      }}
      onBlurCapture={(event) => {
        const nextFocus = event.relatedTarget as Node | null
        if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
          setKeyboardFocused(false)
          delete event.currentTarget.dataset.focusOrigin
          delete event.currentTarget.dataset.focusVisible
        }
        onBlurCapture?.(event)
      }}
      {...props}
    >
      <div
        data-slot="ai-prompt-box-content"
        className="overflow-hidden rounded-[inherit]"
      >
        {children}
      </div>
    </div>
  )
}

const AiPromptBoxTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<typeof Textarea>
>(({ className, ...props }, ref) => (
  <Textarea
    ref={ref}
    data-ai-prompt-box-textarea
    className={cn(
      'ai-prompt-box-textarea min-h-24 max-h-48 resize-none overflow-y-auto rounded-none border-0 bg-transparent',
      'px-4 py-3 text-base leading-6 shadow-none field-sizing-content md:text-base',
      'placeholder:text-muted-foreground',
      'outline-none! shadow-none! focus:border-transparent! focus:ring-0! focus:ring-offset-0!',
      'focus-visible:border-transparent! focus-visible:ring-0! focus-visible:ring-offset-0!',
      'disabled:bg-transparent disabled:opacity-60',
      className,
    )}
    {...props}
  />
))
AiPromptBoxTextarea.displayName = 'AiPromptBoxTextarea'

type AiPromptBoxToolbarProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  leading: React.ReactNode
  trailing: React.ReactNode
}

function AiPromptBoxToolbar({
  leading,
  trailing,
  className,
  ...props
}: AiPromptBoxToolbarProps) {
  return (
    <div
      data-slot="ai-prompt-box-toolbar"
      className={cn(
        'grid min-w-0 gap-2 border-t border-border/65 px-3 pb-3 pt-2.5',
        'sm:flex sm:items-center sm:justify-between',
        className,
      )}
      {...props}
    >
      <div
        data-slot="ai-prompt-box-toolbar-leading"
        className="min-w-0"
      >
        {leading}
      </div>
      <div
        data-slot="ai-prompt-box-toolbar-trailing"
        className="min-w-0 shrink-0"
      >
        {trailing}
      </div>
    </div>
  )
}

export {
  AiPromptBox,
  AiPromptBoxTextarea,
  AiPromptBoxToolbar,
  type AiPromptBoxProps,
  type AiPromptBoxToolbarProps,
}
