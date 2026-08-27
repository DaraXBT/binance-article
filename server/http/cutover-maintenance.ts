type CutoverMaintenanceInput = {
  mode?: string;
  allowedIps?: string;
  connectingIp?: string;
};

export type CutoverMaintenanceDecision = Readonly<{
  blocked: boolean;
}>;

type CutoverMaintenanceEnvironment = Readonly<{
  CUTOVER_MAINTENANCE_MODE?: string;
  CUTOVER_MAINTENANCE_ALLOW_IPS?: string;
}>;

type CutoverMaintenanceResponseInput = {
  request: Request;
  environment: CutoverMaintenanceEnvironment;
};

const DISABLED_MODES = new Set([undefined, '', 'off']);
const MAX_ALLOWLIST_LENGTH = 1_024;
const MAX_ALLOWLIST_ENTRIES = 16;
const IP_LITERAL_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;
const MAINTENANCE_MESSAGE = 'Scheduled maintenance is in progress. Please try again shortly.';
const MAINTENANCE_HEADERS = {
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Retry-After': '120',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
};

function isIpLiteral(value: string): boolean {
  if (!IP_LITERAL_PATTERN.test(value)) return false;

  if (value.includes(':')) {
    try {
      // URL's bracketed-host parser validates IPv6 syntax without accepting a
      // hostname, port, CIDR, or zone identifier as an operator allowlist entry.
      return new URL(`http://[${value}]/`).hostname.length > 2;
    } catch {
      return false;
    }
  }

  const octets = value.split('.');
  return octets.length === 4 && octets.every((octet) => (
    /^(?:0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255
  ));
}

function parseAllowedIps(raw: string | undefined): Set<string> {
  if (!raw || raw.length > MAX_ALLOWLIST_LENGTH) return new Set();

  const entries = raw
    .split(',')
    .map((entry) => entry.trim());

  if (
    entries.length > MAX_ALLOWLIST_ENTRIES
    || entries.some((entry) => !isIpLiteral(entry))
  ) return new Set();
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
  if (!clientIp || !isIpLiteral(clientIp)) return { blocked: true };

  return { blocked: !parseAllowedIps(allowedIps).has(clientIp) };
}

export function createCutoverMaintenanceResponse({
  request,
  environment,
}: CutoverMaintenanceResponseInput): Response | null {
  const decision = evaluateCutoverMaintenance({
    mode: environment.CUTOVER_MAINTENANCE_MODE,
    allowedIps: environment.CUTOVER_MAINTENANCE_ALLOW_IPS,
    connectingIp: request.headers.get('cf-connecting-ip') ?? undefined,
  });
  if (!decision.blocked) return null;

  const url = new URL(request.url);
  const wantsJson = url.pathname.startsWith('/api/')
    || request.headers.get('accept')?.includes('application/json');
  if (wantsJson) {
    return Response.json(
      { error: MAINTENANCE_MESSAGE },
      { status: 503, headers: MAINTENANCE_HEADERS },
    );
  }

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scheduled maintenance</title></head><body><main><h1>We\u2019ll be right back</h1><p>${MAINTENANCE_MESSAGE}</p></main></body></html>`,
    {
      status: 503,
      headers: {
        ...MAINTENANCE_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  );
}
