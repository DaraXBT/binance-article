export type CompanionArguments =
  | { command: 'pair'; baseUrl: string }
  | { command: 'run'; once: boolean }
  | { command: 'doctor' };

export function parseCompanionArguments(argv: string[]): CompanionArguments {
  if (argv.some((value) => /pairing[-_]?code|device[-_]?token/i.test(value))) {
    throw new Error('Secrets must come from stdin or the operating-system keyring, never argv.');
  }
  const command = argv[0] ?? 'run';
  if (command === 'pair') {
    if (argv.length !== 3 || argv[1] !== '--api' || !argv[2]) {
      throw new Error('Usage: pair --api https://your-private-app.example (pairing code via stdin).');
    }
    return { command: 'pair', baseUrl: argv[2] };
  }
  if (command === 'run') {
    if (argv.length === 1) return { command: 'run', once: false };
    if (argv.length === 2 && argv[1] === '--once') return { command: 'run', once: true };
  }
  if (command === 'doctor' && argv.length === 1) return { command: 'doctor' };
  throw new Error('Usage: run [--once], doctor, or pair --api https://your-private-app.example.');
}
