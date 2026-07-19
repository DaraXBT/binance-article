import { z } from 'zod';

const PairingCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/);

export async function pairPublisherDevice(input: {
  pairingCode: string;
  api: {
    pairDevice(pairingCode: string): Promise<{ device: { id: string }; deviceToken: string }>;
  };
  credentials: {
    assertAvailable(): Promise<void>;
    save(token: string): Promise<void>;
  };
}) {
  const pairingCode = PairingCodeSchema.parse(input.pairingCode);
  await input.credentials.assertAvailable();
  const paired = await input.api.pairDevice(pairingCode);
  await input.credentials.save(paired.deviceToken);
  return { deviceId: paired.device.id };
}
