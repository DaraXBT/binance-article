# Dot-grid image generation loading

This project adapts Chanh Dai's
[Dot Grid Spotlight](https://chanhdai.com/components/dot-grid-spotlight) into an
autonomous, accessible image-generation loader. The upstream component follows
the cursor; this version can also sweep on its own while an image job is
running.

## 1. Installation

The component is already included in this repository, so application code can
import it directly:

```tsx
import { DotGridSpotlight } from '@/components/ui/dot-grid-spotlight';
```

In another shadcn project, the upstream pointer-only version can be installed
with:

```bash
npx shadcn@latest add @ncdai/dot-grid-spotlight
```

For a plain React/Vite project, copy the component, change the `@/lib/utils`
import to the project's class-name helper, and make sure the TypeScript config
includes the DOM library. Its layout classes require Tailwind CSS; without
Tailwind, replace them with equivalent absolute-canvas and pointer-event CSS.
The `"use client"` directive is required by Next.js App Router and harmless in a
client-only React application.

The shared `ImageGenerationLoader` is project-specific and also imports
`next-themes` and `lucide-react`. A Vite application should replace the theme
hook with its own theme state and either install `lucide-react` or substitute an
icon before copying that wrapper.

## 2. Give the canvas a frame

`DotGridSpotlight` renders an absolutely positioned canvas. Its parent must be
positioned and must have a non-zero size:

```tsx
import { DotGridSpotlight } from '@/components/ui/dot-grid-spotlight';

export function SpotlightExample() {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border bg-black">
      <DotGridSpotlight
        motion="auto-pointer"
        dotColor="rgba(255, 255, 255, 0.08)"
        activeDotColor="rgba(200, 252, 52, 0.5)"
      />
    </div>
  );
}
```

The motion modes are:

- `pointer`: upstream-compatible cursor spotlight and the default.
- `auto`: autonomous sweep without pointer takeover.
- `auto-pointer`: autonomous sweep that yields to the pointer while it is in
  the frame.
- `static`: draw once without motion.

People who prefer reduced motion always receive a static presentation,
regardless of the selected mode.

## 3. Use the semantic loading surface

The canvas is decorative. For product loading states, use the shared wrapper so
assistive technology receives stable status text:

```tsx
import { ImageGenerationLoader } from '@/components/image-generation-loader';

type GeneratedImageProps = {
  processed: number;
  total: number;
};

export function GeneratedImage({ processed, total }: GeneratedImageProps) {
  return (
    <ImageGenerationLoader
      className="aspect-video min-h-0 rounded-xl border"
      label="Generating images"
      detail={`${processed}/${total}`}
    />
  );
}
```

To preserve an existing image during regeneration, provide it as the backdrop:

```tsx
<ImageGenerationLoader
  className="aspect-[5/2] overflow-hidden"
  label="Generating cover"
  size="compact"
  backdrop={
    <img src={currentCoverUrl} alt="Current article cover" className="size-full object-cover" />
  }
/>
```

The wrapper dims the backdrop, keeps the layout stable, marks the region busy,
and exposes the loading label through a polite status region. Only report real
progress supplied by the server; do not synthesize percentages for an
indeterminate provider request.

## 4. How it works

- A DOM ref gives the effect access to the canvas without causing a React
  render for every spotlight position.
- `ResizeObserver` keeps the bitmap aligned with the parent, while a capped
  device-pixel ratio keeps dots crisp without allocating an unnecessarily large
  canvas.
- `requestAnimationFrame` coalesces drawing work. Autonomous motion is capped
  below the display refresh rate and pauses when the page or canvas is not
  visible.
- Pointer events are observed from the parent. The canvas stays non-interactive
  and cannot block buttons placed above it.
- The effect owns every observer, listener, and animation frame and removes
  them when props change or the component unmounts.

## Common pitfalls

- An absolute canvas inside a parent without `relative` positioning or an
  explicit height/aspect ratio will appear missing.
- The upstream component is not a loader by itself; without autonomous motion
  it remains static until the mouse moves.
- Default translucent white dots are almost invisible on a light background.
  Use theme-appropriate colors or the shared loader.
- Very small spacing creates thousands of draw operations. Avoid a canvas in
  every list row. This project uses it for new-article generation, the active
  slide preview, and the dedicated-cover card; slide-list thumbnails
  intentionally use lightweight spinners.
- Invalid negative spacing or radii can hang or throw in an unguarded canvas
  implementation. The project component normalizes numeric inputs.
- The canvas must not be the only loading signal. Keep visible text and
  `aria-busy`/status semantics.
- JSDOM does not implement canvas drawing, `ResizeObserver`, or
  `IntersectionObserver`. Component tests must mock those browser APIs and
  `requestAnimationFrame`.
- The source documentation uses Tailwind 4's postfix important syntax. A
  Tailwind 3 project may need equivalent classes or ordinary CSS.
