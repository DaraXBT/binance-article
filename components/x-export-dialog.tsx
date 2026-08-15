'use client';

import { PublicationExportDialog } from '@/components/publication-export-dialog';
import type { DeckDetailResponse } from '@/lib/schemas';

type XExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: DeckDetailResponse;
};

export function XExportDialog(props: XExportDialogProps) {
  return <PublicationExportDialog platform="x" {...props} />;
}
