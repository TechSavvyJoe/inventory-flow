import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInterfaceTransition } from './interfaceTransition';

describe('runInterfaceTransition', () => {
  const originalStartViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame');

  afterEach(() => {
    if (originalStartViewTransition) {
      Object.defineProperty(document, 'startViewTransition', originalStartViewTransition);
    } else {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, 'matchMedia');
    }
    if (originalRequestAnimationFrame) {
      Object.defineProperty(window, 'requestAnimationFrame', originalRequestAnimationFrame);
    } else {
      Reflect.deleteProperty(window, 'requestAnimationFrame');
    }
    delete document.documentElement.dataset.interfaceTransition;
    vi.restoreAllMocks();
  });

  it('treats a browser-skipped visual transition as a harmless completed update', async () => {
    let rejectFinished: ((reason?: unknown) => void) | undefined;
    const finished = new Promise<void>((_resolve, reject) => {
      rejectFinished = reject;
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn((update: () => void) => {
        update();
        return { finished };
      }),
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false }) as MediaQueryList),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }),
    });
    const update = vi.fn();

    runInterfaceTransition(update, 'vehicle');
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.interfaceTransition).toBe('vehicle');

    rejectFinished?.(new DOMException('Transition was skipped', 'AbortError'));
    await finished.catch(() => undefined);
    await Promise.resolve();
    expect(document.documentElement.dataset.interfaceTransition).toBeUndefined();
  });
});
