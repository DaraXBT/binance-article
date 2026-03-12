import { waitUntil } from '@vercel/functions';

export async function startWorkflow<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<unknown>,
  args: TArgs
) {
  const runId = crypto.randomUUID();

  const promise = handler(...args).catch((error) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'workflow.background.failed',
        runId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })
    );
  });

  if (process.env.VERCEL) {
    waitUntil(promise);
  }

  return { runId };
}
