import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import * as Vue from "./lib/vue.esm-browser.prod.js";

// Node lifecycle for the Prompt Builder node.
//
// Two surfaces share ONE reactive model (serialized into the node's `state`
// widget, so workflow round-trip is unchanged):
//   • the node = a compact read-only VIEW (js/prompt/nodeview.js);
//   • a full-screen DIALOG = the build/edit surface (js/prompt/editor.js),
//     opened from the node. Moving editing off the node retires the whole class
//     of node-surface problems (renderers, sizing, orphaned textareas).
// Resolution happens in Python; the frontend only tokenizes for highlighting.

import { mountEditor } from "./prompt/editor.js";
import { mountNodeView } from "./prompt/nodeview.js";
import { serialize, deserialize, toPlain, applyState } from "./prompt/serialize.js";

const { reactive } = Vue;

const NODE = "Prompt Builder (Mottoes)";
const STATE_WIDGET = "state";
const STATE_WIDGET_TYPE = "prompt_state";   // our DOM widget, vs the auto textarea

const MIN_VIEW_H = 120;   // the node view never gets shorter than this

function resizeNode(node) {
    requestAnimationFrame(() => {
        const computed = node.computeSize();
        node.setSize([Math.max(node.size?.[0] ?? 0, computed[0]), computed[1]]);
        node.graph?.setDirtyCanvas(true, true);
    });
}

const seedWidget = (node) => (node.widgets ?? []).find((w) => w.name === "seed");

async function buildRoute(stateObj, seed) {
    const res = await api.fetchApi("/mottoes/prompt/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateObj, seed }),
    });
    if (!res.ok) throw new Error(`build failed (${res.status})`);
    return await res.json();
}

/** `v` if it is our serialized state, else null.
 *  Unlike the Resolver, this node has more than one string widget — `seed`'s
 *  `control_after_generate` combo carries "randomize"/"fixed"/etc. ComfyUI hands
 *  that value to this widget whenever widget positions shift, so every entry
 *  point validates the shape rather than trusting position or string-ness. */
function parsedState(v) {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t.startsWith("{")) return null;
    try {
        const o = JSON.parse(t);
        return o && Array.isArray(o.sections) ? v : null;
    } catch {
        return null;
    }
}

/** Pull our serialized state out of widgets_values (array or object form). */
function savedState(vals) {
    if (Array.isArray(vals)) {
        for (const v of vals) {
            if (parsedState(v) != null) return v;
        }
        return null;
    }
    if (vals && typeof vals === "object") return parsedState(vals[STATE_WIDGET]);
    return null;
}

/** Drop the `state` widget-input socket. The editor owns that value, so a wire
 *  into it would do nothing. `seed` keeps its socket — driving it is useful. */
function stripStateInput(node) {
    const i = (node.inputs ?? []).findIndex((inp) => inp.name === STATE_WIDGET);
    if (i >= 0) node.removeInput(i);
}

/** Detach the auto `state` widget's <textarea> element (and its `.dom-widget`
 *  wrapper). Under the legacy (non-Vue) renderer this element is created lazily
 *  on the node's first draw — AFTER onNodeCreated — so `widget.element` is still
 *  null when we splice, and the element is left orphaned over our view. So call
 *  this again once the element exists. (Nodes 2.0 tears it down itself.) */
function detachOrphanState(widget) {
    try { widget?.onRemove?.(); } catch { /* ignore */ }
    const el = widget?.element;
    if (el) { try { (el.closest?.(".dom-widget") ?? el).remove(); } catch { /* ignore */ } }
}

/** Remove the frontend's auto-created `state` widget, returning its value.
 *  Never removes our own DOM widget — both are named `state`, ours is typed
 *  STATE_WIDGET_TYPE. Returns null when there was nothing to remove. */
function dropAutoStateWidget(node) {
    const idx = (node.widgets ?? []).findIndex(
        (w) => w.name === STATE_WIDGET && w.type !== STATE_WIDGET_TYPE,
    );
    if (idx < 0) return null;
    const w = node.widgets[idx];
    const value = parsedState(w.value);
    node.widgets.splice(idx, 1);
    detachOrphanState(w);                               // element may exist already
    requestAnimationFrame(() => detachOrphanState(w));  // legacy: created on first draw
    setTimeout(() => detachOrphanState(w), 300);        // ...or a slightly later one
    return { value };
}

