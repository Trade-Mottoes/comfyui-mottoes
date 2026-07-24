import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Node lifecycle for the Power Lora Loader node.
//
// The LoRA stack is edited in a Vue app (js/lora/editor.js); this module owns the
// node lifecycle — the `loras` DOM widget that serializes the stack into the
// workflow, the LoRA-list fetch that backs the picker, and sizing. Mirrors the
// Prompt Builder entry (js/prompt_builder.js), which solves the same auto-widget
// and (de)serialization problems. The node emits MODEL/CLIP/LORA_INFO from Python.

import { mountEditor } from "./lora/editor.js";
import { serialize, deserialize, parsedStack } from "./lora/serialize.js";

const NODE = "Multi Lora Loader (Mottoes)";
const STATE_WIDGET = "loras";
const STATE_WIDGET_TYPE = "lora_stack"; // our DOM widget, vs the auto textarea

let _lorasPromise = null;
/** Fetch the LoRA filename list once per session (the picker filters client-side). */
function fetchLoras() {
    if (!_lorasPromise) {
        _lorasPromise = api
            .fetchApi("/mottoes/loras")
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => []);
    }
    return _lorasPromise;
}

function contentHeight(node) {
    const measured = node._pllEl?.scrollHeight;
    if (measured > 0) return measured + 6;
    return 140;
}

function resizeNode(node) {
    requestAnimationFrame(() => {
        const computed = node.computeSize();
        node.setSize([Math.max(node.size?.[0] ?? 0, computed[0]), computed[1]]);
        node.graph?.setDirtyCanvas(true, true);
    });
}

/** Pull our serialized stack out of widgets_values (array or object form). */
function savedStack(vals) {
    if (Array.isArray(vals)) {
        for (const v of vals) if (parsedStack(v) != null) return v;
        return null;
    }
    if (vals && typeof vals === "object") return parsedStack(vals[STATE_WIDGET]);
    return null;
}

/** Remove the frontend's auto-created `loras` textarea, returning its value.
 *
 *  A multiline STRING widget is backed by a real <textarea>; splicing the widget
 *  out of `node.widgets` does not detach that element, so run its own teardown
 *  and detach explicitly (see the Prompt Builder entry for the gory details).
 *  Never removes our own DOM widget — both are named `loras`, ours is typed
 *  STATE_WIDGET_TYPE. Returns null when there was nothing to remove.
 */
function dropAutoStateWidget(node) {
    const idx = (node.widgets ?? []).findIndex(
        (w) => w.name === STATE_WIDGET && w.type !== STATE_WIDGET_TYPE,
    );
    if (idx < 0) return null;
    const w = node.widgets[idx];
    const value = parsedStack(w.value);
    try { w.onRemove?.(); } catch { /* ignore */ }
    try { w.element?.remove?.(); } catch { /* ignore */ }
    node.widgets.splice(idx, 1);
    return { value };
}

/** Re-check after a configure: the frontend rebuilds widgets from the node
 *  definition on load, so the textarea can come back. */
function sweepAutoStateWidget(node) {
    if (dropAutoStateWidget(node)) resizeNode(node);
}

function setup(node) {
    if (node._pllEl) return;

    // Take the auto-created text widget's value, then remove it: the DOM widget
    // below serializes the stack as `loras` itself.
    const initial = dropAutoStateWidget(node)?.value ?? "[]";

    const container = document.createElement("div");
    node._pllEl = container;

    const { model, setRows, unmount } = mountEditor({
        container,
        initialRows: deserialize(initial),
        loadLoras: fetchLoras,
        onChange: () => resizeNode(node),
    });
    node._pllModel = model;
    node._pllSetRows = setRows;
    node._pllUnmount = unmount;

    const domWidget = node.addDOMWidget(STATE_WIDGET, STATE_WIDGET_TYPE, container, {
        serialize: true,
        getValue: () => serialize(model.rows),
        setValue: (v) => {
            const s = parsedStack(v);
            if (s == null) return; // e.g. a sibling combo's value routed here
            setRows(deserialize(s));
            resizeNode(node);
        },
    });
    domWidget.computeSize = (w) => [w, contentHeight(node)];

    // Put the editor first, above the two boolean widgets ComfyUI created for the
    // optional inputs, so the stack reads top-to-bottom.
    const wi = node.widgets.indexOf(domWidget);
    if (wi > 0) {
        node.widgets.splice(wi, 1);
        node.widgets.unshift(domWidget);
    }

    resizeNode(node);
}

app.registerExtension({
    name: "Mottoes.MultiLoraLoader",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            setup(this);
        };

        // On load: rebuild the rows from the saved stack (read from widgets_values,
        // robust to how the host routed the value).
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            sweepAutoStateWidget(this);
            if (!this._pllSetRows) return;
            const saved = savedStack(info?.widgets_values);
            if (saved != null) {
                this._pllSetRows(deserialize(saved));
                resizeNode(this);
            }
        };

        // Tear down the Vue app when the node is removed.
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            try { this._pllUnmount?.(); } catch { /* ignore */ }
            onRemoved?.apply(this, arguments);
        };
    },
});
