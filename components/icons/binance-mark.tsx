import type { ComponentProps } from 'react';

export function BinanceMark(props: ComponentProps<'svg'>) {
  return (
    <svg
      data-binance-mark
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="m16.624 13.92 2.717 2.717-7.353 7.353-7.353-7.353 2.717-2.717 4.636 4.636 4.636-4.636Zm4.636-4.636L23.977 12l-2.717 2.717L18.544 12l2.716-2.716Zm-18.544 0L5.433 12l-2.717 2.717L0 12l2.716-2.716Zm9.272 0L14.705 12l-2.717 2.717L9.271 12l2.717-2.716Zm-7.353-2L11.988 0l7.353 7.353-2.717 2.717-4.636-4.636-4.636 4.636-2.717-2.717Z" />
    </svg>
  );
}
