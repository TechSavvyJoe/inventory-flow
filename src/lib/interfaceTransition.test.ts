import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInterfaceTransition } from './interfaceTransition';

describe('runInterfaceTransition', () => {
  const originalStartViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

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
    const update = vi.fn();

    runInterfaceTransition(update, 'vehicle');
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.interfaceTransition).toBe('vehicle');

    rejectFinished?.(new DOMException('Transition was skipped', 'AbortError'));
    await finished.catch(() => undefined);
    await Promise.resolve();
    expect(document.documentElement.dataset.interfaceTransition).toBeUndefined();
  });

  it('absorbs native ready and update-callback rejections after applying the update', async () => {
    let rejectReady: ((reason?: unknown) => void) | undefined;
    let rejectUpdate: ((reason?: unknown) => void) | undefined;
    let resolveFinished: (() => void) | undefined;
    const ready = new Promise<void>((_resolve, reject) => { rejectReady = reject; });
    const updateCallbackDone = new Promise<void>((_resolve, reject) => { rejectUpdate = reject; });
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn((update: () => void) => {
        update();
        return { ready, updateCallbackDone, finished };
      }),
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false }) as MediaQueryList),
    });
    const update = vi.fn();

    runInterfaceTransition(update, 'scope');
    expect(update).toHaveBeenCalledOnce();

    rejectReady?.(new DOMException('Transition was skipped', 'AbortError'));
    rejectUpdate?.(new DOMException('DOM update timed out', 'TimeoutError'));
    resolveFinished?.();
    await Promise.allSettled([ready, updateCallbackDone, finished]);
    await Promise.resolve();
    expect(document.documentElement.dataset.interfaceTransition).toBeUndefined();
  });
});
