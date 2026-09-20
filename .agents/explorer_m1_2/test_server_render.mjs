import React from "react";
import { renderToString } from "react-dom/server";
import {
  motion,
  AnimatePresence,
  useAnimation,
  useMotionValue,
  useTransform,
} from "./test_framer_motion.mjs";

console.log("Testing server rendering of motion.div...");
const html = renderToString(
  React.createElement(
    motion.div,
    {
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0 },
      transition: { duration: 0.3, type: "spring" },
      whileHover: { scale: 1.05 },
      whileTap: { scale: 0.95 },
      className: "test-card",
      id: "card-1",
      style: { color: "red" },
    },
    React.createElement("span", null, "Hello Motion")
  )
);

console.log("Rendered HTML:", html);

if (!html.includes('class="test-card"')) {
  throw new Error("Missing class name");
}
if (!html.includes('id="card-1"')) {
  throw new Error("Missing id");
}
if (!html.includes("Hello Motion")) {
  throw new Error("Missing children text");
}
if (html.includes("whileHover") || html.includes("whileTap") || html.includes("initial=") || html.includes("animate=")) {
  throw new Error("Motion props leaked to HTML attributes!");
}
if (!html.includes("opacity:0") && !html.includes("opacity: 0")) {
  throw new Error("Initial styles not applied to style attribute!");
}

console.log("Server render check passed!");
