type CutoverMaintenanceInput = {
  mode?: string;
  allowedIps?: string;
  connectingIp?: string;
};

export type CutoverMaintenanceDecision = Readonly<{
  blocked: boolean;
}>;

const DISABLED_MODES = new Set([undefined, '', 'off']);
const MAX_ALLOWLIST_LENGTH = 1_024;
const MAX_ALLOWLIST_ENTRIES = 16;
const IP_LITERAL_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;

function parseAllowedIps(raw: string | undefined): Set<string> {
  if (!raw || raw.length > MAX_ALLOWLIST_LENGTH) return new Set();

  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => IP_LITERAL_PATTERN.test(entry));

  if (entries.length > MAX_ALLOWLIST_ENTRIES) return new Set();
  return new Set(entries);
}

export function evaluateCutoverMaintenance({
  mode,
  allowedIps,
  connectingIp,
}: CutoverMaintenanceInput): CutoverMaintenanceDecision {
  if (DISABLED_MODES.has(mode)) return { blocked: false };

  // Any nonempty, noncanonical mode fails closed so an operator typo cannot
  // silently lift an active production freeze.
  if (mode !== 'full') return { blocked: true };

  const clientIp = connectingIp?.trim();
  if (!clientIp || !IP_LITERAL_PATTERN.test(clientIp)) return { blocked: true };

  return { blocked: !parseAllowedIps(allowedIps).has(clientIp) };
}
