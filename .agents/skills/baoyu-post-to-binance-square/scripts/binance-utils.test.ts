import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBinanceSessionCookieMap,
  hasChromeLockArtifacts,
  hasRequiredBinanceSessionCookies,
  shouldRetryChromeLaunch,
} from './binance-utils.ts';

test('hasChromeLockArtifacts detects Chrome singleton artifacts', () => {
  assert.equal(hasChromeLockArtifacts(['SingletonSocket']), true);
  assert.equal(hasChromeLockArtifacts(['chrome.pid']), true);
  assert.equal(hasChromeLockArtifacts(['Cookies', 'Preferences']), false);
});

test('shouldRetryChromeLaunch only retries when no live owner exists', () => {
  assert.equal(
    shouldRetryChromeLaunch({ lockArtifactsPresent: true, hasLiveOwner: false }),
    true,
  );
  assert.equal(
    shouldRetryChromeLaunch({ lockArtifactsPresent: true, hasLiveOwner: true }),
    false,
  );
  assert.equal(
    shouldRetryChromeLaunch({ lockArtifactsPresent: false, hasLiveOwner: false }),
    false,
  );
});

test('buildBinanceSessionCookieMap keeps only non-empty cookies', () => {
  assert.deepEqual(
    buildBinanceSessionCookieMap([
      { name: 'com.binance.certification', value: 'cert' },
      { name: 'csrftoken', value: 'csrf' },
      { name: ' bnc-uuid ', value: ' padded ' },
      { name: '', value: 'ignored' },
      { name: 'p20t', value: '' },
      { name: 'lang', value: undefined },
    ]),
    { 'com.binance.certification': 'cert', csrftoken: 'csrf', 'bnc-uuid': 'padded' },
  );
});

test('hasRequiredBinanceSessionCookies accepts either session cookie', () => {
  assert.equal(hasRequiredBinanceSessionCookies({ 'com.binance.certification': 'cert' }), true);
  assert.equal(hasRequiredBinanceSessionCookies({ csrftoken: 'csrf' }), true);
  assert.equal(
    hasRequiredBinanceSessionCookies({ 'com.binance.certification': 'cert', csrftoken: 'csrf' }),
    true,
  );
  assert.equal(hasRequiredBinanceSessionCookies({ theme: 'dark' }), false);
  assert.equal(hasRequiredBinanceSessionCookies({}), false);
});
