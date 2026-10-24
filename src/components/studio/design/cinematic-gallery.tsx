import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { GALLERY, GALLERY_INTERVAL, galleryIndex, galleryPosition } from "@/lib/studio/ui/gallery";

/** Nine persistent cards: CSS interpolates their geometry; no frame-by-frame React updates. */
export function CinematicGallery() {
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [ready, setReady] = useState<Set<string>>(() => new Set());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const move = (delta: number) => {
    const next = galleryIndex(active + delta);
    setActive(next);
    setAnnouncement(
      `${GALLERY[next].title}. ${GALLERY[next].genre}. ${next + 1} of ${GALLERY.length}.`,
    );
  };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    const update = () =>
      setAllowed(
        visible &&
          !document.hidden &&
          !media.matches &&
          document.documentElement.dataset.studioMotion !== "quiet" &&
          !document.querySelector('[role="dialog"]'),
      );
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-studio-motion"],
    });
    // Opening a dialog must not leave the gallery rotating behind its overlay.
    const dialogs = new MutationObserver(update);
    dialogs.observe(document.body, { childList: true, subtree: true });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      update();
    });
    intersection.observe(element);
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      dialogs.disconnect();
      intersection.disconnect();
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const rotating = allowed && !paused && !hovered && !focused && !dragging;
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => {
      setActive((value) => {
        const next = galleryIndex(value + 1);
        // Never rotate an undecoded artwork into view on a slow connection.
        return readyRef.current.has(GALLERY[next].id) &&
          readyRef.current.has(GALLERY[galleryIndex(next + 1)].id)
          ? next
          : value;
      });
    }, GALLERY_INTERVAL);
    return () => window.clearInterval(timer);
  }, [rotating]);
  const cancel = () => {
    gesture.current = null;
    setDragging(false);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    cancel();
    if (start?.id !== event.pointerId) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1);
  };
  return (
    <section
      ref={root}
      className="cinematic-gallery"
      aria-label="Original Inkstrip artwork gallery"
      aria-roledescription="carousel"
      data-rotating={rotating}
      data-active={active}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          move(event.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      <p className="gallery-kicker">
        <span /> NINE STORIES. INFINITE POSSIBILITY.
      </p>
      <div
        className="gallery-stage"
        aria-label="Swipe left or right to browse artwork"
        onPointerDown={(event) => {
          if (!event.isPrimary) {
            cancel();
            return;
          }
          if (event.pointerType === "mouse") return;
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (
            start?.id === event.pointerId &&
            Math.abs(event.clientX - start.x) > 12 &&
            Math.abs(event.clientX - start.x) > Math.abs(event.clientY - start.y) * 1.4
          )
            event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        {GALLERY.map((art, index) => {
          const position = galleryPosition(index, active);
          return (
            <figure
              key={art.id}
              className="gallery-card"
              data-position={position}
              data-artwork={art.id}
              aria-hidden={position !== "front"}
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${GALLERY.length}: ${art.title}`}
            >
              <img
                src={`/gallery/${art.id}-720.webp`}
                srcSet={`/gallery/${art.id}-360.webp 360w, /gallery/${art.id}-720.webp 720w`}
                sizes="(max-width: 639px) 60vw, (max-width: 1023px) 42vw, 320px"
                width={720}
                height={960}
                alt={art.alt}
                draggable={false}
                decoding="async"
                fetchPriority={index === 0 ? "high" : "auto"}
                onLoad={async (event) => {
                  const image = event.currentTarget;
                  try {
                    await image.decode();
                  } catch {
                    return;
                  }
                  setReady((value) => new Set(value).add(art.id));
                }}
              />
              {"dialogue" in art ? (
                <span className="gallery-dialogue" lang={art.language}>
                  {art.dialogue}
                </span>
              ) : null}
              {"effect" in art ? <span className="gallery-sfx">{art.effect}</span> : null}
              <figcaption>
                <span>{art.genre}</span>
                <strong>{art.title}</strong>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="gallery-controls">
        <button
          type="button"
          className="focus-ring"
          aria-label="Previous artwork"
          onClick={() => move(-1)}
        >
          <ArrowLeft className="size-4" />
        </button>
        <span className="gallery-counter" aria-hidden="true">
          {String(active + 1).padStart(2, "0")} <span>/ 09</span>
        </span>
        <button
          type="button"
          className="focus-ring"
          aria-label="Next artwork"
          onClick={() => move(1)}
        >
          <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          className="focus-ring gallery-pause"
          aria-label={
            paused ? "Resume automatic gallery rotation" : "Pause automatic gallery rotation"
          }
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
        </button>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}
