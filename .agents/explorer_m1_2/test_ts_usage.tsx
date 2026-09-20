import React, { useState } from "react";
import {
  motion,
  AnimatePresence,
  useAnimation,
  type MotionProps,
  type Transition,
  type Variants,
  type AnimationControls,
} from "./test_framer_motion";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

const customTransition: Transition = {
  type: "spring",
  stiffness: 350,
  damping: 25,
  duration: 0.25,
};

export function MotionTestComponent() {
  const [open, setOpen] = useState(true);
  const controls: AnimationControls = useAnimation();

  return (
    <div className="test-wrapper">
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="cockpit-header"
      >
        <h1>Inventory Cockpit</h1>
      </motion.header>

      <motion.button
        whileHover={{ scale: 1.04, y: -1 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen(!open)}
        className="quick-action-btn"
      >
        Toggle VDP
      </motion.button>

      <AnimatePresence mode="wait">
        {open && (
          <motion.div
            key="vdp-modal"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={customTransition}
            className="vdp-modal-card"
          >
            <motion.span
              animate={{ color: "#10b981" }}
              transition={{ duration: 0.15 }}
            >
              Ready
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
