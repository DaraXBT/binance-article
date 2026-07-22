import path from 'node:path';

import { PublisherApiClient, PublisherApiError } from './api-client';
import { parseCompanionArguments } from './cli';
import {
  getCompanionConfigPath,
  loadCompanionConfig,
  saveCompanionConfig,
} from './config';
import { KeyringCredentialStore } from './credential-store';
import { formatCompanionDoctorReport, runCompanionDoctor } from './doctor';
import { acquireCompanionLock } from './lock';
import { runPublisherLoop } from './loop';
import { runPublisherOnce } from './runner';
import { BaoyuBinanceSkillAdapter } from './skill-adapter';
import { LocalBundleWorkspace } from './workspace';
import { BaoyuXSkillAdapter } from './x-adapter';

const KEYRING_SERVICE = 'xarticle-publisher';

async function readPairingCode(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > 1_024) throw new Error('Pairing input is too long.');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  process.stdout.write('Pairing code: ');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error('Pairing cancelled.'));
          return;
        }
        if (byte === 10 || byte === 13) {
          cleanup();
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    };
    process.stdin.on('data', onData);
  });
}

async function pair(baseUrl: string): Promise<void> {
  const availability = new KeyringCredentialStore({
    service: KEYRING_SERVICE,
    account: 'availability-probe',
  });
  await availability.assertAvailable();
  const api = new PublisherApiClient({
    baseUrl,
    getDeviceToken: async () => { throw new Error('Device is not paired.'); },
  });
  const paired = await api.pairDevice(await readPairingCode());
  const credentials = new KeyringCredentialStore({
    service: KEYRING_SERVICE,
    account: paired.device.id,
  });
  await credentials.save(paired.deviceToken);
  await saveCompanionConfig(getCompanionConfigPath(), {
    baseUrl,
    deviceId: paired.device.id,
  });
  process.stdout.write(`Paired publisher device ${paired.device.id}.\n`);
}

async function run(once: boolean): Promise<void> {
  const configPath = getCompanionConfigPath();
  const config = await loadCompanionConfig(configPath);
  const credentials = new KeyringCredentialStore({
    service: KEYRING_SERVICE,
    account: config.deviceId,
  });
  const api = new PublisherApiClient({
    baseUrl: config.baseUrl,
    getDeviceToken: () => credentials.read(),
  });
  const lock = await acquireCompanionLock(path.join(path.dirname(configPath), 'companion.lock'));
  const runOnce = () => runPublisherOnce({
    api,
    adapters: {
      'binance-square': new BaoyuBinanceSkillAdapter(),
      x: new BaoyuXSkillAdapter(),
    },
    workspace: new LocalBundleWorkspace(),
  });
  try {
    if (once) {
      const result = await runOnce();
      process.stdout.write(`Publisher outcome: ${result.outcome}.\n`);
      return;
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await runPublisherLoop({ signal: controller.signal, runOnce });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  } finally {
    await lock.release();
  }
}

async function doctor(): Promise<void> {
  const report = await runCompanionDoctor();
  process.stdout.write(`${formatCompanionDoctorReport(report)}\n`);
  if (!report.ready) throw new Error('Publisher companion doctor found blocking issues.');
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCompanionArguments(argv);
  if (args.command === 'pair') await pair(args.baseUrl);
  else if (args.command === 'doctor') await doctor();
  else await run(args.once);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof PublisherApiError
      ? error.message
      : error instanceof Error && /keyring|pair|doctor|already running/i.test(error.message)
        ? error.message
        : 'Publisher companion stopped safely.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
