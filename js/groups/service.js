import { app } from "../../../scripts/app.js";

// Live group state shared by every Group Muter / Group Bypasser node.
//
// A group's membership is implicit — whatever nodes happen to sit inside its
// bounds — and LiteGraph fires no event when that changes, when a group is
// added/renamed, or when a node's mode changes from somewhere else (Ctrl+M, the
// context menu, another toggle node). So the only reliable read is a poll.
//
// One timer serves every listening node: each tick recomputes membership once
// per distinct graph, builds a snapshot, and hands it out. Listeners are only
// called when their own snapshot actually changed, so an idle canvas costs one
// cheap sweep and nothing downstream. The timer only runs while at least one
// node is listening, and pauses while the tab is hidden.

export const MODE_ALWAYS = 0;
export const MODE_NEVER = 2; // "mute"
export const MODE_BYPASS = 4; // ComfyUI's bypass — LiteGraph has no constant for it

/** The toggle node types, and the mode each one switches a group off into.
 *  Keep the ids in lock-step with NODE_CLASS_MAPPINGS in __init__.py. */
export const NODES = {
    "Group Muter (Mottoes)": { modeOff: MODE_NEVER, offVerb: "mute" },
    "Group Bypasser (Mottoes)": { modeOff: MODE_BYPASS, offVerb: "bypass" },
};

const TICK_MS = 400;

/** node -> { onChange, signature } */
const listeners = new Map();
let timer = null;

/** The nodes a group actually controls.
 *
 *  Toggle nodes are skipped: one dropped inside a group it lists would otherwise
 *  switch *itself* off — greyed out and looking broken — and would keep the group
 *  reading as "on" when everything real in it is off. They never execute, so
 *  their mode means nothing anyway. */
function controlled(group) {
    return (group.nodes ?? []).filter((n) => !(n.type in NODES));
}

/** A snapshot row: plain data for the editor plus the live group to act on. */
function describe(group) {
    const nodes = controlled(group);
    return {
        id: group.id,
        title: (group.title ?? "").trim() || "(untitled group)",
        color: group.color ?? null,
        total: nodes.length,
        // "On" means the group still drives something: a group is off once every
        // node in it is muted or bypassed, whichever way it was switched off.
        on: nodes.some((n) => n.mode === MODE_ALWAYS),
        pos: [group._bounding?.[0] ?? 0, group._bounding?.[1] ?? 0],
        group,
    };
}

/** Snapshot every group in `graph`, refreshing membership first. */
function snapshot(graph, recompute) {
    const groups = graph?._groups ?? [];
    return groups.map((g) => {
        // Membership is derived from geometry, so it goes stale as soon as a node
        // is dragged in or out. Skip the recompute mid-drag (the positions are in
        // flux and LiteGraph is already busy) — the next idle tick catches up.
        if (recompute) {
            try { g.recomputeInsideNodes(); } catch { /* ignore */ }
        }
        return describe(g);
    });
}

/** Cheap equality key — what a listener would actually re-render on. */
function signature(rows) {
    return rows.map((r) => `${r.id}|${r.title}|${r.color}|${r.on ? 1 : 0}|${r.total}`).join("\n");
}

/** True once a node has been swapped out from under us.
 *
 *  Undo/redo (and any other change-tracker restore) rebuilds the graph's nodes
 *  without calling `onRemoved` on the old instances, and the orphan keeps a live
 *  `graph` reference — so a listener would otherwise stay registered forever,
 *  holding its Vue app alive. Being absent from the graph's own registry is what
 *  actually distinguishes it. A node with no graph at all is *not* orphaned: it
 *  is simply not added yet (subscribing happens in `onNodeCreated`).
 */
function isOrphaned(node) {
    const graph = node.graph;
    if (typeof graph?.getNodeById !== "function") return false; // nothing to check against
    return graph.getNodeById(node.id) !== node;
}

function tick() {
    timer = null;
    if (!listeners.size) return;

    const recompute = !app.canvas?.isDragging;
    const perGraph = new Map();
    for (const [node, state] of listeners) {
        if (isOrphaned(node)) {
            listeners.delete(node);
            state.onDetached?.();
            continue;
        }
        const graph = node.graph;
        if (!graph) continue; // not added to a graph yet
        let entry = perGraph.get(graph);
        if (!entry) {
            const rows = snapshot(graph, recompute);
            entry = { rows, sig: signature(rows) };
            perGraph.set(graph, entry);
        }
        if (entry.sig === state.signature) continue;
        state.signature = entry.sig;
        // Rows are shared between listeners on the same graph — read-only downstream.
        state.onChange(entry.rows);
    }
    schedule();
}

function schedule() {
    if (timer != null || !listeners.size || document.hidden) return;
    timer = setTimeout(tick, TICK_MS);
}

/** Run the next sweep now, and force listeners to accept it. */
export function refresh() {
    for (const state of listeners.values()) state.signature = null;
    if (timer != null) clearTimeout(timer);
    timer = null;
    tick();
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
});

/**
 * Listen for the live groups of `node`'s graph. `onChange(rows)` fires straight
 * away and then whenever the group list, titles, colours, sizes or on/off state
 * change. `onDetached()` fires if the node is replaced behind the scenes (undo,
 * redo, workflow restore) so the caller can tear its editor down. Returns an
 * unsubscribe function.
 */
export function subscribe(node, onChange, onDetached) {
    listeners.set(node, { onChange, onDetached, signature: null });
    // Defer the first read: on graph load the node exists before its graph is
    // populated, so an immediate sweep would report "no groups".
    setTimeout(refresh, 0);
    schedule();
    return () => {
        listeners.delete(node);
        if (!listeners.size && timer != null) {
            clearTimeout(timer);
            timer = null;
        }
    };
}

/**
 * Switch groups on/off in a single undoable step. `entries` is a list of
 * `{ group, on }`; `modeOff` is the mode to apply when switching off (mute or
 * bypass). Wrapped in the canvas change events so the whole batch is one undo.
 */
export function applyStates(entries, modeOff) {
    const canvas = app.canvas;
    canvas?.emitBeforeChange?.();
    try {
        for (const { group, on } of entries) {
            try { group.recomputeInsideNodes(); } catch { /* ignore */ }
            const mode = on ? MODE_ALWAYS : modeOff;
            for (const n of controlled(group)) n.mode = mode;
        }
    } finally {
        canvas?.emitAfterChange?.();
    }
    app.graph?.setDirtyCanvas(true, true);
    refresh(); // reflect the change on the switches now, not on the next tick
}
