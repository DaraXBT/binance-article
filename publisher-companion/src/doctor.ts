import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  getCompanionConfigPath,
  loadCompanionConfig,
} from './config';
import { KeyringCredentialStore } from './credential-store';

const KEYRING_SERVICE = 'xarticle-publisher';
const COMPANION_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DISTRIBUTION_ROOT = path.dirname(COMPANION_ROOT);
const BINANCE_ADAPTER_PATH = path.join(
  DISTRIBUTION_ROOT,
  '.agents/skills/baoyu-post-to-binance-square/scripts/bundle-publisher.ts',
);
const X_ADAPTER_PATH = path.join(
  DISTRIBUTION_ROOT,
  '.agents/skills/baoyu-post-to-x/scripts/x-utils.ts',
);

export type CompanionDoctorLevel = 'ok' | 'warning' | 'error';

export interface CompanionDoctorCheck {
  id: string;
  level: CompanionDoctorLevel;
  message: string;
}

export interface CompanionDoctorProbe {
  bunVersion: string | null;
  chromePath: string | null;
  keyringAvailable: boolean;
  configState: 'paired' | 'unpaired' | 'invalid';
  requiredFiles: {
    binanceAdapter: boolean;
    xAdapter: boolean;
  };
  dependenciesLoadable: {
    binanceAdapter: boolean;
    xAdapter: boolean;
  };
  platform: NodeJS.Platform;
}

export interface CompanionDoctorReport {
  ready: boolean;
  checks: CompanionDoctorCheck[];
}

function check(
  id: string,
  condition: boolean,
  success: string,
  failure: string,
): CompanionDoctorCheck {
  return {
    id,
    level: condition ? 'ok' : 'error',
    message: condition ? success : failure,
  };
}

export function buildCompanionDoctorReport(
  probe: CompanionDoctorProbe,
): CompanionDoctorReport {
  const checks: CompanionDoctorCheck[] = [
    check(
      'runtime',
      Boolean(probe.bunVersion),
      `Bun ${probe.bunVersion} is available.`,
      'Bun is required to run the publisher companion.',
    ),
    check(
      'browser',
      Boolean(probe.chromePath),
      'A supported Chrome or Chromium browser is available.',
      'Chrome or Chromium was not found. Install it or set X_BROWSER_CHROME_PATH.',
    ),
    check(
      'keyring',
      probe.keyringAvailable,
      'Operating-system keyring storage is available.',
      'Operating-system keyring storage is unavailable.',
    ),
    check(
      'binance-files',
      probe.requiredFiles.binanceAdapter,
      'The Binance adapter is bundled.',
      'The Binance adapter is missing from this distribution.',
    ),
    check(
      'x-files',
      probe.requiredFiles.xAdapter,
      'The X adapter is bundled.',
      'The X adapter is missing from this distribution.',
    ),
    check(
      'binance-dependencies',
      probe.dependenciesLoadable.binanceAdapter,
      'The Binance adapter dependencies can be loaded.',
      'The Binance adapter dependencies are not installed.',
    ),
    check(
      'x-dependencies',
      probe.dependenciesLoadable.xAdapter,
      'The X adapter dependencies can be loaded.',
      'The X adapter dependencies are not installed.',
    ),
  ];

  checks.push(probe.configState === 'paired'
    ? { id: 'pairing', level: 'ok', message: 'A publisher device token is stored in the keyring.' }
    : probe.configState === 'unpaired'
      ? { id: 'pairing', level: 'warning', message: 'This computer is not paired yet.' }
      : { id: 'pairing', level: 'error', message: 'The companion pairing configuration is incomplete.' });

  if (probe.platform === 'darwin') {
    checks.push({
      id: 'permissions',
      level: 'warning',
      message: 'macOS may ask for Accessibility and clipboard permission when images are prepared.',
    });
  }

  return {
    ready: checks.every((item) => item.level !== 'error'),
    checks,
  };
}

function findBrowser(): string | null {
  const override = process.env.X_BROWSER_CHROME_PATH?.trim();
  if (override && fs.existsSync(override)) return override;
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
        ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function canLoad(modulePath: string, exists: boolean): Promise<boolean> {
  if (!exists) return false;
  try {
    await import(pathToFileURL(modulePath).href);
    return true;
  } catch {
    return false;
  }
}

async function pairingState(): Promise<CompanionDoctorProbe['configState']> {
  try {
    const config = await loadCompanionConfig(getCompanionConfigPath());
    const credentials = new KeyringCredentialStore({
      service: KEYRING_SERVICE,
      account: config.deviceId,
    });
    await credentials.read();
    return 'paired';
  } catch (error) {
    return error instanceof Error && /does not exist|not paired|not found/i.test(error.message)
      ? 'unpaired'
      : 'invalid';
  }
}

export async function runCompanionDoctor(): Promise<CompanionDoctorReport> {
  const binanceAdapter = fs.existsSync(BINANCE_ADAPTER_PATH);
  const xAdapter = fs.existsSync(X_ADAPTER_PATH);
  let keyringAvailable = false;
  try {
    await new KeyringCredentialStore({
      service: KEYRING_SERVICE,
      account: 'availability-probe',
    }).assertAvailable();
    keyringAvailable = true;
  } catch {
    keyringAvailable = false;
  }

  return buildCompanionDoctorReport({
    bunVersion: process.versions.bun ?? null,
    chromePath: findBrowser(),
    keyringAvailable,
    configState: await pairingState(),
    requiredFiles: { binanceAdapter, xAdapter },
    dependenciesLoadable: {
      binanceAdapter: await canLoad(BINANCE_ADAPTER_PATH, binanceAdapter),
      xAdapter: await canLoad(X_ADAPTER_PATH, xAdapter),
    },
    platform: process.platform,
  });
}

export function formatCompanionDoctorReport(report: CompanionDoctorReport): string {
  const marker: Record<CompanionDoctorLevel, string> = {
    ok: 'OK',
    warning: 'WARN',
    error: 'ERROR',
  };
  return report.checks
    .map((item) => `[${marker[item.level]}] ${item.message}`)
    .join('\n');
}
