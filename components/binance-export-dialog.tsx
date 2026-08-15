'use client';

import { PublicationExportDialog } from '@/components/publication-export-dialog';
import type { DeckDetailResponse } from '@/lib/schemas';

type BinanceExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: DeckDetailResponse;
};

export function BinanceExportDialog(props: BinanceExportDialogProps) {
  return <PublicationExportDialog platform="binance" {...props} />;
}
