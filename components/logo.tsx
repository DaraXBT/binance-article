import type { ComponentProps } from 'react';

import { BinanceMark } from '@/components/icons/binance-mark';
import { cn } from '@/lib/utils';

export function Logo({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('inline-flex items-center gap-2.5 text-foreground', className)}
      {...props}
    >
      <span
        data-brand-mark
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-binance-border bg-brand-binance text-brand-binance-foreground"
      >
        <BinanceMark aria-hidden="true" className="size-[1.05rem]" />
      </span>
      <span className="text-sm font-semibold tracking-tight">xArticle</span>
    </div>
  );
}
