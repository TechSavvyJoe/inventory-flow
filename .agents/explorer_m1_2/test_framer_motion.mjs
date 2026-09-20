import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  Children,
  isValidElement,
  cloneElement,
} from "react";

// Presence Context
export const PresenceContext = createContext({
  isPresent: true,
  registerExit: () => () => {},
  onExitComplete: undefined,
  custom: undefined,
});

export function usePresence() {
  const context = useContext(PresenceContext);
  return [context.isPresent, context.onExitComplete || (() => {})];
}

export function useIsPresent() {
  return useContext(PresenceContext).isPresent;
}

const TRANSFORM_KEYS = new Set([
  "x",
  "y",
  "z",
  "scale",
  "scaleX",
  "scaleY",
  "scaleZ",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "skew",
  "skewX",
  "skewY",
]);

function formatTransformValue(key, value) {
  if (typeof value === "number") {
    if (key === "x" || key === "y" || key === "z") return `${value}px`;
    if (key.startsWith("rotate") || key.startsWith("skew")) return `${value}deg`;
    return `${value}`;
  }
  return value;
}

function resolveTarget(target, variants) {
  if (!target) return {};
  if (typeof target === "string" && variants && variants[target]) {
    return variants[target];
  }
  if (typeof target === "object") {
    return target;
  }
  return {};
}

function splitTarget(target) {
  const transforms = {};
  const styles = {};
  for (const [key, value] of Object.entries(target)) {
    if (TRANSFORM_KEYS.has(key)) {
      transforms[key] = value;
    } else if (key !== "transition") {
      styles[key] = value;
    }
  }
  return { transforms, styles };
}

