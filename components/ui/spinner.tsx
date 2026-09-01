'use client'

import { Loader2Icon } from 'lucide-react'

import { useLanguage } from '@/components/language-provider'
import { getChromeCopy } from '@/lib/chrome-i18n'
import { cn } from '@/lib/utils'

function Spinner({
  className,
  label,
  ...props
}: React.ComponentProps<'svg'> & { label?: string }) {
  const { language } = useLanguage()
  const defaultLabel = label ?? getChromeCopy(language).t('loading')

  return (
    <Loader2Icon
      role="status"
      aria-label={defaultLabel}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
