import { useLayoutEffect, type RefObject } from "react";

interface ModalBackgroundIsolationOptions {
  active: boolean;
  backgroundRef: RefObject<HTMLElement | null>;
}

interface AttributeSnapshot {
  present: boolean;
  value: string | null;
}

function attributeSnapshot(element: HTMLElement, name: string): AttributeSnapshot {
  return {
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  };
}

function restoreAttribute(element: HTMLElement, name: string, snapshot: AttributeSnapshot) {
  if (!snapshot.present) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, snapshot.value ?? "");
}

interface BackgroundIsolation {
  owners: number;
  inert: AttributeSnapshot;
  ariaHidden: AttributeSnapshot;
  hideFrame: number | null;
}

interface ScrollIsolation {
  owners: number;
  overflow: string;
  overflowPriority: string;
  overscroll: string;
  overscrollPriority: string;
}

// Nested portals can disappear in either order on route navigation. Preserve
// the first owner's original state until the last owner releases the element.
const backgrounds = new WeakMap<HTMLElement, BackgroundIsolation>();
const scrollLocks = new WeakMap<HTMLElement, ScrollIsolation>();

function acquireBackground(background: HTMLElement) {
  const existing = backgrounds.get(background);
  if (existing) {
    existing.owners += 1;
    return;
  }
  const state: BackgroundIsolation = {
    owners: 1,
    inert: attributeSnapshot(background, "inert"),
    ariaHidden: attributeSnapshot(background, "aria-hidden"),
    hideFrame: null,
  };
  backgrounds.set(background, state);
  background.setAttribute("inert", "");
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && background.contains(focused)) {
    state.hideFrame = window.requestAnimationFrame(() => {
      state.hideFrame = null;
      const currentFocus = document.activeElement;
      if (currentFocus instanceof HTMLElement && background.contains(currentFocus)) currentFocus.blur();
      background.setAttribute("aria-hidden", "true");
    });
  } else {
    background.setAttribute("aria-hidden", "true");
  }
}

function releaseBackground(background: HTMLElement) {
  const state = backgrounds.get(background);
  if (!state || --state.owners > 0) return;
  if (state.hideFrame !== null) window.cancelAnimationFrame(state.hideFrame);
  restoreAttribute(background, "inert", state.inert);
  restoreAttribute(background, "aria-hidden", state.ariaHidden);
  backgrounds.delete(background);
}

function acquireScrollLock(body: HTMLElement) {
  const existing = scrollLocks.get(body);
  if (existing) {
    existing.owners += 1;
    return;
  }
  scrollLocks.set(body, {
    owners: 1,
    overflow: body.style.getPropertyValue("overflow"),
    overflowPriority: body.style.getPropertyPriority("overflow"),
    overscroll: body.style.getPropertyValue("overscroll-behavior"),
    overscrollPriority: body.style.getPropertyPriority("overscroll-behavior"),
  });
  body.style.setProperty("overflow", "hidden");
  body.style.setProperty("overscroll-behavior", "none");
}

function releaseScrollLock(body: HTMLElement) {
  const state = scrollLocks.get(body);
  if (!state || --state.owners > 0) return;
  for (const [name, value, priority] of [
    ["overflow", state.overflow, state.overflowPriority],
    ["overscroll-behavior", state.overscroll, state.overscrollPriority],
  ]) {
    if (value) body.style.setProperty(name, value, priority);
    else body.style.removeProperty(name);
  }
  scrollLocks.delete(body);
}

/**
 * Isolates the document content behind an open modal while leaving the modal
 * itself interactive. Only the explicitly supplied app background is hidden
 * from assistive technology; browser or host-app chrome is never queried.
 */
export function useModalBackgroundIsolation({
  active,
  backgroundRef,
}: ModalBackgroundIsolationOptions) {
  useLayoutEffect(() => {
    if (!active) return;

    const background = backgroundRef.current;
    if (!background) return;

    const body = document.body;
    acquireBackground(background);
    acquireScrollLock(body);

    return () => {
      releaseBackground(background);
      releaseScrollLock(body);
    };
  }, [active, backgroundRef]);
}
