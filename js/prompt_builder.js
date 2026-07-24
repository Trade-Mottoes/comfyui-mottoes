import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Node lifecycle for the Prompt Builder node.
//
// The prompt is composed from reorderable sections with seeded wildcards. The
// sections are edited in a Vue app (js/prompt/editor.js); this module owns the
// node lifecycle — the `state` DOM widget that serializes the model into the
// workflow, the seed bridge, the live-preview route call, and sizing. Mirrors
// the Metadata Resolver picker; unlike it, this node emits a STRING, so the
// resolver lives in Python and runs at execution time (and backs the preview).

import { mountEditor } from "./prompt/editor.js";
import { serialize, deserialize, toPlain } from "./prompt/serialize.js";

const NODE = "Prompt Builder (Mottoes)";
const STATE_WIDGET = "state";
const STATE_WIDGET_TYPE = "prompt_state";   // our DOM widget, vs the auto textarea

function contentHeight(node) {
    const measured = node._pbEl?.scrollHeight;
    if (measured > 0) return measured + 6;
    return 360;
}

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

/** Remove the frontend's auto-created `state` textarea, returning its value.
 *
 *  A multiline STRING widget is backed by a real <textarea> element, and
 *  splicing the widget out of `node.widgets` does NOT detach that element.
 *  On frontend 1.45.x it is left orphaned over the node: it renders the stale
 *  default JSON, is disconnected from the model, and still accepts typing.
 *  So run the widget's own teardown and detach the element explicitly.
 *
 *  Never removes our own DOM widget — both are named `state`, ours is typed
 *  STATE_WIDGET_TYPE. Returns null when there was nothing to remove.
 */
function dropAutoStateWidget(node) {
    const idx = (node.widgets ?? []).findIndex(
        (w) => w.name === STATE_WIDGET && w.type !== STATE_WIDGET_TYPE,
    );
    if (idx < 0) return null;
    const w = node.widgets[idx];
    const value = parsedState(w.value);
    try { w.onRemove?.(); } catch { /* ignore */ }
    try { w.element?.remove?.(); } catch { /* ignore */ }  // textarea-backed builds
    node.widgets.splice(idx, 1);
    return { value };
}

/** Re-check after a configure: the frontend rebuilds widgets from the node
 *  definition on load, so the textarea can come back. */
function sweepAutoStateWidget(node) {
    if (dropAutoStateWidget(node)) resizeNode(node);
}

function setup(node) {
    if (node._pbEl) return;

    // Take the auto-created text widget's value, then remove it: the DOM widget
    // below serializes the model as `state` itself.
    const initial = dropAutoStateWidget(node)?.value ?? "";

    const container = document.createElement("div");
    node._pbEl = container;

    const { model, setState, unmount } = mountEditor({
        container,
        initialState: deserialize(initial),
        getSeed: () => Number(seedWidget(node)?.value ?? 0),
        setSeed: (v) => {
            const w = seedWidget(node);
            if (w) {
                w.value = v;
                w.callback?.(v);
            }
        },
        build: (state, seed) => buildRoute(toPlain(state), seed),
        onChange: () => resizeNode(node),
    });
    node._pbModel = model;
    node._pbSetState = setState;
    node._pbUnmount = unmount;

    const domWidget = node.addDOMWidget(STATE_WIDGET, STATE_WIDGET_TYPE, container, {
        serialize: true,
        getValue: () => serialize(model),
        setValue: (v) => {
            const s = parsedState(v);
            if (s == null) return;   // e.g. control_after_generate's "randomize"
            setState(deserialize(s));
            resizeNode(node);
        },
    });
    domWidget.computeSize = (w) => [w, contentHeight(node)];

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

        // On load: rebuild the model from the saved state (read from
        // widgets_values, robust to how the host routed the value).
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            stripStateInput(this);   // workflows saved before this restore the slot
            sweepAutoStateWidget(this);
            if (!this._pbSetState) return;
            const saved = savedState(info?.widgets_values);
            if (saved != null) {
                this._pbSetState(deserialize(saved));
                resizeNode(this);
            }
        };

        // Tear down the Vue app when the node is removed (the resolver omits this).
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            try {
                this._pbUnmount?.();
            } catch {
                /* ignore */
            }
            onRemoved?.apply(this, arguments);
        };
    },
});
