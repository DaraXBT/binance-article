// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DotGridSpotlight } from './dot-grid-spotlight';

type ResizeCallback = ResizeObserverCallback;
type IntersectionCallback = IntersectionObserverCallback;

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  readonly callback: ResizeCallback;
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }
}

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];

  readonly callback: IntersectionCallback;
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);

  constructor(callback: IntersectionCallback) {
    this.callback = callback;
    IntersectionObserverMock.instances.push(this);
  }
}

function intersectionEntry(target: Element, isIntersecting: boolean) {
  return {
    boundingClientRect: target.getBoundingClientRect(),
    intersectionRatio: isIntersecting ? 1 : 0,
    intersectionRect: target.getBoundingClientRect(),
    isIntersecting,
    rootBounds: null,
    target,
    time: performance.now(),
  } satisfies IntersectionObserverEntry;
}

describe('DotGridSpotlight', () => {
  let context: CanvasRenderingContext2D;
  let arc: ReturnType<typeof vi.fn>;
  let setTransform: ReturnType<typeof vi.fn>;
  let alphaValues: number[];
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;
  let layoutWidth: number;
  let layoutHeight: number;
  let documentHidden: boolean;
  let visibilityState: DocumentVisibilityState;
  let reducedMotion: boolean;
  let reducedMotionListener: ((event: MediaQueryListEvent) => void) | null;
  let removeReducedMotionListener: ReturnType<typeof vi.fn>;

  const runNextAnimationFrame = (timestamp: number) => {
    const next = animationFrames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!next) throw new Error('Expected a queued animation frame');
    animationFrames.delete(next[0]);
    next[1](timestamp);
  };

  beforeEach(() => {
    ResizeObserverMock.instances = [];
    IntersectionObserverMock.instances = [];
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    layoutWidth = 120;
    layoutHeight = 80;
    documentHidden = false;
    visibilityState = 'visible';
    reducedMotion = false;
    reducedMotionListener = null;
    removeReducedMotionListener = vi.fn();
    alphaValues = [];
    arc = vi.fn();
    setTransform = vi.fn();

    const contextMock = {
      arc,
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      setTransform,
    } as unknown as CanvasRenderingContext2D;
    let currentAlpha = 1;
    let currentFillStyle: string | CanvasGradient | CanvasPattern = '#000000';
    Object.defineProperties(contextMock, {
      globalAlpha: {
        configurable: true,
        get: () => currentAlpha,
        set: (value: number) => {
          currentAlpha = value;
          alphaValues.push(value);
        },
      },
      fillStyle: {
        configurable: true,
        get: () => currentFillStyle,
        set: (value: string | CanvasGradient | CanvasPattern) => {
          currentFillStyle = value;
        },
      },
    });
    context = contextMock;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(() => layoutWidth);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(() => layoutHeight);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 100,
      height: layoutHeight,
      left: 10,
      right: 130,
      top: 20,
      width: layoutWidth,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }));
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => documentHidden);
    vi.spyOn(document, 'visibilityState', 'get')
      .mockImplementation(() => visibilityState);

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      animationFrames.delete(id);
    }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: reducedMotion,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn((eventName: string, listener: EventListener) => {
        if (eventName === 'change') {
          reducedMotionListener = listener as (event: MediaQueryListEvent) => void;
        }
      }),
      removeEventListener: removeReducedMotionListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })));

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 3,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws at the parent size, caps DPR, and remains decorative', () => {
    const { container } = render(
      <div data-testid="frame">
        <DotGridSpotlight className="custom-grid pointer-events-auto" />
      </div>,
    );

    const parent = container.firstElementChild as HTMLDivElement;
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(160);
    expect(canvas.style.width).toBe('120px');
    expect(canvas.style.height).toBe('80px');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.classList.contains('custom-grid')).toBe(true);
    expect(canvas.classList.contains('pointer-events-none')).toBe(true);
    expect(canvas.classList.contains('pointer-events-auto')).toBe(false);
    expect(canvas.dataset.ready).toBe('true');
    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ResizeObserverMock.instances[0]?.observe).toHaveBeenCalledWith(parent);
    expect(IntersectionObserverMock.instances[0]?.observe).toHaveBeenCalledWith(parent);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('tracks the pointer on its parent and removes the spotlight on leave', () => {
    const { container } = render(
      <div>
        <DotGridSpotlight activeRadius={5} interactionRadius={24} />
      </div>,
    );
    const parent = container.firstElementChild as HTMLDivElement;

    arc.mockClear();
    fireEvent.pointerMove(parent, { clientX: 70, clientY: 60 });
    expect(animationFrames.size).toBe(1);
    runNextAnimationFrame(performance.now() + 16);

    expect(arc.mock.calls.some((call) => call[0] === 60 && call[1] === 40 && call[2] === 5))
      .toBe(true);

    arc.mockClear();
    fireEvent.pointerLeave(parent);
    runNextAnimationFrame(performance.now() + 32);

    expect(arc.mock.calls.length).toBeGreaterThan(0);
    expect(arc.mock.calls.every((call) => call[2] === 1)).toBe(true);
  });

  it('animates autonomous motion at roughly 30 drawing frames per second', () => {
    render(
      <div>
        <DotGridSpotlight motion="auto" />
      </div>,
    );
    const start = performance.now();

    arc.mockClear();
    runNextAnimationFrame(start + 34);
    expect(arc).toHaveBeenCalled();
    expect(animationFrames.size).toBe(1);

    arc.mockClear();
    runNextAnimationFrame(start + 40);
    expect(arc).not.toHaveBeenCalled();

    runNextAnimationFrame(start + 69);
    expect(arc).toHaveBeenCalled();
  });

  it('lets a parent pointer take over autonomous motion', () => {
    const { container } = render(
      <div>
        <DotGridSpotlight
          motion="auto-pointer"
          activeRadius={5}
          interactionRadius={20}
        />
      </div>,
    );
    const parent = container.firstElementChild as HTMLDivElement;

    arc.mockClear();
    fireEvent.pointerMove(parent, { clientX: 10, clientY: 20 });
    // The autonomous frame and the input frame can coexist; execute the input
    // frame by draining the callbacks queued at the time of the event.
    const queuedFrames = [...animationFrames.entries()];
    queuedFrames.forEach(([id, callback]) => {
      animationFrames.delete(id);
      callback(performance.now() + 16);
    });

    expect(arc.mock.calls.some((call) => call[0] === 0 && call[1] === 0 && call[2] === 5))
      .toBe(true);
  });

  it('uses a centered static spotlight for reduced motion and normalizes unsafe inputs', () => {
    reducedMotion = true;

    render(
      <div>
        <DotGridSpotlight
          motion="auto-pointer"
          spacing={Number.NaN}
          baseRadius={Number.POSITIVE_INFINITY}
          activeRadius={Number.NaN}
          interactionRadius={Number.NEGATIVE_INFINITY}
          activeMaxAlpha={Number.POSITIVE_INFINITY}
          activeMinAlpha={Number.NaN}
        />
      </div>,
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(arc.mock.calls.some((call) => call[0] === 60 && call[1] === 40 && call[2] === 2))
      .toBe(true);
    expect(arc.mock.calls.length).toBeLessThan(1_000);
    expect(arc.mock.calls.every((call) => Number.isFinite(call[2]))).toBe(true);
    expect(alphaValues.every((alpha) => Number.isFinite(alpha) && alpha >= 0 && alpha <= 1))
      .toBe(true);
  });

  it('pauses while hidden or offscreen, resumes, and cleans up observers and frames', () => {
    const { container, unmount } = render(
      <div>
        <DotGridSpotlight motion="auto" />
      </div>,
    );
    const parent = container.firstElementChild as HTMLDivElement;
    const intersectionObserver = IntersectionObserverMock.instances[0];
    const resizeObserver = ResizeObserverMock.instances[0];

    expect(animationFrames.size).toBe(1);
    intersectionObserver.callback(
      [intersectionEntry(parent, false)],
      intersectionObserver as unknown as IntersectionObserver,
    );
    expect(animationFrames.size).toBe(0);
    expect(cancelAnimationFrame).toHaveBeenCalled();

    intersectionObserver.callback(
      [intersectionEntry(parent, true)],
      intersectionObserver as unknown as IntersectionObserver,
    );
    expect(animationFrames.size).toBe(1);

    documentHidden = true;
    visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(animationFrames.size).toBe(0);

    documentHidden = false;
    visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(animationFrames.size).toBe(1);

    reducedMotionListener?.({ matches: true } as MediaQueryListEvent);
    expect(animationFrames.size).toBe(0);

    unmount();
    expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
    expect(intersectionObserver.disconnect).toHaveBeenCalledOnce();
    expect(removeReducedMotionListener).toHaveBeenCalledOnce();
  });

  it('redraws when ResizeObserver reports a parent size change', () => {
    const { container } = render(
      <div>
        <DotGridSpotlight motion="static" />
      </div>,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    layoutWidth = 90;
    layoutHeight = 50;
    ResizeObserverMock.instances[0].callback([], ResizeObserverMock.instances[0] as unknown as ResizeObserver);

    expect(canvas.width).toBe(180);
    expect(canvas.height).toBe(100);
  });
});
