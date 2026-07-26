import { app } from "../../scripts/app.js";

// Node lifecycle for the Group Muter / Group Bypasser nodes.
//
// Both nodes are the same thing pointed at a different "off" mode, so they share
// one editor (js/groups/editor.js) and one live-groups service (js/groups/service.js);
// this module owns the node lifecycle — the DOM widget, the subscription, the
// per-node settings and sizing. Mirrors the Multi Lora Loader entry
// (js/multi_lora_loader.js), minus the serialized state: the switches read the
// graph itself, so there is nothing about the groups to save on the node.
//
// The settings (order, filter, restriction, jump buttons) live in LiteGraph
// `properties`, which serialize with the workflow for free and show up in the
// node's properties panel. Nothing is sent to Python — the nodes never execute.

import { mountEditor, DEFAULTS } from "./groups/editor.js";
import { subscribe, NODES } from "./groups/service.js";

const STATE_WIDGET = "groups";
const STATE_WIDGET_TYPE = "mottoes_groups";
const MIN_WIDTH = 240;

/** Height of the editor's own content.
 *
 *  Measured on the editor root rather than the widget container: `scrollHeight`
 *  never reports less than the element's own box, and the container keeps the
 *  node's old height until the next draw — so measuring it would floor every
 *  shrink (closing a panel, filtering rows away) at the previous size. */
function contentHeight(node) {
    const root = node._mgtEl?.firstElementChild ?? node._mgtEl;
    const measured = root?.scrollHeight;
    if (measured > 0) return measured + 6;
    return 80;
}

/** Fit the node to its content.
 *
 *  The widget's element is laid out lazily — under the legacy renderer it isn't
 *  measurable until after the node's first draw, and after a Vue re-render the
 *  new rows land a frame later — so one measurement can be stale and nothing
 *  else would come along to correct it. Re-measure until the content height
 *  stops moving, at most a few frames. */
function resizeNode(node, passes = 3) {
    requestAnimationFrame(() => {
        const measured = contentHeight(node);
        const computed = node.computeSize();
        node.setSize([
            Math.max(node.size?.[0] ?? 0, computed[0], MIN_WIDTH),
            computed[1],
        ]);
        node.graph?.setDirtyCanvas(true, true);
        if (passes > 0 && measured !== node._mgtMeasured) {
            node._mgtMeasured = measured;
            resizeNode(node, passes - 1);
        }
    });
}

/** The persisted settings, read off the node's properties. */
function readSettings(node) {
    const props = node.properties ?? {};
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
        if (props[key] !== undefined) out[key] = props[key];
    }
    return out;
}

function writeSettings(node, settings) {
    node.properties = node.properties ?? {};
    for (const key of Object.keys(DEFAULTS)) node.properties[key] = settings[key];
}

function setup(node, { modeOff, offVerb }) {
    if (node._mgtEl) return;

    const container = document.createElement("div");
    node._mgtEl = container;

    const { setGroups, setSettings, unmount } = mountEditor({
        container,
        modeOff,
        offVerb,
        settings: readSettings(node),
        onSettings: (s) => {
            writeSettings(node, s);
            resizeNode(node);
        },
        onLayout: () => resizeNode(node),
    });
    node._mgtSetSettings = setSettings;

    // Seed the properties so they show up in the node's properties panel even
    // before anything is changed.
    writeSettings(node, { ...DEFAULTS, ...readSettings(node) });

    const domWidget = node.addDOMWidget(STATE_WIDGET, STATE_WIDGET_TYPE, container, {
        serialize: false, // the graph is the state — nothing to round-trip
    });
    domWidget.computeSize = (w) => [w, contentHeight(node)];

    // Teardown is idempotent: it runs from onRemoved for a deleted node, and from
    // the service when an undo/redo swaps this instance out behind our back.
    let unsubscribe = null;
    node._mgtTeardown = () => {
        node._mgtTeardown = null;
        try { unsubscribe?.(); } catch { /* ignore */ }
        try { unmount(); } catch { /* ignore */ }
    };

    unsubscribe = subscribe(
        node,
        (rows) => {
            setGroups(rows);
            resizeNode(node);
        },
        () => node._mgtTeardown?.(),
    );

    resizeNode(node);
}

app.registerExtension({
    name: "Mottoes.GroupToggle",

    beforeRegisterNodeDef(nodeType, nodeData) {
        const spec = NODES[nodeData?.name];
        if (!spec) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            setup(this, spec);
        };

        // On load: properties are restored before this runs, so re-seed the editor
        // from them (the group rows come from the service on the next sweep).
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            this._mgtSetSettings?.(readSettings(this));
            resizeNode(this);
        };

        // Tear down the Vue app and stop listening when the node is removed.
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._mgtTeardown?.();
            onRemoved?.apply(this, arguments);
        };
    },
});
