ALTER TABLE "TelegramAssistantSettings"
  DROP CONSTRAINT "TelegramAssistantSettings_illustrationStyle_check";
--> statement-breakpoint
ALTER TABLE "TelegramAssistantSettings"
  ADD CONSTRAINT "TelegramAssistantSettings_illustrationStyle_check"
  CHECK ("illustrationStyle" IN (
    'pixel-art',
    'fantasy-animation',
    'lab-notes',
    'binance',
    'binance-master',
    'binance-briefing',
    'binance-mondo-panoramic',
    'binance-sketch-notes',
    'binance-vector-illustration'
  ));
