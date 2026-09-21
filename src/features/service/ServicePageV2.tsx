import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { confirmUnsavedWork } from "../../lib/useUnsavedChanges";
import { ServicePage } from "./ServicePage";

const ServiceBoard = lazy(() => import("./ServiceBoard").then(module => ({ default: module.ServiceBoard })));

export function ServicePageV2() {
  const [params, setParams] = useSearchParams();
  const board = params.get("view") === "board";
  const switchView = (next: boolean) => {
    if (!confirmUnsavedWork()) return;
    setParams(current => {
      const updated = new URLSearchParams(current);
      if (next) updated.set("view", "board"); else updated.delete("view");
      return updated;
    });
  };
  const toolbar = <div className="service-scope" role="group" aria-label="Service view">
    <button type="button" aria-pressed={!board} onClick={() => switchView(false)}>List</button>
    <button type="button" aria-pressed={board} onClick={() => switchView(true)}>Board</button>
  </div>;
  return board ? <Suspense fallback={<div role="status">Loading service board…</div>}><ServiceBoard toolbarAccessory={toolbar} /></Suspense> : <ServicePage toolbarAccessory={toolbar} />;
}
