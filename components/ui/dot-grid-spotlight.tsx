'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

export type DotGridMotion = 'static' | 'pointer' | 'auto' | 'auto-pointer';

export type DotGridSpotlightProps = {
  /** The base color of the default/inactive dots. */
  dotColor?: string;
  /** The color of dots illuminated by the spotlight. */
  activeDotColor?: string;
  /** The distance, in CSS pixels, between dots. */
  spacing?: number;
  /** The radius of an inactive dot. */
  baseRadius?: number;
  /** The radius of a dot at the center of the spotlight. */
  activeRadius?: number;
  /** The radius, in CSS pixels, of the spotlight. */
  interactionRadius?: number;
  /** The opacity at the exact center of the spotlight. */
  activeMaxAlpha?: number;
  /** The opacity at the outer edge of the spotlight. */
  activeMinAlpha?: number;
  /** How the spotlight position is controlled. */
  motion?: DotGridMotion;
  /** Additional classes applied to the canvas. */
  className?: string;
};

type Point = {
  x: number;
  y: number;
};

const AUTO_FRAME_INTERVAL = 1000 / 30;
const AUTO_CYCLE_DURATION = 9_000;

const DEFAULT_SPACING = 10;
const DEFAULT_BASE_RADIUS = 1;
const DEFAULT_ACTIVE_RADIUS = 2;
const DEFAULT_INTERACTION_RADIUS = 128;
const DEFAULT_ACTIVE_MAX_ALPHA = 1;
const DEFAULT_ACTIVE_MIN_ALPHA = 0.5;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function documentIsVisible() {
  return !document.hidden && document.visibilityState !== 'hidden';
}

