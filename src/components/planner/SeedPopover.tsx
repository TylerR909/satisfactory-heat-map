import { type FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createSavedSeed,
  defaultNameForSeed,
  ensureDefaultSavedSeed,
  formatSeedLabel,
  gcEmptyAutoNamed,
  getActiveSavedSeed,
  persistSeedLibrary,
  removeSavedSeed,
  type SavedSeed,
  type SeedLibrary,
  uniqueSeedName,
  upsertSavedSeed,
} from "@/lib/savedSeeds";
import { isDefaultSeed, type MapSeed, parseSeedInput } from "@/lib/seed";
import { useAppStore } from "@/store/useAppStore";

const PAD = 8;
const PANEL_W = 300;

type Pos = { left: number; top: number };

function clampPanel(anchor: DOMRect, w: number, h: number, vw: number, vh: number): Pos {
  const width = Math.min(w, vw - PAD * 2);
  let left = anchor.right - width;
  left = Math.min(vw - PAD - width, Math.max(PAD, left));
  const spaceBelow = vh - anchor.bottom - PAD;
  const spaceAbove = anchor.top - PAD;
  const placeBelow = spaceBelow >= h || spaceBelow >= spaceAbove;
  let top = placeBelow ? anchor.bottom + 6 : anchor.top - 6 - h;
  top = Math.min(vh - PAD - h, Math.max(PAD, top));
  return { left, top };
}

type Props = {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  library: SeedLibrary;
  onLibraryChange: (lib: SeedLibrary) => void;
  /** Snapshot current saved-seed plan shelf before seed mutations. */
  snapshotActiveShelf: () => SeedLibrary;
  /** Current map seed is not owned by any library entry (derived; amber Save CTA). */
  ephemeral: boolean;
  /** Save current seed under the given name (inline form, no browser prompt). */
  onSaveSeed: (name: string) => void;
  /** Apply seed + optional auto-save; parent handles plan shelf. */
  onPasteSeed: (seed: number) => void;
  onRandomSeed: () => void;
  /** Switch to vanilla Default map (seed null) and re-attach the Default shelf. */
  onDefaultMap: () => void;
  onSelectSavedSeed: (pt: SavedSeed, opts?: { keepOpen?: boolean }) => void;
};

