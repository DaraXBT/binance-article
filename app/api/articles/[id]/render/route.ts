import { NextRequest, NextResponse } from 'next/server';
import { getDeckProject } from '@/lib/db';
import { createJob, enqueueRenderJob, addJobLog } from '@/lib/job-queue';
import { renderDeck } from '@/lib/render-engine';
import { createDeckAssetDir } from '@/lib/file-utils';
import { getCurrentWorkspace } from '@/lib/workspace';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;

    // Get deck with slides
    const deck = await getDeckProject(deckId, workspace.id);
    if (!deck) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    if (!deck.slides || deck.slides.length === 0) {
      return NextResponse.json(
        { error: 'Deck has no slides to render' },
        { status: 400 }
      );
    }

    // Create job
    const job = createJob(deckId, workspace.id);

    // Enqueue render task
    const assetDir = createDeckAssetDir(deckId);
    await enqueueRenderJob(job.id, deckId, async () => {
      try {
        addJobLog(job.id, 'Starting render process');
        const result = await renderDeck({
          deckId,
          theme: deck.theme || 'default',
          slides: deck.slides,
          outputDir: assetDir,
        });

        addJobLog(job.id, `PNG saved: ${result.pngPath}`);
        addJobLog(job.id, `PPTX saved: ${result.pptxPath}`);
        addJobLog(job.id, `PDF saved: ${result.pdfPath}`);

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        addJobLog(job.id, `Render failed: ${message}`, 'error');
        throw error;
      }
    });

    return NextResponse.json(
      {
        jobId: job.id,
        deckId,
        status: 'queued',
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[API] Error starting render job:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to start render',
      },
      { status: 500 }
    );
  }
}