export function DotGridSpotlight({
  dotColor = 'rgba(255, 255, 255, 0.05)',
  activeDotColor = 'rgba(255, 255, 255, 0.1)',
  spacing = DEFAULT_SPACING,
  baseRadius = DEFAULT_BASE_RADIUS,
  activeRadius = DEFAULT_ACTIVE_RADIUS,
  interactionRadius = DEFAULT_INTERACTION_RADIUS,
  activeMaxAlpha = DEFAULT_ACTIVE_MAX_ALPHA,
  activeMinAlpha = DEFAULT_ACTIVE_MIN_ALPHA,
  motion = 'pointer',
  className,
}: DotGridSpotlightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !parent || !context) return;

    // A tiny or non-finite spacing can turn one draw into millions of arcs.
    const safeSpacing = clamp(finiteOr(spacing, DEFAULT_SPACING), 2, 512);
    const safeBaseRadius = clamp(
      finiteOr(baseRadius, DEFAULT_BASE_RADIUS),
      0,
      1_024,
    );
    const safeActiveRadius = clamp(
      finiteOr(activeRadius, DEFAULT_ACTIVE_RADIUS),
      0,
      1_024,
    );
    const safeInteractionRadius = clamp(
      finiteOr(interactionRadius, DEFAULT_INTERACTION_RADIUS),
      1,
      10_000,
    );
    const safeMaxAlpha = clamp(
      finiteOr(activeMaxAlpha, DEFAULT_ACTIVE_MAX_ALPHA),
      0,
      1,
    );
    const safeMinAlpha = Math.min(
      clamp(finiteOr(activeMinAlpha, DEFAULT_ACTIVE_MIN_ALPHA), 0, 1),
      safeMaxAlpha,
    );

    const pointerEnabled = motion === 'pointer' || motion === 'auto-pointer';
    const autoEnabled = motion === 'auto' || motion === 'auto-pointer';
    const reducedMotionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    const pointer = { x: 0, y: 0, isActive: false };
    const autoStartedAt = performance.now();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let prefersReducedMotion = reducedMotionQuery?.matches ?? false;
    let pageIsVisible = documentIsVisible();
    let elementIsVisible = true;
    let autoFrameId: number | null = null;
    let pointerFrameId: number | null = null;
    let lastAutoDrawAt = Number.NEGATIVE_INFINITY;

    const canDraw = () => (
      pageIsVisible && elementIsVisible && width > 0 && height > 0
    );

    const getAutoPoint = (timestamp: number): Point => {
      const elapsed = Math.max(0, timestamp - autoStartedAt);
      const angle = (elapsed % AUTO_CYCLE_DURATION) / AUTO_CYCLE_DURATION
        * Math.PI
        * 2;

      return {
        x: width * (0.5 + Math.sin(angle) * 0.32),
        y: height * (0.5 + Math.sin(angle * 2) * 0.26),
      };
    };

    const draw = (spotlight: Point, spotlightIsActive: boolean) => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const offsetX = (width % safeSpacing) / 2;
      const offsetY = (height % safeSpacing) / 2;

      for (let x = offsetX; x <= width; x += safeSpacing) {
        for (let y = offsetY; y <= height; y += safeSpacing) {
          const distance = Math.hypot(x - spotlight.x, y - spotlight.y);
          let radius = safeBaseRadius;
          let color = dotColor;
          let alpha = 1;

          if (spotlightIsActive && distance < safeInteractionRadius) {
            const factor = 1 - distance / safeInteractionRadius;
            radius = safeBaseRadius
              + (safeActiveRadius - safeBaseRadius) * factor;
            color = activeDotColor;
            alpha = safeMinAlpha + (safeMaxAlpha - safeMinAlpha) * factor;
          }

          context.globalAlpha = alpha;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fillStyle = color;
          context.fill();
        }
      }

      context.globalAlpha = 1;
      canvas.dataset.ready = 'true';
    };

    const drawCurrentState = (timestamp = performance.now()) => {
      if (!canDraw()) return;

      if (prefersReducedMotion || motion === 'static') {
        draw({ x: width / 2, y: height / 2 }, true);
        return;
      }

      if (pointerEnabled && pointer.isActive) {
        draw(pointer, true);
        return;
      }

      if (autoEnabled) {
        draw(getAutoPoint(timestamp), true);
        return;
      }

      draw(pointer, false);
    };

    const cancelAutoFrame = () => {
      if (autoFrameId === null) return;
      window.cancelAnimationFrame(autoFrameId);
      autoFrameId = null;
    };

    const cancelPointerFrame = () => {
      if (pointerFrameId === null) return;
      window.cancelAnimationFrame(pointerFrameId);
      pointerFrameId = null;
    };

    const animateAuto = (timestamp: number) => {
      autoFrameId = null;
      if (!autoEnabled || prefersReducedMotion || !canDraw()) return;

      if (timestamp - lastAutoDrawAt >= AUTO_FRAME_INTERVAL) {
        drawCurrentState(timestamp);
        lastAutoDrawAt = timestamp;
      }

      autoFrameId = window.requestAnimationFrame(animateAuto);
    };

    const syncAutoAnimation = () => {
      const shouldAnimate = autoEnabled && !prefersReducedMotion && canDraw();
      if (!shouldAnimate) {
        cancelAutoFrame();
        return;
      }

      if (autoFrameId === null) {
        autoFrameId = window.requestAnimationFrame(animateAuto);
      }
    };

    const queuePointerDraw = () => {
      if (!canDraw() || prefersReducedMotion || pointerFrameId !== null) return;

      pointerFrameId = window.requestAnimationFrame((timestamp) => {
        pointerFrameId = null;
        drawCurrentState(timestamp);
      });
    };

    const resizeCanvas = () => {
      width = Math.max(0, parent.clientWidth);
      height = Math.max(0, parent.clientHeight);
      const rawDpr = finiteOr(window.devicePixelRatio, 1);
      dpr = clamp(rawDpr, 1, 2);

      if (width === 0 || height === 0) {
        canvas.dataset.ready = 'false';
        cancelAutoFrame();
        cancelPointerFrame();
        return;
      }

      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      drawCurrentState();
      lastAutoDrawAt = performance.now();
      syncAutoAnimation();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerEnabled || prefersReducedMotion) return;
      const rect = parent.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      pointer.x = x;
      pointer.y = y;
      pointer.isActive = x >= 0 && x <= width && y >= 0 && y <= height;
      queuePointerDraw();
    };

    const handlePointerLeave = () => {
      if (!pointerEnabled || prefersReducedMotion) return;
      pointer.isActive = false;
      queuePointerDraw();
    };

    const handleVisibilityChange = () => {
      pageIsVisible = documentIsVisible();
      if (!pageIsVisible) {
        cancelAutoFrame();
        cancelPointerFrame();
        return;
      }

      drawCurrentState();
      lastAutoDrawAt = performance.now();
      syncAutoAnimation();
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      cancelAutoFrame();
      cancelPointerFrame();
      drawCurrentState();
      lastAutoDrawAt = performance.now();
      syncAutoAnimation();
    };

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(resizeCanvas);
    resizeObserver?.observe(parent);

    const intersectionObserver = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
        const parentEntry = entries.find((entry) => entry.target === parent);
        if (!parentEntry) return;

        elementIsVisible = parentEntry.isIntersecting;
        if (!elementIsVisible) {
          cancelAutoFrame();
          cancelPointerFrame();
          return;
        }

        drawCurrentState();
        lastAutoDrawAt = performance.now();
        syncAutoAnimation();
      });
    intersectionObserver?.observe(parent);

    parent.addEventListener('pointermove', handlePointerMove);
    parent.addEventListener('pointerleave', handlePointerLeave);
    parent.addEventListener('pointercancel', handlePointerLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', resizeCanvas);

    if (reducedMotionQuery) {
      if (typeof reducedMotionQuery.addEventListener === 'function') {
        reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
      } else {
        reducedMotionQuery.addListener(handleReducedMotionChange);
      }
    }

    resizeCanvas();

    return () => {
      cancelAutoFrame();
      cancelPointerFrame();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      parent.removeEventListener('pointermove', handlePointerMove);
      parent.removeEventListener('pointerleave', handlePointerLeave);
      parent.removeEventListener('pointercancel', handlePointerLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', resizeCanvas);

      if (reducedMotionQuery) {
        if (typeof reducedMotionQuery.removeEventListener === 'function') {
          reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
        } else {
          reducedMotionQuery.removeListener(handleReducedMotionChange);
        }
      }
    };
  }, [
    activeDotColor,
    activeMaxAlpha,
    activeMinAlpha,
    activeRadius,
    baseRadius,
    dotColor,
    interactionRadius,
    motion,
    spacing,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-ready="false"
      className={cn(
        'absolute inset-0 block size-full opacity-0 transition-opacity duration-500 data-[ready=true]:opacity-100',
        className,
        'pointer-events-none',
      )}
    />
  );
}
