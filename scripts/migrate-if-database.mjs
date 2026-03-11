import { spawn } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.info('DATABASE_URL not set — skipping prisma migrate deploy');
  process.exit(0);
}

const child = spawn('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
