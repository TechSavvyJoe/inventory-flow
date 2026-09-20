import type * as React from "react";

export type Target = Record<string, string | number | undefined>;

export interface Transition {
  duration?: number;
  delay?: number;
  ease?: string | number[] | ((t: number) => number);
  type?: "spring" | "tween" | "inertia" | "keyframes";
  stiffness?: number;
  damping?: number;
  mass?: number;
  repeat?: number;
  repeatType?: "loop" | "reverse" | "mirror";
  repeatDelay?: number;
  staggerChildren?: number;
  delayChildren?: number;
  when?: "beforeChildren" | "afterChildren" | false | string;
  [key: string]: any;
}

export type TargetAndTransition = Target & {
  transition?: Transition;
  [key: string]: any;
};

export type Variant = TargetAndTransition | Record<string, any>;

export type Variants = {
  [key: string]: Variant;
};

export interface AnimationControls {
  start(definition: any, transitionOverride?: Transition): Promise<any>;
  stop(): void;
  set(definition: any): void;
}

export type AnimationDefinition =
  | TargetAndTransition
  | string
  | string[]
  | AnimationControls
  | boolean;

export interface MotionProps {
  initial?: AnimationDefinition | false;
  animate?: AnimationDefinition;
  exit?: AnimationDefinition;
  transition?: Transition;
  variants?: Variants;
  whileHover?: TargetAndTransition | string;
  whileTap?: TargetAndTransition | string;
  whileFocus?: TargetAndTransition | string;
  whileInView?: TargetAndTransition | string;
  layout?: boolean | "position" | "size";
  layoutId?: string;
  onAnimationComplete?: (definition?: any) => void;
  onAnimationStart?: () => void;
  style?: React.CSSProperties & Record<string, any>;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

export type HTMLMotionProps<Tag extends keyof React.JSX.IntrinsicElements> =
  Omit<React.JSX.IntrinsicElements[Tag], keyof MotionProps> & MotionProps;

export type MotionElements = {
  [Tag in keyof React.JSX.IntrinsicElements]: React.ForwardRefExoticComponent<
    HTMLMotionProps<Tag> & React.RefAttributes<any>
  >;
};

export type CustomMotionComponent<P extends object = {}> =
  React.ForwardRefExoticComponent<
    Omit<P, keyof MotionProps> & MotionProps & React.RefAttributes<any>
  >;

export interface MotionFactory extends MotionElements {
  <P extends object>(Component: React.ComponentType<P>): CustomMotionComponent<P>;
  (tag: string): CustomMotionComponent<React.HTMLAttributes<HTMLElement>>;
  [key: string]: any;
}

export const motion: MotionFactory;

export interface AnimatePresenceProps {
  children?: React.ReactNode;
  mode?: "sync" | "wait" | "popLayout";
  initial?: boolean;
  onExitComplete?: () => void;
  custom?: any;
}

export const AnimatePresence: React.FC<AnimatePresenceProps>;

export function useAnimation(): AnimationControls;
export function useAnimationControls(): AnimationControls;

export function usePresence(): [boolean, () => void];
export function useIsPresent(): boolean;
export function useReducedMotion(): boolean;

export interface MotionValue<T = any> {
  get(): T;
  set(value: T): void;
  onChange(subscription: (v: T) => void): () => void;
  getVelocity(): number;
}

export function useMotionValue<T>(initial: T): MotionValue<T>;
export function useTransform<I, O>(
  value: MotionValue<I> | any,
  inputRange: I[],
  outputRange: O[]
): MotionValue<O> | any;
export function useSpring(source: any, config?: any): any;

export const LazyMotion: React.FC<{
  children?: React.ReactNode;
  features?: any;
  strict?: boolean;
}>;

export const domAnimation: any;
export const domMax: any;
export const m: MotionFactory;

declare const defaultExport: {
  motion: MotionFactory;
  AnimatePresence: React.FC<AnimatePresenceProps>;
  useAnimation: () => AnimationControls;
  useAnimationControls: () => AnimationControls;
  usePresence: () => [boolean, () => void];
  useIsPresent: () => boolean;
  useReducedMotion: () => boolean;
  useMotionValue: <T>(initial: T) => MotionValue<T>;
  useTransform: <I, O>(value: any, input: I[], output: O[]) => any;
  useSpring: (source: any, config?: any) => any;
  LazyMotion: React.FC<any>;
  domAnimation: any;
  domMax: any;
  m: MotionFactory;
};

export default defaultExport;
