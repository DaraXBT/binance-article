import PQueue from 'p-queue';
import { v4 as uuidv4 } from 'uuid';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobLog {
  timestamp: string;
  message: string;
  level: 'info' | 'error' | 'warning' | 'success';
}

export interface RenderJob {
  id: string;
  deckId: string;
  status: JobStatus;
  progress: number; // 0-100
  logs: JobLog[];
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

// In-memory job storage - in production this would be a database
const jobs = new Map<string, RenderJob>();

// Job queue with concurrency limit
export const jobQueue = new PQueue({ concurrency: 2, timeout: 30000 });

export function createJob(deckId: string): RenderJob {
  const job: RenderJob = {
    id: uuidv4(),
    deckId,
    status: 'pending',
    progress: 0,
    logs: [],
    startedAt: null,
    completedAt: null,
    error: null,
  };

  jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): RenderJob | undefined {
  return jobs.get(jobId);
}

export function updateJobStatus(jobId: string, status: JobStatus): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    if (status === 'running' && !job.startedAt) {
      job.startedAt = new Date().toISOString();
    }
    if ((status === 'completed' || status === 'failed') && !job.completedAt) {
      job.completedAt = new Date().toISOString();
    }
  }
}

export function updateJobProgress(jobId: string, progress: number): void {
  const job = jobs.get(jobId);
  if (job) {
    job.progress = Math.min(100, Math.max(0, progress));
  }
}

export function addJobLog(
  jobId: string,
  message: string,
  level: 'info' | 'error' | 'warning' | 'success' = 'info'
): void {
  const job = jobs.get(jobId);
  if (job) {
    job.logs.push({
      timestamp: new Date().toISOString(),
      message,
      level,
    });
  }
}

export function setJobError(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.error = error;
    addJobLog(jobId, error, 'error');
  }
}

export async function enqueueRenderJob(
  jobId: string,
  deckId: string,
  renderFunction: () => Promise<{ pngPath: string; pptxPath: string; pdfPath: string }>
): Promise<void> {
  await jobQueue.add(async () => {
    try {
      updateJobStatus(jobId, 'running');
      addJobLog(jobId, 'Starting render job');

      updateJobProgress(jobId, 10);
      addJobLog(jobId, 'Validating deck data');

      updateJobProgress(jobId, 30);
      addJobLog(jobId, 'Generating PNG assets');

      updateJobProgress(jobId, 60);
      addJobLog(jobId, 'Generating PPTX presentation');

      updateJobProgress(jobId, 80);
      addJobLog(jobId, 'Generating PDF export');

      const result = await renderFunction();

      updateJobProgress(jobId, 100);
      addJobLog(jobId, 'Render completed successfully', 'success');
      updateJobStatus(jobId, 'completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setJobError(jobId, message);
      updateJobStatus(jobId, 'failed');
    }
  });
}

// Cleanup: clear old jobs after 24 hours
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [jobId, job] of jobs.entries()) {
    if (job.completedAt) {
      const age = now - new Date(job.completedAt).getTime();
      if (age > maxAge) {
        jobs.delete(jobId);
      }
    }
  }
}, 60 * 60 * 1000); // Check every hour
