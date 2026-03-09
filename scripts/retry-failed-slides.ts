import prisma from '../lib/prisma';
import { generateImage, getStyleDescription, buildImagePrompt, uploadToBlob, normalizeImageGenerationError } from '../lib/image-gen';

// Wait utility
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryFailedSlides() {
  console.log('Fetching failed slides...');
  const slides = await prisma.slide.findMany({
    where: { imageStatus: 'failed' },
    include: { deck: true }
  });

  if (slides.length === 0) {
    console.log('No failed slides found.');
    return;
  }

  console.log(`Found ${slides.length} failed slides. Will retry...`);

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    if (!slide.imagePrompt) continue;
    
    let generated = false;
    let attempts = 0;
    
    while (!generated && attempts < 5) {
      attempts++;
      console.log(`[${i+1}/${slides.length}] (Attempt ${attempts}) Generating image for slide ${slide.id}...`);
      try {
        const styleDesc = getStyleDescription(slide.deck.illustrationStyle);
        const fullPrompt = buildImagePrompt(styleDesc, slide.imagePrompt);
        const res = await generateImage(fullPrompt);
        
        const ext = res.mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const filename = `decks/${slide.deckId}/slide-${String(slide.order + 1).padStart(2, '0')}.${ext}`;
        
        const url = await uploadToBlob(res.buffer, filename, res.mimeType);
        
        await prisma.slide.update({
          where: { id: slide.id },
          data: { imageUrl: url, imageStatus: 'generated', imageError: null }
        });
        console.log(`Success: ${url}`);
        generated = true;
      } catch (e: any) {
        const errorInfo = normalizeImageGenerationError(e);
        if (errorInfo.statusCode === 429 || errorInfo.providerStatus === 'RESOURCE_EXHAUSTED') {
          const delayInSeconds = errorInfo.retryAfterSeconds || 60;
          console.log(`Quota exceeded. Waiting for ${delayInSeconds} seconds before retrying...`);
          await wait(delayInSeconds * 1000 + 2000); // Add 2 seconds padding
        } else {
          console.error(`Failed to generate slide ${slide.id} with non-quota error:`, errorInfo.message);
          break; // Don't retry non-quota errors
        }
      }
    }
    
    if (!generated) {
       console.log(`Skipping slide ${slide.id} after failing to generate.`);
    }
  }
  console.log('Done retrying all slides.');
}

retryFailedSlides().catch(console.error);
