import { z } from 'zod';

const SecretSchema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/);
const IdentifierSchema = z.string().trim().min(1).max(200);
const CommandStateSchema = z.enum([
  'queued', 'claimed', 'awaiting_review', 'awaiting_approval', 'approved', 'publishing',
  'succeeded', 'failed', 'cancelled', 'expired', 'outcome_unknown',
]);
const CommandSchema = z.object({
  id: IdentifierSchema,
  draftId: IdentifierSchema.optional(),
  deviceId: IdentifierSchema.nullable().optional(),
  state: CommandStateSchema,
  revision: z.number().int().positive().safe(),
  recipeHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export type PublisherCommandMetadata = z.infer<typeof CommandSchema>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class PublisherApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(input: { code: string; message: string; status: number; retryAfterSeconds?: number }) {
    super(input.message);
    this.name = 'PublisherApiError';
    this.code = input.code;
    this.status = input.status;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parseBaseUrl(value: string, allowInsecureLocalhost: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Publisher API URL must be a valid HTTPS URL.');
  }
  const localDevelopment = allowInsecureLocalhost && url.protocol === 'http:' && isLocalhost(url.hostname);
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new Error('Publisher API URL must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Publisher API URL must not contain credentials, query parameters, or fragments.');
  }
  url.pathname = '/';
  return url;
}

export class PublisherApiClient {
  readonly #baseUrl: URL;
  readonly #getDeviceToken: () => Promise<string>;
  readonly #fetch: FetchLike;

  constructor(input: {
    baseUrl: string;
    getDeviceToken: () => Promise<string>;
    allowInsecureLocalhost?: boolean;
    fetchImpl?: FetchLike;
  }) {
    this.#baseUrl = parseBaseUrl(input.baseUrl, input.allowInsecureLocalhost === true);
    this.#getDeviceToken = input.getDeviceToken;
    this.#fetch = input.fetchImpl ?? fetch;
  }

  async #request(path: string, input: {
    method?: 'GET' | 'POST';
    body?: unknown;
    authenticated?: boolean;
    headers?: HeadersInit;
  } = {}): Promise<Response> {
    const headers = new Headers({ Accept: 'application/json', ...input.headers });
    if (input.authenticated !== false) {
      const token = SecretSchema.parse(await this.#getDeviceToken());
      headers.set('Authorization', `Bearer ${token}`);
    }
    let body: string | undefined;
    if (input.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(input.body);
    }

    let response: Response;
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: input.method ?? 'GET',
        headers,
        body,
        redirect: 'error',
      });
    } catch {
      throw new PublisherApiError({
        code: 'NETWORK_ERROR', message: 'The publisher API could not be reached.', status: 0,
      });
    }

    if (response.status === 401) {
      throw new PublisherApiError({
        code: 'REPAIR_REQUIRED', message: 'The publisher device must be paired again.', status: 401,
      });
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new PublisherApiError({
        code: 'RATE_LIMITED', message: 'The publisher API is rate limited.', status: 429,
        ...(Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfterSeconds: retryAfter } : {}),
      });
    }
    if (!response.ok) {
      throw new PublisherApiError({
        code: 'API_REQUEST_FAILED', message: 'The publisher API request failed.', status: response.status,
      });
    }
    return response;
  }

  async pairDevice(pairingCode: string) {
    const response = await this.#request('/api/publisher/devices/pair', {
      method: 'POST',
      authenticated: false,
      body: { pairingCode: SecretSchema.parse(pairingCode) },
    });
    return z.object({
      device: z.object({ id: IdentifierSchema }).passthrough(),
      deviceToken: SecretSchema,
    }).strict().parse(await response.json());
  }

  async claimCommand(): Promise<PublisherCommandMetadata | null> {
    const response = await this.#request('/api/publisher/commands/claim', { method: 'POST' });
    if (response.status === 204) return null;
    return z.object({ command: CommandSchema }).strict().parse(await response.json()).command;
  }

  async getCommandStatus(commandId: string): Promise<PublisherCommandMetadata> {
    const response = await this.#request(
      `/api/publisher/commands/${encodeURIComponent(IdentifierSchema.parse(commandId))}/status`,
    );
    return z.object({ command: CommandSchema }).strict().parse(await response.json()).command;
  }

  downloadAsset(commandId: string, assetId: string): Promise<Response> {
    return this.#request(
      `/api/publisher/commands/${encodeURIComponent(IdentifierSchema.parse(commandId))}/assets/${encodeURIComponent(IdentifierSchema.parse(assetId))}`,
      { headers: { 'Accept-Encoding': 'identity' } },
    );
  }
}
