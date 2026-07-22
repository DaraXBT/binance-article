import { describe, expect, it } from 'bun:test';

import {
  buildCompanionDoctorReport,
  type CompanionDoctorProbe,
} from '../src/doctor';

const healthyProbe: CompanionDoctorProbe = {
  bunVersion: '1.3.11',
  chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  keyringAvailable: true,
  configState: 'paired',
  requiredFiles: {
    binanceAdapter: true,
    xAdapter: true,
  },
  dependenciesLoadable: {
    binanceAdapter: true,
    xAdapter: true,
  },
  platform: 'darwin',
};

describe('publisher companion doctor', () => {
  it('reports a clean machine as ready without exposing paths as secrets', () => {
    const report = buildCompanionDoctorReport(healthyProbe);

    expect(report.ready).toBe(true);
    expect(report.checks.every((check) => check.level !== 'error')).toBe(true);
    expect(report.checks.some((check) => check.id === 'browser')).toBe(true);
  });

  it('blocks when Chrome, the keyring, or bundled adapter dependencies are missing', () => {
    const report = buildCompanionDoctorReport({
      ...healthyProbe,
      chromePath: null,
      keyringAvailable: false,
      dependenciesLoadable: {
        binanceAdapter: false,
        xAdapter: false,
      },
    });

    expect(report.ready).toBe(false);
    expect(report.checks.filter((check) => check.level === 'error').map((check) => check.id))
      .toEqual(expect.arrayContaining(['browser', 'keyring', 'binance-dependencies', 'x-dependencies']));
  });

  it('treats an unpaired installation as actionable but not a broken installation', () => {
    const report = buildCompanionDoctorReport({ ...healthyProbe, configState: 'unpaired' });

    expect(report.ready).toBe(true);
    expect(report.checks.find((check) => check.id === 'pairing')).toMatchObject({
      level: 'warning',
    });
  });
});
