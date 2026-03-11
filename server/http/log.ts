type LogLevel = 'info' | 'warn' | 'error';

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const payload = {
    level,
    event,
    ...fields,
    timestamp: new Date().toISOString(),
  };

  const serialized = JSON.stringify(payload);

  if (level === 'error') {
    console.error(serialized);
    return;
  }

  if (level === 'warn') {
    console.warn(serialized);
    return;
  }

  console.info(serialized);
}
