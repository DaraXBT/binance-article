import { spawn } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.info('DATABASE_URL not set — skipping prisma migrate deploy');
  process.exit(0);
}

console.info('Running prisma migrate deploy...');

const child = spawn('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.warn(`prisma migrate deploy terminated by signal ${signal}`);
    process.exit(0);
    return;
  }

  if (code !== 0) {
    console.warn(`prisma migrate deploy exited with code ${code} — continuing build`);
  }

  // Always exit 0 so the build continues even if migration fails.
  // The app will surface DB errors at runtime via /api/health.
  process.exit(0);
});
