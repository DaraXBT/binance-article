export function publisherCommandForProtocol<T extends { kind?: unknown }>(
  command: T,
  protocolVersion: number | undefined,
): T | Omit<T, 'kind'> {
  if ((protocolVersion ?? 1) >= 2) return command;
  const { kind: _kind, ...legacyCommand } = command;
  return legacyCommand;
}
