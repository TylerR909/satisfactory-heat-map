import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TIP_W = 288;
const TIP_PAD = 8;
/** Grace period so the pointer can leave the button and enter the portal tip. */
const HIDE_MS = 160;

type TipPos = { left: number; top: number };

function clampTipBox(anchor: DOMRect, boxW: number, boxH: number, vw: number, vh: number): TipPos {
  const width = Math.min(boxW, vw - TIP_PAD * 2);
  let left = anchor.left + anchor.width / 2 - width / 2;
  left = Math.min(vw - TIP_PAD - width, Math.max(TIP_PAD, left));

  const spaceAbove = anchor.top - TIP_PAD;
  const spaceBelow = vh - anchor.bottom - TIP_PAD;
  const placeAbove = spaceAbove >= boxH || spaceAbove >= spaceBelow;
  let top = placeAbove ? anchor.top - 6 - boxH : anchor.bottom + 6;
  top = Math.min(vh - TIP_PAD - boxH, Math.max(TIP_PAD, top));
  return { left, top };
}

const ATTRIBUTION_BODY = (
  <div className="space-y-2 text-[11px] leading-snug text-slate-300">
    <p>
      <span className="font-medium text-slate-100">Not affiliated</span> with Coffee Stain Studios
      or satisfactory-calculator.com.
    </p>
    <ul className="list-disc space-y-1.5 pl-4">
      <li>
        <span className="text-slate-100">Resource nodes (slots)</span> — positions and vanilla
        types/purities bootstrapped from{" "}
        <a
          className="text-sky-400 underline decoration-slate-600 underline-offset-2 hover:text-sky-300"
          href="https://github.com/rockfactory/satisfactory-logistics"
          target="_blank"
          rel="noopener noreferrer"
        >
          rockfactory/satisfactory-logistics
        </a>{" "}
        (<span className="font-mono text-slate-400">WorldResourceNodes.json</span>, MIT). See{" "}
        <span className="font-mono text-slate-400">
          third_party/rockfactory-satisfactory-logistics.md
        </span>
        .
      </li>
      <li>
        <span className="text-slate-100">Node randomization (1.2+ seeds)</span> — Konsl{" "}
        <a
          className="text-sky-400 underline decoration-slate-600 underline-offset-2 hover:text-sky-300"
          href="https://github.com/Konsl/satisfactory-world-generator"
          target="_blank"
          rel="noopener noreferrer"
        >
          satisfactory-world-generator
        </a>{" "}
        MIT algorithm (Rust/WASM; GPL viewer not used). See{" "}
        <span className="font-mono text-slate-400">
          third_party/konsl-satisfactory-world-generator.md
        </span>{" "}
        and <span className="font-mono text-slate-400">crates/vendored/konsl_randomization</span>.
      </li>
      <li>
        <span className="text-slate-100">Recipes &amp; items</span> — compact extract derived from
        Coffee Stain{" "}
        <span className="font-mono text-slate-400">CommunityResources/Docs/en-US.json</span>{" "}
        (shipped derived tables only; full Docs not redistributed).
      </li>
      <li>
        <span className="text-slate-100">Basemap tiles</span> — self-hosted WebP pyramid derived
        from the public wiki map image (map art © Coffee Stain Studios). See{" "}
        <span className="font-mono text-slate-400">public/map/v1/README.md</span>.
      </li>
      <li>
        <span className="text-slate-100">Open water</span> — capacity pockets derived from the same
        basemap (blue-pixel extract at{" "}
        <span className="font-mono text-slate-400">map:generate</span>; not discrete game nodes).
        See <span className="font-mono text-slate-400">public/data/water/</span>.
      </li>
      <li>
        <span className="text-slate-100">Extractor rates</span> — project-maintained tables (not
        Docs).
      </li>
    </ul>
    <p className="text-slate-500">
      Satisfactory is a trademark of Coffee Stain. This tool is fan-made and open source (MIT).
    </p>
  </div>
);

/**
 * Compact “Attributions” control for the planner footer.
 * Detail lives in a viewport-clamped portal tooltip (same idea as map ©).
 */
export function Attributions() {
  const tipId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<TipPos | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  function show() {
    clearHideTimer();
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos(clampTipBox(r, TIP_W, 220, vw, vh));
    requestAnimationFrame(() => {
      const tip = tipRef.current;
      if (!tip) return;
      const tr = tip.getBoundingClientRect();
      setPos(clampTipBox(r, tr.width || TIP_W, tr.height || 220, vw, vh));
    });
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      setPos(null);
      hideTimer.current = null;
    }, HIDE_MS);
  }

  function hideNow() {
    clearHideTimer();
    setPos(null);
  }

  useEffect(
    () => () => {
      clearHideTimer();
    },
    [clearHideTimer],
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
        aria-describedby={pos ? tipId : undefined}
        aria-expanded={Boolean(pos)}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onClick={(e) => {
          e.preventDefault();
          if (pos) hideNow();
          else show();
        }}
      >
        Attributions
      </button>
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="fixed z-[10000] rounded-md border border-slate-600 bg-slate-900 px-3 py-2.5 text-left shadow-xl"
            style={{
              left: pos.left,
              top: pos.top,
              width: TIP_W,
              maxWidth: `calc(100vw - ${TIP_PAD * 2}px)`,
            }}
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
          >
            <div className="mb-1.5 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
              Data &amp; map credits
            </div>
            {ATTRIBUTION_BODY}
          </div>,
          document.body,
        )}
    </>
  );
}
