import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Expand, ImageOff, Minus, Plus, X } from "lucide-react";
import { vehiclePhotoFullSources } from "../../lib/vehicle-photos";
import { useContainedFocus } from "../../lib/useContainedFocus";
import { vehicleDisplayName } from "./inventory-utils";
import type { InventoryVehicle } from "./types";
import "./VehicleGallery.css";

type GalleryVehicle = Pick<InventoryVehicle, "id" | "imageUrl" | "imageUrls" | "photoCount">
  & Partial<Pick<InventoryVehicle, "vehicleName" | "year" | "make" | "model" | "trim">>;

export function VehicleGallery({ vehicle }: { vehicle: GalleryVehicle }) {
  const suppliedImages = useMemo(() => {
    return vehiclePhotoFullSources(vehicle);
  }, [vehicle.imageUrl, vehicle.imageUrls]);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const gesture = useRef<{ distance?: number; x: number; y: number } | null>(null);
  const mouseOrigin = useRef<{ x: number; y: number } | null>(null);
  const usableImages = suppliedImages.filter((url) => !failedImages.has(url));
  const activeImage = usableImages[activeIndex] ?? null;
  const displayName = vehicleDisplayName(vehicle);
  const setGalleryRef = useCallback((node: HTMLElement | null) => {
    galleryRef.current = node;
    if (!returnFocusRef.current?.isConnected) returnFocusRef.current = node;
  }, []);
  const setOpenRef = useCallback((node: HTMLButtonElement | null) => {
    returnFocusRef.current = node ?? galleryRef.current;
  }, []);
  useContainedFocus({ active: expanded, contain: true, containerRef: viewerRef,
    initialFocusRef: closeRef, returnFocusRef, onEscape: () => setExpanded(false) });

  useEffect(() => {
    setFailedImages(new Set());
    setActiveIndex(0);
    setExpanded(false);
  }, [vehicle.id]);

  useEffect(() => {
    if (activeIndex >= usableImages.length) {
      setActiveIndex(Math.max(0, usableImages.length - 1));
    }
  }, [activeIndex, usableImages.length]);

  useEffect(() => {
    if (!usableImages.length) setExpanded(false);
  }, [usableImages.length]);

  useEffect(() => {
    viewRef.current = { scale: 1, x: 0, y: 0 };
    setView(viewRef.current);
    gesture.current = null;
    touchOrigin.current = null;
  }, [activeImage, expanded]);

  const updateView = (scale: number, x = viewRef.current.x, y = viewRef.current.y) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    scale = Math.max(1, Math.min(5, scale));
    const img = imageRef.current;
    const ratio = bounds && img?.naturalWidth && img.naturalHeight ? Math.min(bounds.width / img.naturalWidth, bounds.height / img.naturalHeight) : 1;
    const width = img?.naturalWidth ? img.naturalWidth * ratio : bounds?.width ?? 0;
    const height = img?.naturalHeight ? img.naturalHeight * ratio : bounds?.height ?? 0;
    const limitX = Math.max(0, (width * scale - (bounds?.width ?? 0)) / 2);
    const limitY = Math.max(0, (height * scale - (bounds?.height ?? 0)) / 2);
    viewRef.current = { scale, x: Math.max(-limitX, Math.min(limitX, x)), y: Math.max(-limitY, Math.min(limitY, y)) };
    setView(viewRef.current);
  };

  const moveGallery = (direction: -1 | 1) => {
    if (usableImages.length < 2) return;
    setActiveIndex(
      (current) =>
        (current + direction + usableImages.length) % usableImages.length,
    );
  };

  const handleGalleryKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    moveGallery(event.key === "ArrowLeft" ? -1 : 1);
  };

  const markImageFailed = (url: string) => {
    const failedIndex = usableImages.indexOf(url);
    if (failedIndex >= 0) {
      setActiveIndex((current) => failedIndex < current ? current - 1 : current);
    }
    setFailedImages((current) => new Set(current).add(url));
  };

  const startSwipe = (event: TouchEvent) => {
    if (event.touches.length >= 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      gesture.current = { distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      touchOrigin.current = null;
      return;
    }
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    gesture.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    touchOrigin.current = touch && viewRef.current.scale === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const moveTouch = (event: TouchEvent) => {
    const previous = gesture.current;
    if (!previous) return;
    const current = viewRef.current;
    if (event.touches.length >= 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const x = (a.clientX + b.clientX) / 2, y = (a.clientY + b.clientY) / 2;
      const bounds = stageRef.current!.getBoundingClientRect();
      const scale = Math.max(1, Math.min(5, current.scale * distance / (previous.distance || distance || 1)));
      const ratio = scale / current.scale;
      const focalX = previous.x - bounds.left - bounds.width / 2;
      const focalY = previous.y - bounds.top - bounds.height / 2;
      updateView(scale, focalX - (focalX - current.x) * ratio + x - previous.x, focalY - (focalY - current.y) * ratio + y - previous.y);
      gesture.current = { distance, x, y };
      touchOrigin.current = null;
    } else if (event.touches.length === 1 && current.scale > 1) {
      const touch = event.touches[0];
      updateView(current.scale, current.x + touch.clientX - previous.x, current.y + touch.clientY - previous.y);
      gesture.current = { x: touch.clientX, y: touch.clientY };
    }
  };
  const finishSwipe = (event: TouchEvent) => {
    const origin = touchOrigin.current;
    touchOrigin.current = null;
    const touch = event.changedTouches[0];
    const remaining = event.touches[0];
    gesture.current = remaining ? { x: remaining.clientX, y: remaining.clientY } : null;
    if (!origin || !touch || event.touches.length || viewRef.current.scale > 1) return;
    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) moveGallery(dx < 0 ? 1 : -1);
  };

  if (!activeImage) {
    return (
      <section
        ref={setGalleryRef}
        className="inventory-workspace-gallery inventory-workspace-gallery--empty"
        aria-label={`Vehicle photos for ${displayName}: unavailable`}
        tabIndex={-1}
        data-photo-state="empty"
      >
        <div className="inventory-workspace-gallery__placeholder">
          <ImageOff size={24} strokeWidth={1.6} aria-hidden="true" />
          <strong>Photos are not available</strong>
          <span>
            {vehicle.photoCount
              ? `${vehicle.photoCount} photos reported by the inventory source`
              : "No photo URLs were supplied"}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={setGalleryRef}
      className="inventory-workspace-gallery"
      aria-label={`Photos of ${displayName}`}
      tabIndex={0}
      onKeyDown={handleGalleryKeyDown}
      data-photo-state="available"
      data-photo-count={usableImages.length}
    >
      <div className="inventory-workspace-gallery__stage">
        <button type="button" className="inventory-workspace-gallery__open" ref={setOpenRef}
          aria-label={`Open photo gallery for ${displayName}`} onClick={() => setExpanded(true)}>
        <img
          key={activeImage}
          src={activeImage}
          alt={activeImage.startsWith('/demo-vehicles/') ? `${displayName}, AI-generated demo illustration` : `${displayName}, photo ${activeIndex + 1}`}
          referrerPolicy="no-referrer"
          onError={() => markImageFailed(activeImage)}
        />
        <span className="inventory-workspace-gallery__expand" aria-hidden="true"><Expand size={15} /></span>
        </button>
        {activeImage.startsWith('/demo-vehicles/') && <span className="vdp-demo-photo"><span className="vdp-demo-photo-full">Demo illustration</span><span className="vdp-demo-photo-short">Demo</span></span>}
        <span className="inventory-workspace-gallery__count" aria-live="polite">
          {activeIndex + 1} / {usableImages.length}
        </span>
        {usableImages.length > 1 ? (
          <>
            <button
              type="button"
              className="inventory-workspace-gallery__previous"
              onClick={() => moveGallery(-1)}
              aria-label="Show previous vehicle photo"
            >
              <ChevronLeft
                size={22}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className="inventory-workspace-gallery__next"
              onClick={() => moveGallery(1)}
              aria-label="Show next vehicle photo"
            >
              <ChevronRight
                size={22}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>
          </>
        ) : null}
      </div>
      {usableImages.length > 1 ? (
        <div
          className="inventory-workspace-gallery__thumbnails"
          aria-label="Choose a vehicle photo"
        >
          {usableImages.map((url, index) => (
            <button
              type="button"
              className={index === activeIndex ? "is-active" : undefined}
              aria-label={`Show vehicle photo ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => setActiveIndex(index)}
              key={url}
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => markImageFailed(url)}
              />
            </button>
          ))}
        </div>
      ) : null}
      <span className="inventory-workspace-gallery__keyboard-hint">
        Use left and right arrow keys to browse photos
      </span>
      {expanded ? createPortal(
        <div className="vehicle-photo-viewer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
          <div ref={viewerRef} className="vehicle-photo-viewer" role="dialog" aria-modal="true"
            aria-label={`${displayName} photo gallery`} tabIndex={-1} onKeyDown={handleGalleryKeyDown}>
            <header><div><strong>{displayName}</strong><span aria-live="polite">Photo {activeIndex + 1} of {usableImages.length}{activeImage.startsWith('/demo-vehicles/') ? ' · Demo illustration' : ''}</span></div>
              <button type="button" ref={closeRef} onClick={() => setExpanded(false)} aria-label="Close photo gallery"><X size={22} /></button></header>
            <div ref={stageRef} className="vehicle-photo-viewer__stage" data-zoomed={view.scale > 1} onTouchStart={startSwipe} onTouchMove={moveTouch} onTouchEnd={finishSwipe} onTouchCancel={() => { touchOrigin.current = null; gesture.current = null; }}
              onPointerDown={(event) => { if (event.pointerType === 'mouse' && event.target === imageRef.current && viewRef.current.scale > 1) { mouseOrigin.current = { x:event.clientX, y:event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); } }}
              onPointerMove={(event) => { if (event.pointerType === 'mouse' && mouseOrigin.current) { const current=viewRef.current; updateView(current.scale,current.x+event.clientX-mouseOrigin.current.x,current.y+event.clientY-mouseOrigin.current.y); mouseOrigin.current={x:event.clientX,y:event.clientY}; } }}
              onPointerUp={() => { mouseOrigin.current=null; }} onPointerCancel={() => { mouseOrigin.current=null; }}>
              <img ref={imageRef} style={{transform:`translate(${view.x}px, ${view.y}px) scale(${view.scale})`}} onDoubleClick={() => updateView(viewRef.current.scale > 1 ? 1 : 2,0,0)} src={activeImage} alt={activeImage.startsWith('/demo-vehicles/') ? `${displayName}, AI-generated demo illustration` : `${displayName}, photo ${activeIndex + 1}`} referrerPolicy="no-referrer" draggable={false} onError={() => markImageFailed(activeImage)} />
              {usableImages.length > 1 ? <><button type="button" className="vehicle-photo-viewer__previous" aria-label="Previous photo" onClick={() => moveGallery(-1)}><ChevronLeft size={25} /></button><button type="button" className="vehicle-photo-viewer__next" aria-label="Next photo" onClick={() => moveGallery(1)}><ChevronRight size={25} /></button></> : null}
            </div>
            <div className="vehicle-photo-viewer__zoom" role="group" aria-label="Photo zoom"><button type="button" aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => updateView(viewRef.current.scale - .5)}><Minus size={18}/></button><button type="button" className="vehicle-photo-viewer__reset" aria-label="Reset photo zoom" onClick={() => updateView(1,0,0)}>{Math.round(view.scale * 100)}%</button><button type="button" aria-label="Zoom in" disabled={view.scale >= 5} onClick={() => updateView(viewRef.current.scale + .5)}><Plus size={18}/></button></div>
            {usableImages.length > 1 ? <div className="vehicle-photo-viewer__filmstrip" aria-label="All vehicle photos">{usableImages.map((url, index) => <button type="button" key={url} aria-label={`View photo ${index + 1}`} aria-current={index === activeIndex ? 'true' : undefined} onClick={() => setActiveIndex(index)}><img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => markImageFailed(url)} /></button>)}</div> : null}
          </div>
        </div>, document.body) : null}
    </section>
  );
}