function buildTransform(transforms, existingTransform = "") {
  const parts = [];
  if (existingTransform && existingTransform !== "none") {
    parts.push(existingTransform);
  }
  if (
    transforms.x !== undefined ||
    transforms.y !== undefined ||
    transforms.z !== undefined
  ) {
    const x = formatTransformValue("x", transforms.x ?? 0);
    const y = formatTransformValue("y", transforms.y ?? 0);
    const z = formatTransformValue("z", transforms.z ?? 0);
    parts.push(`translate3d(${x}, ${y}, ${z})`);
  }
  if (transforms.scale !== undefined) {
    parts.push(`scale(${transforms.scale})`);
  } else {
    if (transforms.scaleX !== undefined) parts.push(`scaleX(${transforms.scaleX})`);
    if (transforms.scaleY !== undefined) parts.push(`scaleY(${transforms.scaleY})`);
    if (transforms.scaleZ !== undefined) parts.push(`scaleZ(${transforms.scaleZ})`);
  }
  if (transforms.rotate !== undefined) {
    parts.push(`rotate(${formatTransformValue("rotate", transforms.rotate)})`);
  }
  if (transforms.rotateX !== undefined) {
    parts.push(`rotateX(${formatTransformValue("rotateX", transforms.rotateX)})`);
  }
  if (transforms.rotateY !== undefined) {
    parts.push(`rotateY(${formatTransformValue("rotateY", transforms.rotateY)})`);
  }
  if (transforms.rotateZ !== undefined) {
    parts.push(`rotateZ(${formatTransformValue("rotateZ", transforms.rotateZ)})`);
  }
  if (transforms.skewX !== undefined) {
    parts.push(`skewX(${formatTransformValue("skewX", transforms.skewX)})`);
  }
  if (transforms.skewY !== undefined) {
    parts.push(`skewY(${formatTransformValue("skewY", transforms.skewY)})`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

const EASE_MAP = {
  linear: "linear",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  circIn: "cubic-bezier(0.55, 0, 1, 0.45)",
  circOut: "cubic-bezier(0, 0.55, 0.45, 1)",
  backIn: "cubic-bezier(0.36, 0, 0.66, -0.56)",
  backOut: "cubic-bezier(0.34, 1.56, 0.64, 1)",
};

function buildTransition(transition = {}, animatedKeys = []) {
  if (transition.duration === 0) return "none";
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return "none";
  }

  const duration =
    typeof transition.duration === "number"
      ? `${transition.duration}s`
      : transition.duration || "0.25s";
  const delay =
    typeof transition.delay === "number"
      ? `${transition.delay}s`
      : transition.delay || "0s";

  let timing = "cubic-bezier(0.2, 0.8, 0.2, 1)"; // default spring-like curve
  if (transition.type === "spring") {
    const damping = transition.damping ?? 10;
    if (damping < 15) {
      timing = "cubic-bezier(0.34, 1.3, 0.64, 1)";
    } else {
      timing = "cubic-bezier(0.16, 1, 0.3, 1)";
    }
  } else if (transition.ease) {
    if (typeof transition.ease === "string" && EASE_MAP[transition.ease]) {
      timing = EASE_MAP[transition.ease];
    } else if (Array.isArray(transition.ease)) {
      timing = `cubic-bezier(${transition.ease.join(", ")})`;
    } else if (typeof transition.ease === "string") {
      timing = transition.ease;
    }
  }

  const cssProperties = new Set();
  for (const k of animatedKeys) {
    if (TRANSFORM_KEYS.has(k)) {
      cssProperties.add("transform");
    } else {
      cssProperties.add(k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
    }
  }

  if (cssProperties.size === 0) return undefined;
  return Array.from(cssProperties)
    .map((prop) => `${prop} ${duration} ${timing} ${delay}`)
    .join(", ");
}

const MOTION_PROP_NAMES = new Set([
  "initial",
  "animate",
  "exit",
  "transition",
  "variants",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileInView",
  "whileDrag",
  "layout",
  "layoutId",
  "layoutDependency",
  "onAnimationStart",
  "onAnimationComplete",
  "onUpdate",
  "drag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "onDrag",
  "onDragStart",
  "onDragEnd",
  "inherit",
  "custom",
  "transformTemplate",
]);

function createMotionComponent(Component) {
  return forwardRef(function MotionComponent(allProps, ref) {
    const {
      initial,
      animate,
      exit,
      transition = {},
      variants,
      whileHover,
      whileTap,
      whileFocus,
      onAnimationComplete,
      onAnimationStart,
      style: rawStyle = {},
      className,
      children,
      ...domProps
    } = allProps;

    const presence = useContext(PresenceContext);
    const isPresent = presence.isPresent;

    const [isMounted, setIsMounted] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isTapped, setIsTapped] = useState(false);

    useEffect(() => {
      setIsMounted(true);
      if (onAnimationStart) onAnimationStart();
      if (onAnimationComplete) {
        const dur = (transition.duration ?? 0.25) * 1000;
        const timer = setTimeout(() => {
          onAnimationComplete();
        }, dur);
        return () => clearTimeout(timer);
      }
    }, []);

    // If exiting inside AnimatePresence
    useEffect(() => {
      if (!isPresent && exit) {
        const dur = (transition.duration ?? 0.25) * 1000;
        const timer = setTimeout(() => {
          if (presence.onExitComplete) presence.onExitComplete();
        }, dur);
        return () => clearTimeout(timer);
      }
    }, [isPresent]);

    // Compute active target state
    let targetState = {};

    if (!isPresent && exit) {
      targetState = resolveTarget(exit, variants);
    } else if (!isMounted && initial !== false) {
      targetState = resolveTarget(initial, variants);
    } else {
      targetState = { ...resolveTarget(animate, variants) };
      if (isHovered && whileHover) {
        Object.assign(targetState, resolveTarget(whileHover, variants));
      }
      if (isTapped && whileTap) {
        Object.assign(targetState, resolveTarget(whileTap, variants));
      }
    }

    const { transforms, styles } = splitTarget(targetState);
    const activeTransform = buildTransform(transforms, rawStyle.transform);
    const transitionStr = isMounted
      ? buildTransition(transition, Object.keys(targetState))
      : undefined;

    const computedStyle = {
      ...rawStyle,
      ...styles,
    };
    if (activeTransform) computedStyle.transform = activeTransform;
    if (transitionStr) {
      computedStyle.transition = rawStyle.transition
        ? `${rawStyle.transition}, ${transitionStr}`
        : transitionStr;
    }

    // Filter DOM props to remove motion-specific attributes
    const cleanedProps = {};
    for (const [key, value] of Object.entries(domProps)) {
      if (!MOTION_PROP_NAMES.has(key)) {
        cleanedProps[key] = value;
      }
    }

    // Attach event listeners for micro-interactions
    const handleMouseEnter = (e) => {
      if (whileHover) setIsHovered(true);
      allProps.onMouseEnter?.(e);
    };
    const handleMouseLeave = (e) => {
      if (whileHover) {
        setIsHovered(false);
        setIsTapped(false);
      }
      allProps.onMouseLeave?.(e);
    };
    const handleMouseDown = (e) => {
      if (whileTap) setIsTapped(true);
      allProps.onMouseDown?.(e);
    };
    const handleMouseUp = (e) => {
      if (whileTap) setIsTapped(false);
      allProps.onMouseUp?.(e);
    };

    return React.createElement(
      Component,
      {
        ...cleanedProps,
        ref,
        className,
        style: computedStyle,
        onMouseEnter: whileHover ? handleMouseEnter : allProps.onMouseEnter,
        onMouseLeave: whileHover ? handleMouseLeave : allProps.onMouseLeave,
        onMouseDown: whileTap ? handleMouseDown : allProps.onMouseDown,
        onMouseUp: whileTap ? handleMouseUp : allProps.onMouseUp,
      },
      children
    );
  });
}

const componentCache = new Map();

export const motion = new Proxy(createMotionComponent, {
  get(target, prop) {
    if (typeof prop === "string") {
      if (!componentCache.has(prop)) {
        componentCache.set(prop, createMotionComponent(prop));
      }
      return componentCache.get(prop);
    }
    return Reflect.get(target, prop);
  },
});

export function AnimatePresence({
  children,
  mode = "sync",
  initial = true,
  onExitComplete,
}) {
  const [currentChildren, setCurrentChildren] = useState(children);
  const [exitingKeys, setExitingKeys] = useState(new Set());

  // Track children changes
  useEffect(() => {
    setCurrentChildren(children);
  }, [children]);

  return React.createElement(
    PresenceContext.Provider,
    {
      value: {
        isPresent: true,
        onExitComplete,
      },
    },
    currentChildren
  );
}

export function useAnimation() {
  return useMemo(
    () => ({
      start: () => Promise.resolve(),
      stop: () => {},
      set: () => {},
    }),
    []
  );
}

export const useAnimationControls = useAnimation;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduced(media.matches);
      const listener = (e) => setReduced(e.matches);
      media.addEventListener?.("change", listener);
      return () => media.removeEventListener?.("change", listener);
    }
  }, []);
  return reduced;
}

export function useMotionValue(init) {
  const valueRef = useRef(init);
  const listeners = useRef(new Set());
  return useMemo(
    () => ({
      get: () => valueRef.current,
      set: (v) => {
        valueRef.current = v;
        listeners.current.forEach((fn) => fn(v));
      },
      onChange: (fn) => {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
      getVelocity: () => 0,
    }),
    []
  );
}

export function useTransform(value, input, output) {
  return useMemo(() => {
    if (output && output.length > 0) return output[0];
    return 0;
  }, [value, input, output]);
}

export function useSpring(source) {
  return source;
}

export const LazyMotion = ({ children }) => children;
export const domAnimation = {};
export const domMax = {};
export const m = motion;

export default {
  motion,
  AnimatePresence,
  useAnimation,
  useAnimationControls,
  usePresence,
  useIsPresent,
  useReducedMotion,
  useMotionValue,
  useTransform,
  useSpring,
  LazyMotion,
  domAnimation,
  domMax,
  m,
};
