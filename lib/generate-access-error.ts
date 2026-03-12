export const GENERATE_ACCESS_REQUIRED_CODE = 'GENERATE_ACCESS_REQUIRED';

export class GenerateAccessError extends Error {
  readonly code = GENERATE_ACCESS_REQUIRED_CODE;

  constructor(message = 'Generation access code required.') {
    super(message);
    this.name = 'GenerateAccessError';
  }

  static isGenerateAccessResponse(status: number, data: unknown): boolean {
    return (
      status === 403 &&
      typeof data === 'object' &&
      data !== null &&
      'code' in data &&
      (data as Record<string, unknown>).code === GENERATE_ACCESS_REQUIRED_CODE
    );
  }
}
