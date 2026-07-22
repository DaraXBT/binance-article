import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const TARGETS = {
  web: [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GEMINI_API_KEY',
  ],
  workflow: ['DATABASE_URL', 'GEMINI_API_KEY'],
};

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateHttpsUrl(name, value, allowLocalhost = false) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return `${name} must be a valid URL.`;
  }
  const local = allowLocalhost && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    return `${name} must use HTTPS${allowLocalhost ? ' outside localhost' : ''}.`;
  }
  if (parsed.username || parsed.password) return `${name} must not contain credentials.`;
  return null;
}

export function validateRuntimeEnvironment(environment, targets = ['web']) {
  const selectedTargets = targets.includes('all') ? Object.keys(TARGETS) : targets;
  const unknown = selectedTargets.filter((target) => !(target in TARGETS));
  if (unknown.length > 0) return [`Unknown runtime target: ${unknown.join(', ')}.`];

  const required = new Set(selectedTargets.flatMap((target) => TARGETS[target]));
  const errors = [...required]
    .filter((name) => !nonempty(environment[name]))
    .map((name) => `${name} is required.`);

  if (nonempty(environment.DATABASE_URL)) {
    let parsed;
    try {
      parsed = new URL(environment.DATABASE_URL);
    } catch {
      errors.push('DATABASE_URL must be a valid PostgreSQL URL.');
    }
    if (parsed) {
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === '/') {
        errors.push('DATABASE_URL must use PostgreSQL and include a host and database name.');
      } else if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) && parsed.searchParams.get('sslmode') !== 'require') {
        errors.push('Remote DATABASE_URL must include sslmode=require.');
      }
    }
  }

  for (const name of ['BETTER_AUTH_URL']) {
    if (nonempty(environment[name])) {
      const error = validateHttpsUrl(name, environment[name], true);
      if (error) errors.push(error);
    }
  }

  if (nonempty(environment.BETTER_AUTH_SECRET) && environment.BETTER_AUTH_SECRET.trim().length < 32) {
    errors.push('BETTER_AUTH_SECRET must contain at least 32 characters.');
  }

  return [...new Set(errors)];
}

export function parseRuntimeTargets(argv) {
  if (argv.length === 0) return ['web'];
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--target' || !argv[index + 1]) {
      throw new Error('Usage: check-runtime-env.mjs [--target web|workflow|all]');
    }
    targets.push(argv[index + 1]);
    index += 1;
  }
  return targets;
}

export async function runRuntimeEnvironmentCheck({
  argv = process.argv.slice(2),
  environment = process.env,
  cwd = process.cwd(),
  log = console.log,
  error = console.error,
} = {}) {
  try {
    if (environment === process.env) {
      const localEnv = resolve(cwd, '.env.local');
      if (existsSync(localEnv) && typeof process.loadEnvFile === 'function') process.loadEnvFile(localEnv);
    }
    const targets = parseRuntimeTargets(argv);
    const errors = validateRuntimeEnvironment(environment, targets);
    if (errors.length > 0) {
      errors.forEach((message) => error(message));
      return 1;
    }
    log(`Runtime environment is valid for ${targets.join(', ')}.`);
    return 0;
  } catch (caught) {
    error(caught instanceof Error ? caught.message : 'Runtime environment validation failed.');
    return 1;
  }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  process.exitCode = await runRuntimeEnvironmentCheck();
}
