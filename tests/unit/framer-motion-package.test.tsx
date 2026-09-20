import { describe, it, expect } from "vitest";
import React, { useState } from "react";
import { renderToString } from "react-dom/server";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  motion,
  AnimatePresence,
  useAnimation,
  useReducedMotion,
  type MotionProps,
  type Transition,
  type Variants,
} from "framer-motion";

describe("framer-motion local package verification", () => {
  it("exports motion, AnimatePresence, and key hooks", () => {
    expect(motion).toBeDefined();
    expect(typeof motion.div).toBe("object"); // React.forwardRef exotic component
    expect(typeof motion.button).toBe("object");
    expect(typeof motion.header).toBe("object");
    expect(AnimatePresence).toBeDefined();
    expect(typeof useAnimation).toBe("function");
    expect(typeof useReducedMotion).toBe("function");
  });

  it("renders motion.div with computed initial styles in SSR and strips motion props", () => {
    const html = renderToString(
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="test-cockpit-card"
        data-testid="motion-box"
      >
        <span>Content</span>
      </motion.div>
    );

    // Initial styles applied on initial render
    expect(html).toContain("opacity:0");
    expect(html).toContain("translate3d(0px, 15px, 0px)");
    expect(html).toContain('class="test-cockpit-card"');

    // Motion props must NOT be leaked to DOM element attributes
    expect(html).not.toContain("whileHover");
    expect(html).not.toContain("whileTap");
    expect(html).not.toContain("initial=");
    expect(html).not.toContain("animate=");
    expect(html).not.toContain("transition=");
  });

  it("transitions to animate target upon mount in DOM", () => {
    render(
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mounted-box"
        data-testid="mounted-box"
      >
        <span>Mounted</span>
      </motion.div>
    );

    const el = screen.getByTestId("mounted-box");
    expect(el).toBeInTheDocument();
    // Mounted state transitions to animate target
    expect(el.style.opacity).toBe("1");
    expect(el.style.transform).toContain("translate3d(0px, 0px, 0px)");
    expect(el.style.transition).toContain("opacity");
    expect(el.style.transition).toContain("transform");
  });

  it("handles whileHover and whileTap micro-interactions", () => {
    render(
      <motion.button
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        data-testid="quick-btn"
      >
        Action
      </motion.button>
    );

    const btn = screen.getByTestId("quick-btn");

    // Simulate mouse hover
    fireEvent.mouseEnter(btn);
    expect(btn.style.transform).toContain("scale(1.05)");

    // Simulate mouse tap/down
    fireEvent.mouseDown(btn);
    expect(btn.style.transform).toContain("scale(0.95)");

    // Release mouse
    fireEvent.mouseUp(btn);
    expect(btn.style.transform).toContain("scale(1.05)");

    // Mouse leave
    fireEvent.mouseLeave(btn);
    expect(btn.style.transform).toContain("scale(1)");
  });

  it("coordinates exit animations within AnimatePresence", async () => {
    function ToggleWrapper() {
      const [show, setShow] = useState(true);
      return (
        <div>
          <button onClick={() => setShow(false)}>Dismiss</button>
          <AnimatePresence>
            {show && (
              <motion.div
                key="alert"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.05 }}
                data-testid="alert-box"
              >
                Hold Active
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }

    render(<ToggleWrapper />);
    expect(screen.getByTestId("alert-box")).toBeInTheDocument();

    // Trigger exit
    fireEvent.click(screen.getByText("Dismiss"));

    // Immediately after click, the element is still in DOM in exit phase
    expect(screen.getByTestId("alert-box")).toBeInTheDocument();

    // Wait for exit duration + margin to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    // Element unmounted cleanly
    expect(screen.queryByTestId("alert-box")).toBeNull();
  });
});