export function SeedPopover({
  open,
  onClose,
  anchorRef,
  library,
  onLibraryChange,
  snapshotActiveShelf,
  ephemeral,
  onSaveSeed,
  onPasteSeed,
  onRandomSeed,
  onDefaultMap,
  onSelectSavedSeed,
}: Props) {
  const seed = useAppStore((s) => s.seed);
  const panelRef = useRef<HTMLDivElement>(null);
  const seedInputRef = useRef<HTMLInputElement>(null);
  const saveNameRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [seedInput, setSeedInput] = useState("");
  const [seedError, setSeedError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** Seed id waiting for inline delete confirmation. */
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const titleId = useId();

  // Always Seed {n} / Default — never the existing shelf name (so Save always works as a default).
  const suggestedSaveName = defaultNameForSeed(seed);

  useEffect(() => {
    if (!open) {
      setRenameId(null);
      setDeleteConfirmId(null);
      return;
    }
    setSeedInput(seed === null ? "" : String(seed));
    setSeedError(null);
    setSaveName(""); // empty → shows placeholder; save uses placeholder text
    const t = window.setTimeout(() => seedInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, seed]);

  useEffect(() => {
    if (!renameId) return;
    const t = window.setTimeout(() => renameInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [renameId]);

  // Reposition when open or list size / ephemeral banner changes (panel height).
  const panelLayoutKey = `${library.seeds.length}:${ephemeral ? 1 : 0}:${renameId ?? ""}:${deleteConfirmId ?? ""}`;
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    void panelLayoutKey;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = panel?.offsetHeight ?? 320;
      const w = panel?.offsetWidth ?? PANEL_W;
      setPos(clampPanel(r, w, h, vw, vh));
    };
    place();
    requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, panelLayoutKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape cancels in-row ops first (rename → delete confirm → close)
      if (renameId) {
        e.preventDefault();
        e.stopPropagation();
        setRenameId(null);
        setRenameValue("");
        return;
      }
      if (deleteConfirmId) {
        e.preventDefault();
        e.stopPropagation();
        setDeleteConfirmId(null);
        return;
      }
      onClose();
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) {
        // Click inside panel but outside the confirm row cancels pending delete
        if (deleteConfirmId) {
          const row = panelRef.current.querySelector(`[data-seed-row="${deleteConfirmId}"]`);
          if (row && !row.contains(t)) {
            setDeleteConfirmId(null);
          }
        }
        return;
      }
      if (anchorRef.current?.contains(t)) return;
      // Outside: cancel pending ops, then close
      setDeleteConfirmId(null);
      setRenameId(null);
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose, anchorRef, renameId, deleteConfirmId]);

  if (!open || !pos) return null;

  const active = getActiveSavedSeed(library);

  const onSubmitSeed = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseSeedInput(seedInput);
    if (!parsed.ok) {
      setSeedError(parsed.error);
      return;
    }
    setSeedError(null);
    onPasteSeed(parsed.seed);
  };

  const onSubmitSave = (e: FormEvent) => {
    e.preventDefault();
    // Empty field → use placeholder (Seed 1234 / Default); parent makes it unique if needed
    const name = (saveName.trim() || suggestedSaveName).trim() || "Seed";
    onSaveSeed(name);
    setSaveName("");
  };

  const cancelRename = () => {
    setRenameId(null);
    setRenameValue("");
  };

  const cancelDeleteConfirm = () => {
    setDeleteConfirmId(null);
  };

  const beginDeleteConfirm = (pt: SavedSeed) => {
    setRenameId(null);
    setDeleteConfirmId(pt.id);
  };

  const confirmDelete = (pt: SavedSeed) => {
    let lib = snapshotActiveShelf();
    const { library: next, next: activate } = removeSavedSeed(lib, pt.id);
    lib = gcEmptyAutoNamed(next, activate?.id);
    setDeleteConfirmId(null);
    // Keep popover open after delete
    if (activate) {
      onLibraryChange(lib);
      onSelectSavedSeed(activate, { keepOpen: true });
    } else {
      // No shelves left → re-home on Default
      lib = ensureDefaultSavedSeed(lib);
      onLibraryChange(lib);
      useAppStore.getState().setSeed(null);
    }
  };

  const commitRename = (pt: SavedSeed) => {
    const name = uniqueSeedName(library, renameValue.trim() || pt.name, pt.id);
    const updated: SavedSeed = {
      ...pt,
      name,
      autoNamed: false,
      updatedAt: Date.now(),
    };
    const next = upsertSavedSeed(library, updated);
    onLibraryChange(next);
    cancelRename();
  };

  const iconBtn =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200";
  // Shared width so Apply / Save line up
  const primaryActionBtn =
    "inline-flex w-[4.25rem] shrink-0 items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium";
  const secondaryChipBtn =
    "rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-white";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      className="fixed z-[10000] rounded-lg border border-slate-600 bg-slate-900 p-3 text-left shadow-2xl"
      style={{
        left: pos.left,
        top: pos.top,
        width: PANEL_W,
        maxWidth: `calc(100vw - ${PAD * 2}px)`,
        maxHeight: `calc(100vh - ${PAD * 2}px)`,
        overflowY: "auto",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="text-xs font-semibold tracking-wide text-slate-200 uppercase">
          Map seed
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-sm leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <p className="mt-1 text-[11px] text-slate-400">
        Current:{" "}
        <span className="font-mono text-slate-200">
          {isDefaultSeed(seed) ? "Default" : formatSeedLabel(seed)}
        </span>
        {active ? (
          <span className="text-slate-500"> · {active.name}</span>
        ) : ephemeral ? (
          <span className="text-amber-400/90"> · unsaved</span>
        ) : null}
      </p>

      <form onSubmit={onSubmitSeed} className="mt-2.5 space-y-1.5">
        <label className="block space-y-1">
          <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            Paste seed
          </span>
          <div className="flex gap-1.5">
            <input
              ref={seedInputRef}
              type="text"
              inputMode="numeric"
              value={seedInput}
              onChange={(ev) => {
                setSeedInput(ev.target.value);
                if (seedError) setSeedError(null);
              }}
              placeholder="e.g. 12345"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              className={`${primaryActionBtn} bg-slate-100 text-slate-900 hover:bg-white`}
            >
              Apply
            </button>
          </div>
        </label>
        {seedError && <p className="text-[11px] text-red-400">{seedError}</p>}
      </form>

      <form onSubmit={onSubmitSave} className="mt-2 space-y-1">
        <span className="block text-[10px] font-medium tracking-wide text-slate-500 uppercase">
          Name &amp; save
        </span>
        <div className="flex gap-1.5">
          <input
            ref={saveNameRef}
            type="text"
            value={saveName}
            onChange={(ev) => setSaveName(ev.target.value)}
            placeholder={suggestedSaveName}
            spellCheck={false}
            autoComplete="off"
            className={`min-w-0 flex-1 rounded border bg-slate-950 px-2 py-1.5 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none ${
              ephemeral ? "border-amber-500/50" : "border-slate-700"
            }`}
          />
          <button
            type="submit"
            className={`${primaryActionBtn} ${
              ephemeral
                ? "bg-amber-500 text-slate-950 ring-1 ring-amber-300 hover:bg-amber-400"
                : "bg-slate-100 text-slate-900 hover:bg-white"
            }`}
          >
            Save
          </button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onDefaultMap} className={secondaryChipBtn}>
          Default Map
        </button>
        <button type="button" onClick={onRandomSeed} className={secondaryChipBtn}>
          Random
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-snug text-slate-600">
        Assumes in-game <span className="text-slate-500">Random</span> node randomization with{" "}
        <span className="text-slate-500">unchanged</span> purity.
      </p>

      {library.seeds.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-2">
          <div className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            Saved Seeds
          </div>
          <ul className="mt-1.5 space-y-1">
            {library.seeds.map((pt) => {
              const isActive = pt.id === library.activeId;
              const confirmingDelete = deleteConfirmId === pt.id;
              return (
                <li
                  key={pt.id}
                  data-seed-row={pt.id}
                  className={`rounded-md border px-2 py-1.5 transition-colors ${
                    confirmingDelete
                      ? "border-red-500/60 bg-red-950/50"
                      : isActive
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  {renameId === pt.id ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        commitRename(pt);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          cancelRename();
                        }
                      }}
                    >
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[12px] text-slate-200 focus:border-slate-500 focus:outline-none"
                        aria-label="Rename seed"
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-amber-400 hover:bg-slate-800 hover:text-amber-300"
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        onClick={cancelRename}
                        className="shrink-0 rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : confirmingDelete ? (
                    <div className="flex items-center gap-0.5">
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[12px] font-medium text-red-200">
                          Delete “{pt.name}”?
                        </div>
                        <div className="font-mono text-[10px] text-red-300/70">
                          {pt.plans.length} plan{pt.plans.length === 1 ? "" : "s"} will be removed
                        </div>
                      </div>
                      <button
                        type="button"
                        title="Confirm delete"
                        aria-label={`Confirm delete ${pt.name}`}
                        className={`${iconBtn} text-red-300 hover:bg-red-950 hover:text-red-100`}
                        onClick={() => confirmDelete(pt)}
                      >
                        <CheckIcon />
                      </button>
                      <button
                        type="button"
                        title="Cancel delete"
                        aria-label="Cancel delete"
                        className={`${iconBtn} text-red-300/80 hover:bg-red-950 hover:text-red-100`}
                        onClick={cancelDeleteConfirm}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => onSelectSavedSeed(pt)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-[12px] font-medium text-slate-200">
                          {pt.name}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {formatSeedLabel(pt.seed)} · {pt.plans.length} heatmap
                          {pt.plans.length === 1 ? "" : "s"}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Rename"
                        aria-label={`Rename ${pt.name}`}
                        className={iconBtn}
                        onClick={() => {
                          setDeleteConfirmId(null);
                          setRenameId(pt.id);
                          setRenameValue(pt.name);
                        }}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        aria-label={`Delete ${pt.name}`}
                        className={`${iconBtn} hover:text-red-400`}
                        onClick={() => beginDeleteConfirm(pt)}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 border-t border-slate-800 pt-2 text-[10px] leading-snug text-slate-600">
        Node shuffle powered by{" "}
        <a
          href="https://github.com/Konsl/satisfactory-world-generator"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-500 underline decoration-slate-700 underline-offset-2 hover:text-sky-400"
        >
          Konsl
        </a>{" "}
        (MIT)
      </p>
    </div>,
    document.body,
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5.2 12.8 2 13.5l.7-3.2L11.5 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Persist a named seed entry (no browser prompt). */
export function commitSaveSeed(
  library: SeedLibrary,
  seed: MapSeed,
  nameInput: string,
  existing?: SavedSeed | null,
): { library: SeedLibrary; saved: SavedSeed } {
  const suggested = existing?.name ?? defaultNameForSeed(seed);
  const name = uniqueSeedName(library, nameInput.trim() || suggested, existing?.id);
  const pt: SavedSeed = existing
    ? {
        ...existing,
        name,
        seed,
        autoNamed: false,
        updatedAt: Date.now(),
      }
    : createSavedSeed({ name, seed, autoNamed: false });
  let lib = gcEmptyAutoNamed(library, existing?.id);
  lib = upsertSavedSeed(lib, pt);
  persistSeedLibrary(lib);
  return { library: lib, saved: pt };
}

export function autoSaveSeed(
  library: SeedLibrary,
  seed: number,
): { library: SeedLibrary; saved: SavedSeed } {
  const name = uniqueSeedName(library, defaultNameForSeed(seed));
  const pt = createSavedSeed({ name, seed, autoNamed: true });
  let lib = gcEmptyAutoNamed(library);
  lib = upsertSavedSeed(lib, pt);
  persistSeedLibrary(lib);
  return { library: lib, saved: pt };
}