/** Re-check after a configure: the frontend rebuilds widgets from the node
 *  definition on load, so the textarea can come back. */
function sweepAutoStateWidget(node) {
    if (dropAutoStateWidget(node)) resizeNode(node);
}

// --------------------------------------------------------------------------- //
// The full-screen editor dialog (opened from the node view)
// --------------------------------------------------------------------------- //

function openEditor(node) {
    if (node._pbDialog) return;   // already open
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const dialog = mountEditor({
        container: overlay,
        model: node._pbModel,
        live: node._pbLive,
        getSeed: () => Number(seedWidget(node)?.value ?? 0),
        setSeed: (v) => {
            const w = seedWidget(node);
            if (w) { w.value = v; w.callback?.(v); }
        },
        build: (state, seed) => buildRoute(toPlain(state), seed),
        onChange: () => { node.graph?.setDirtyCanvas(true, false); resizeNode(node); },
        onClose: () => closeEditor(node),
    });
    node._pbDialog = { dialog, overlay };
}

function closeEditor(node) {
    const d = node._pbDialog;
    if (!d) return;
    node._pbDialog = null;
    try { d.dialog.unmount(); } catch { /* ignore */ }
    try { d.overlay.remove(); } catch { /* ignore */ }
}

function setup(node) {
    if (node._pbEl) return;

    // Take the auto-created text widget's value, then remove it.
    const initial = dropAutoStateWidget(node)?.value ?? "";

    // One reactive model, shared by the node view and the editor dialog.
    const model = reactive(deserialize(initial));
    node._pbModel = model;
    // Latest resolved output, transient (never serialized). The editor writes it on
    // every preview/build so the node view reflects live edits, not just the last
    // Build. Kept OUT of `model` so the editor's deep watch can't loop on it.
    const live = reactive({ output: null });
    node._pbLive = live;

    const container = document.createElement("div");
    node._pbEl = container;
    node._pbView = mountNodeView({ container, model, live, openEditor: () => openEditor(node) });

    // Rehydrate on load (belt-and-suspenders alongside the widget's setValue).
    node._pbSetState = (s) => { applyState(model, s); resizeNode(node); };

    const domWidget = node.addDOMWidget(STATE_WIDGET, STATE_WIDGET_TYPE, container, {
        serialize: true,
        getValue: () => serialize(model),
        setValue: (v) => {
            const s = parsedState(v);
            if (s == null) return;   // e.g. control_after_generate's "randomize"
            applyState(model, deserialize(s));
            resizeNode(node);
        },
    });
    // Fill the node: give the view all the height from where it sits down to the
    // node's bottom, so the output preview expands as the node is made taller
    // (never below MIN_VIEW_H). `last_y` is this widget's drawn y within the node;
    // before the first draw, fall back to a title + seed estimate.
    domWidget.computeSize = function (width) {
        const top = this.last_y > 0 ? this.last_y : 90;
        return [width, Math.max(MIN_VIEW_H, (node.size?.[1] ?? 0) - top - 6)];
    };

    resizeNode(node);
}

app.registerExtension({
    name: "Mottoes.PromptBuilder",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            setup(this);
            stripStateInput(this);
        };

        // Double-click the node → open the full editor.
        const onDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function () {
            const r = onDblClick?.apply(this, arguments);
            openEditor(this);
            return r;
        };

        // On load: rebuild the model from the saved state (read from
        // widgets_values, robust to how the host routed the value).
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            stripStateInput(this);   // workflows saved before this restore the slot
            sweepAutoStateWidget(this);
            if (!this._pbSetState) return;
            const saved = savedState(info?.widgets_values);
            if (saved != null) this._pbSetState(deserialize(saved));
        };

        // Tear down both surfaces when the node is removed.
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            try { closeEditor(this); } catch { /* ignore */ }
            try { this._pbView?.unmount?.(); } catch { /* ignore */ }
            onRemoved?.apply(this, arguments);
        };
    },
});
