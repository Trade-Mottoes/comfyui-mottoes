import { app } from '../../scripts/app.js'

// Component editor for the Workflow Metadata Resolver node.
//
// The node is a pure declaration: each row binds a metadata `field` to a value in
// the graph (`#node_id.input`), with an optional group header and value type. The
// rows are edited in a Vue app (js/resolver/editor.js); this module owns the node
// lifecycle — the hidden `bindings` DOM widget that serializes the rows into the
// workflow/prompt (where the gallery reads them), sizing, and the right-click
// "Send to Metadata Resolver" capture. Rows serialize to JSON (v2); the legacy
// line format still parses so old workflows open cleanly.

import { mountEditor } from './resolver/editor.js'
import { RESOLVER_NODE, nodeClass, captureFields, fieldOptionLabel, suggestFieldName, deriveType } from './resolver/graph.js'
import { serialize, deserialize, makeField, boundKeys } from './resolver/serialize.js'

const BINDINGS_WIDGET = "bindings";

// ---- node sizing ------------------------------------------------------------

/** Height for the DOM widget: measure the rendered content (so the template menu,
 *  drag state, and any wrapping are all accounted for), falling back to a
 *  per-entry estimate before the first paint. */
function contentHeight(node) {
    const measured = node._resolverListEl?.scrollHeight;
    if (measured > 0) return measured + 6;
    const rows = node._resolverModel?.entries?.length ?? 0;
    return 26 * rows + 40;
}

/** Resize the node to fit its rows WITHOUT collapsing the user's chosen width —
 *  computeSize()'s width is only a minimum, so keep whichever is larger. Runs on
 *  the next frame so the measured content height reflects the latest render. */
function resizeNode(node) {
    requestAnimationFrame(() => {
        const computed = node.computeSize();
        node.setSize([Math.max(node.size?.[0] ?? 0, computed[0]), computed[1]]);
        node.graph?.setDirtyCanvas(true, true);
    });
}

// ---- stale output cleanup ---------------------------------------------------

/** Remove stale output slots — the node has no outputs, but workflows saved with
 *  the older definition restore them on load. */
function stripOutputs(node) {
    if (!node.outputs) return;
    while (node.outputs.length) node.removeOutput(node.outputs.length - 1);
}

// ---- editor setup -----------------------------------------------------------

function setupResolverEditor(node) {
    if (node._resolverListEl) return;

    // Take the auto-created text widget's value, then remove it entirely: the rows
    // are the data, and the DOM widget below serializes them as `bindings` itself.
    const idx = (node.widgets ?? []).findIndex(w => w.name === BINDINGS_WIDGET);
    const initial = idx >= 0 ? node.widgets[idx].value : "";
    if (idx >= 0) {
        // Splicing alone is not enough: a multiline STRING widget is backed by a
        // real <textarea>. Under the legacy (non-Vue) renderer that element is
        // created lazily on the node's first draw — after this runs — so it is
        // left orphaned over the editor (stale text, still typeable). Nodes 2.0
        // cleans it up itself. Removal sticks, so detach the widget's own element
        // once it exists: now, next frame, and once more shortly after.
        const w = node.widgets[idx];
        node.widgets.splice(idx, 1);
        const detach = () => {
            try { w.onRemove?.(); } catch { /* ignore */ }
            const el = w.element;
            if (el) { try { (el.closest?.(".dom-widget") ?? el).remove(); } catch { /* ignore */ } }
        };
        detach();
        requestAnimationFrame(detach);
        setTimeout(detach, 300);
    }

    const container = document.createElement("div");
    node._resolverListEl = container;

    const { model, setEntries } = mountEditor({
        container,
        initialEntries: deserialize(initial),
        getGraph: () => node.graph,
        onChange: () => resizeNode(node),
    });
    node._resolverModel = model;
    node._resolverSetEntries = setEntries;

    // The DOM widget IS the `bindings` input: it serializes the rows into the
    // prompt (which the gallery reads), so there is no separate text widget.
    const domWidget = node.addDOMWidget(BINDINGS_WIDGET, "resolver_rows", container, {
        serialize: true,
        getValue: () => serialize(model.entries),
        setValue: (v) => { setEntries(deserialize(v)); resizeNode(node); },
    });
    domWidget.computeSize = (w) => [w, contentHeight(node)];

    resizeNode(node);
}

// ---- extension registration -------------------------------------------------

app.registerExtension({
    name: "Mottoes.MetadataResolverPicker",

    beforeRegisterNodeDef(nodeType, nodeData) {
        // "Send to Metadata Resolver" on every other node's right-click menu.
        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            getExtraMenuOptions?.apply(this, arguments);
            if (nodeClass(this) === RESOLVER_NODE) return;
            const fields = captureFields(this);
            if (!fields.length) return;

            const source = this;
            options.push({
                content: "Send to Metadata Resolver",
                has_submenu: true,
                submenu: {
                    options: fields.map(input => ({
                        content: fieldOptionLabel(source, input),
                        callback: (v, o, e) => sendCapture(source, input, e),
                    })),
                },
            });
        };

        if (nodeData?.name === RESOLVER_NODE) {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                onNodeCreated?.apply(this, arguments);
                setupResolverEditor(this);
                stripOutputs(this);
            };
            // On load: drop the stale output slots and rebuild rows from the saved
            // bindings value (JSON or legacy), read from widgets_values (robust to
            // whether the host routed it through the DOM widget's setValue).
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                onConfigure?.apply(this, arguments);
                stripOutputs(this);
                if (!this._resolverSetEntries) return;
                const vals = info?.widgets_values;
                let saved = null;
                if (Array.isArray(vals)) saved = vals.find(v => typeof v === "string");
                else if (vals && typeof vals === "object") saved = vals[BINDINGS_WIDGET];
                if (typeof saved === "string") {
                    this._resolverSetEntries(deserialize(saved));
                    resizeNode(this);
                }
            };
        }
    },
});

/** Bind `sourceNode.input` into a resolver (creating one if needed), suggesting a
 *  field name and deriving the value type. */
function sendCapture(sourceNode, input, event) {
    const graph = sourceNode.graph;
    const resolvers = (graph?._nodes ?? []).filter(n => nodeClass(n) === RESOLVER_NODE);

    const bind = (resolver) => {
        const model = resolver._resolverModel;
        if (!model) return;
        const field = suggestFieldName(input, boundKeys(model.entries));
        let row = model.entries.find(e => e.kind === "field" && e.key === field);
        if (!row) { row = makeField({ key: field }); model.entries.push(row); }
        row.nodeId = String(sourceNode.id);
        row.input = input;
        if (row.type === "auto") row.type = deriveType(sourceNode, input);
        resizeNode(resolver);
    };

    if (resolvers.length === 0) {
        const resolver = LiteGraph.createNode(RESOLVER_NODE);
        if (!resolver) return;
        graph.add(resolver);
        resolver.pos = [sourceNode.pos[0] + (sourceNode.size?.[0] ?? 200) + 40, sourceNode.pos[1]];
        bind(resolver);
    } else if (resolvers.length === 1) {
        bind(resolvers[0]);
    } else {
        new LiteGraph.ContextMenu(
            resolvers.map(r => ({ content: `${r.title || RESOLVER_NODE} (#${r.id})`, callback: () => bind(r) })),
            { event, title: "Choose Metadata Resolver" }
        );
    }
}
