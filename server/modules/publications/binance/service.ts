import {
  PUBLISHER_DEVICE_ONLINE_WINDOW_MS,
  prepareBinanceSquarePublication,
  type PublicationPreparationContext,
  type PublicationRepository,
  type PreparedPublisherCommand,
} from '../service';

export { PUBLISHER_DEVICE_ONLINE_WINDOW_MS };
export type BinancePreparationContext = PublicationPreparationContext;
export type BinancePublicationRepository = PublicationRepository;
export type { PreparedPublisherCommand };

export const prepareBinancePublication = prepareBinanceSquarePublication;
