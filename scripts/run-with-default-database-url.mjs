import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Expected a command to run.');
  process.exit(1);
}

const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:5432/xarticle?schema=public';

const [command, ...commandArgs] = args;
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
