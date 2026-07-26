// Bookmarks — platform helpers (no UI).
//
// Bookmarks jump the canvas to a workflow *group*, bound by the group's stable
// `id` (rename-proof), and are stored per-workflow in `graph.extra` so they
// travel with the file. All app/LiteGraph access is funnelled through here.

import { app } from "../../../scripts/app.js";
import { fitGroup } from "../common/canvas.js";

// Framing a group is shared with the group toggle nodes; re-exported so callers
// that think of it as a bookmarks concern keep working.
export { fitGroup };

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

/** Fit the group referenced by a bookmark; returns true if it resolved. */
export function gotoBookmark(bm) {
    const group = findGroup(bm.groupId);
    if (!group) return false;
    fitGroup(group);
    return true;
}
