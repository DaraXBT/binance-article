export type AppErrorOptions = {
  code: string;
  message: string;
  status: number;
  cause?: unknown;
};

export class AppError extends Error {
  code: string;
  status: number;
  cause?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
