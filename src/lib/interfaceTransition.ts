type InterfaceTransitionName = "vehicle" | "oem" | "scope";

interface ViewTransitionHandle {
  finished: Promise<void>;
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
  const transition = transitionDocument.startViewTransition(async () => {
    update();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
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
