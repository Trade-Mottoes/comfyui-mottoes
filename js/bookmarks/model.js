// Bookmarks — platform helpers (no UI).
//
// Bookmarks jump the canvas to a workflow *group*, bound by the group's stable
// `id` (rename-proof), and are stored per-workflow in `graph.extra` so they
// travel with the file. All app/LiteGraph access is funnelled through here.

import { app } from "../../../scripts/app.js";

let _seq = 0;
export const uid = () => `bm${++_seq}_${Math.random().toString(36).slice(2, 7)}`;

// v1 operates on the root graph (subgraph groups are a later concern).
const rootGraph = () => app.graph ?? null;

// ---- groups ----------------------------------------------------------------

/** Live groups as `{ id, title }`, in canvas order. */
export function currentGroups() {
    return (rootGraph()?._groups ?? []).map((g) => ({
        id: g.id,
        title: (g.title ?? "").trim() || "(untitled group)",
    }));
}

export function findGroup(groupId) {
    return (rootGraph()?._groups ?? []).find((g) => g.id === groupId) ?? null;
}

// ---- storage (graph.extra) -------------------------------------------------

export function readBookmarks() {
    const list = rootGraph()?.extra?.mottoesBookmarks;
    return Array.isArray(list) ? list : [];
}

export function writeBookmarks(list) {
    const g = rootGraph();
    if (!g) return;
    g.extra = g.extra || {};
    g.extra.mottoesBookmarks = list;
}

// ---- key combos ------------------------------------------------------------

const MOD_ORDER = ["ctrl", "alt", "shift", "meta"];
const MOD_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

/** `event.code` → a stable, layout-independent key token. */
function codeToKey(code) {
    if (code.startsWith("Key")) return code.slice(3).toLowerCase();     // KeyK  -> k
    if (code.startsWith("Digit")) return code.slice(5);                 // Digit1 -> 1
    if (code.startsWith("Numpad")) return "num" + code.slice(6).toLowerCase();
    if (code.startsWith("Arrow")) return code.slice(5).toLowerCase();   // ArrowUp -> up
    return code.toLowerCase();
}

/** Canonical combo string for an event, or null if it lacks a modifier / is a
 *  bare modifier press. A modifier is required so bookmarks never eat plain typing. */
export function comboFromEvent(e) {
    if (MOD_KEYS.has(e.key)) return null;
    const mods = [];
    if (e.ctrlKey) mods.push("ctrl");
    if (e.altKey) mods.push("alt");
    if (e.shiftKey) mods.push("shift");
    if (e.metaKey) mods.push("meta");
    if (!mods.length) return null;
    return [...mods, codeToKey(e.code)].join("+");
}

const MOD_LABEL = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Cmd" };

/** Human-readable combo, e.g. "alt+1" -> "Alt+1". */
export function comboDisplay(combo) {
    if (!combo) return "";
    return combo
        .split("+")
        .map((p, i, a) => (i < a.length - 1 ? MOD_LABEL[p] ?? p : p.toUpperCase()))
        .join(" + ");
}

/** The next unused Alt+N (1..9), else "" — a sensible default for a new row. */
export function suggestCombo(existing) {
    const taken = new Set(existing.map((b) => b.combo));
    for (let n = 1; n <= 9; n++) {
        const c = `alt+${n}`;
        if (!taken.has(c)) return c;
    }
    return "";
}

// ---- centering -------------------------------------------------------------

// Only ever zoom OUT to frame a group — never magnify past 1:1, so jumping to a
// small group centres it at a readable size instead of blowing it up.
const MAX_FIT_SCALE = 1;

/** Fit `group` into the canvas viewport (scaled to fit, centered) with padding. */
export function fitGroup(group, pad = 60) {
    const canvas = app.canvas;
    const ds = canvas?.ds;
    if (!group || !ds) return;
    const b = group._bounding ?? [group.pos?.[0] ?? 0, group.pos?.[1] ?? 0, group.size?.[0] ?? 200, group.size?.[1] ?? 120];
    const [gx, gy, gw, gh] = [b[0], b[1], b[2], b[3]];
    const rect = canvas.canvas.getBoundingClientRect();
    // Fall back to sane defaults if the canvas isn't laid out (hidden tab etc.)
    // so we never divide by ~0 and jump to a degenerate scale.
    const vw = rect.width || 1200;
    const vh = rect.height || 800;
    const raw = Math.min(vw / (gw + pad * 2), vh / (gh + pad * 2));
    const scale = Math.max(ds.min_scale ?? 0.1, Math.min(raw, MAX_FIT_SCALE));
    ds.scale = scale;
    ds.offset[0] = vw / 2 / scale - (gx + gw / 2);
    ds.offset[1] = vh / 2 / scale - (gy + gh / 2);
    canvas.setDirty(true, true);
}

/** Fit the group referenced by a bookmark; returns true if it resolved. */
export function gotoBookmark(bm) {
    const group = findGroup(bm.groupId);
    if (!group) return false;
    fitGroup(group);
    return true;
}
