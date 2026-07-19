import { z } from 'zod';

const SecretSchema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/);
const NameSchema = z.string().trim().min(1).max(200);

export interface KeyringBackend {
  setPassword(service: string, account: string, password: string): void | Promise<void>;
  getPassword(service: string, account: string): string | null | Promise<string | null>;
  deletePassword(service: string, account: string): boolean | Promise<boolean>;
}

async function systemBackend(): Promise<KeyringBackend> {
  const { Entry } = await import('@napi-rs/keyring');
  return {
    setPassword(service, account, password) {
      new Entry(service, account).setPassword(password);
    },
    getPassword(service, account) {
      return new Entry(service, account).getPassword();
    },
    deletePassword(service, account) {
      new Entry(service, account).deletePassword();
      return true;
    },
  };
}

export class KeyringCredentialStore {
  readonly #service: string;
  readonly #account: string;
  readonly #providedBackend?: KeyringBackend;

  constructor(input: { service: string; account: string; backend?: KeyringBackend }) {
    this.#service = NameSchema.parse(input.service);
    this.#account = NameSchema.parse(input.account);
    this.#providedBackend = input.backend;
  }

  async #backend(): Promise<KeyringBackend> {
    return this.#providedBackend ?? systemBackend();
  }

  async assertAvailable(): Promise<void> {
    try {
      const backend = await this.#backend();
      const probeAccount = `${this.#account}:availability:${crypto.randomUUID()}`;
      const probeSecret = crypto.randomUUID().replaceAll('-', '');
      await backend.setPassword(this.#service, probeAccount, probeSecret);
      await backend.deletePassword(this.#service, probeAccount);
    } catch {
      throw new Error('The operating-system keyring is unavailable.');
    }
  }

  async save(token: string): Promise<void> {
    const secret = SecretSchema.parse(token);
    try {
      await (await this.#backend()).setPassword(this.#service, this.#account, secret);
    } catch {
      throw new Error('The publisher device token could not be saved to the keyring.');
    }
  }

  async read(): Promise<string> {
    try {
      const token = await (await this.#backend()).getPassword(this.#service, this.#account);
      if (!token) throw new Error('missing');
      return SecretSchema.parse(token);
    } catch {
      throw new Error('The publisher device token is unavailable; pair the device again.');
    }
  }

  async delete(): Promise<void> {
    try {
      await (await this.#backend()).deletePassword(this.#service, this.#account);
    } catch {
      throw new Error('The publisher device token could not be removed from the keyring.');
    }
  }
}
