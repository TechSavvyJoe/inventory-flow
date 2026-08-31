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

    const inert = attributeSnapshot(background, "inert");
    const ariaHidden = attributeSnapshot(background, "aria-hidden");
    const bodyOverflow = document.body.style.getPropertyValue("overflow");
    const bodyOverflowPriority = document.body.style.getPropertyPriority("overflow");
    const bodyOverscroll = document.body.style.getPropertyValue("overscroll-behavior");
    const bodyOverscrollPriority = document.body.style.getPropertyPriority("overscroll-behavior");

    background.setAttribute("inert", "");
    background.setAttribute("aria-hidden", "true");
    document.body.style.setProperty("overflow", "hidden");
    document.body.style.setProperty("overscroll-behavior", "none");

    return () => {
      restoreAttribute(background, "inert", inert);
      restoreAttribute(background, "aria-hidden", ariaHidden);

      if (bodyOverflow) {
        document.body.style.setProperty("overflow", bodyOverflow, bodyOverflowPriority);
      } else {
        document.body.style.removeProperty("overflow");
      }
      if (bodyOverscroll) {
        document.body.style.setProperty("overscroll-behavior", bodyOverscroll, bodyOverscrollPriority);
      } else {
        document.body.style.removeProperty("overscroll-behavior");
      }
    };
  }, [active, backgroundRef]);
}
