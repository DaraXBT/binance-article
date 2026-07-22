'use client';

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/utils';

interface ParticlesProps extends ComponentPropsWithoutRef<'div'> {
  quantity?: number;
  staticity?: number;
  ease?: number;
  size?: number;
  refresh?: boolean;
  color?: string;
  vx?: number;
  vy?: number;
}

interface Circle {
  x: number;
  y: number;
  translateX: number;
  translateY: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  dx: number;
  dy: number;
  magnetism: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((character) => character + character).join('')
    : normalized;
  const value = Number.parseInt(expanded, 16);

  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ];
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

export function Particles({
  className,
  quantity = 100,
  staticity = 50,
  ease = 50,
  size = 0.4,
  refresh = false,
  color = '#ffffff',
  vx = 0,
  vy = 0,
  ...props
}: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !container || !context) return;

    const dpr = window.devicePixelRatio || 1;
    const rgb = hexToRgb(color);
    const mouse = { x: 0, y: 0 };
    let circles: Circle[] = [];
    let frameId: number | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let canvasWidth = 0;
    let canvasHeight = 0;

    const createCircle = (): Circle => {
      const targetAlpha = Number.parseFloat((Math.random() * 0.6 + 0.1).toFixed(1));
      return {
        x: Math.floor(Math.random() * canvasWidth),
        y: Math.floor(Math.random() * canvasHeight),
        translateX: 0,
        translateY: 0,
        size: Math.floor(Math.random() * 2) + size,
        alpha: prefersReducedMotion ? targetAlpha : 0,
        targetAlpha,
        dx: (Math.random() - 0.5) * 0.1,
        dy: (Math.random() - 0.5) * 0.1,
        magnetism: 0.1 + Math.random() * 4,
      };
    };

    const resetParticles = () => {
      circles = Array.from({ length: quantity }, createCircle);
    };

    const drawCircle = (circle: Circle) => {
      context.setTransform(dpr, 0, 0, dpr, circle.translateX, circle.translateY);
      context.beginPath();
      context.arc(circle.x, circle.y, circle.size, 0, Math.PI * 2);
      context.fillStyle = `rgba(${rgb.join(', ')}, ${circle.alpha})`;
      context.fill();
    };

    const remapEdgeAlpha = (circle: Circle) => {
      const closestEdge = Math.min(
        circle.x + circle.translateX - circle.size,
        canvasWidth - circle.x - circle.translateX - circle.size,
        circle.y + circle.translateY - circle.size,
        canvasHeight - circle.y - circle.translateY - circle.size,
      );
      return Math.max(0, Math.min(1, closestEdge / 20));
    };

    const drawFrame = (update: boolean) => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);

      circles.forEach((circle, index) => {
        if (update) {
          const edgeAlpha = remapEdgeAlpha(circle);
          circle.alpha = Math.min(circle.targetAlpha, circle.alpha + 0.02) * edgeAlpha;
          circle.x += circle.dx + vx;
          circle.y += circle.dy + vy;
          circle.translateX += (
            mouse.x / (staticity / circle.magnetism) - circle.translateX
          ) / ease;
          circle.translateY += (
            mouse.y / (staticity / circle.magnetism) - circle.translateY
          ) / ease;

          if (
            circle.x < -circle.size
            || circle.x > canvasWidth + circle.size
            || circle.y < -circle.size
            || circle.y > canvasHeight + circle.size
          ) {
            circles[index] = createCircle();
          }
        }

        drawCircle(circles[index]);
      });
    };

    const resizeCanvas = () => {
      canvasWidth = container.offsetWidth;
      canvasHeight = container.offsetHeight;
      canvas.width = Math.max(1, Math.round(canvasWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvasHeight * dpr));
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      resetParticles();
      drawFrame(false);
    };

    const animate = () => {
      drawFrame(true);
      frameId = window.requestAnimationFrame(animate);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left - canvasWidth / 2;
      const y = event.clientY - rect.top - canvasHeight / 2;
      if (
        x < canvasWidth / 2
        && x > -canvasWidth / 2
        && y < canvasHeight / 2
        && y > -canvasHeight / 2
      ) {
        mouse.x = x;
        mouse.y = y;
      }
    };

    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeCanvas, 200);
    };

    resizeCanvas();
    window.addEventListener('resize', handleResize);
    if (!prefersReducedMotion) {
      window.addEventListener('mousemove', handleMouseMove);
      frameId = window.requestAnimationFrame(animate);
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [color, ease, prefersReducedMotion, quantity, refresh, size, staticity, vx, vy]);

  return (
    <div
      ref={containerRef}
      className={cn('pointer-events-none', className)}
      aria-hidden="true"
      {...props}
    >
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
}
