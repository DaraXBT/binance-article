export async function startWorkflow<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<unknown>,
  args: TArgs
) {
  if (process.env.NODE_ENV === 'test' || !process.env.VERCEL) {
    const runId = crypto.randomUUID();

    setTimeout(() => {
      void handler(...args).catch((error) => {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'workflow.fallback.failed',
            runId,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          })
        );
      });
    }, 0);

    return { runId };
  }

  const { start } = await import('workflow/api');
  return start(handler, args);
}
