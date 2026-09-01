import { flushSync } from "react-dom";

type InterfaceTransitionName = "vehicle" | "oem" | "scope";

interface ViewTransitionHandle {
  finished: Promise<void>;
  ready?: Promise<void>;
  updateCallbackDone?: Promise<void>;
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => ViewTransitionHandle;
};

/**
 * Lets a state change read as one coherent interface transition in browsers that
 * support the View Transition API. The update remains immediate everywhere else.
 */
export function runInterfaceTransition(
  update: () => void,
  name: InterfaceTransitionName,
): void {
  if (typeof document === "undefined") {
    update();
    return;
  }

  const transitionDocument = document as TransitionDocument;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!transitionDocument.startViewTransition || reduceMotion) {
    update();
    return;
  }

  document.documentElement.dataset.interfaceTransition = name;
  let updateCompleted = false;
  let transition: ViewTransitionHandle;
  try {
    transition = transitionDocument.startViewTransition(() => {
      flushSync(() => {
        update();
        updateCompleted = true;
      });
    });
  } catch {
    if (!updateCompleted) {
      update();
    }
    delete document.documentElement.dataset.interfaceTransition;
    return;
  }

  // Native implementations expose three promises. Any of them may reject
  // when the browser skips or supersedes a transition; none should surface as
  // an application error because the synchronous state update already landed.
  void transition.ready?.catch(() => undefined);
  void transition.updateCallbackDone?.catch(() => undefined);
  void transition.finished
    .catch(() => {
      // Browsers may reject a transition when a dialog closes before the
      // captured frame is painted. The state update already completed, so a
      // skipped visual transition is a harmless progressive-enhancement case.
    })
    .finally(() => {
      delete document.documentElement.dataset.interfaceTransition;
    });
}
