// Graph introspection for the Workflow Metadata Resolver editor.
//
// Pure helpers over LiteGraph node/graph objects — no Vue, no ComfyUI imports —
// so they stay unit-friendly and reusable. The editor (editor.js) and the
// extension entry (../metadata_resolver_picker.js) both build on these.

export const RESOLVER_NODE = "Workflow Metadata Resolver (Mottoes)";

// The metadata value types the editor understands. `auto` defers to the gallery
// (infer from the resolved value); the rest describe how a field should render.
export const FIELD_TYPES = ["auto", "string", "prompt", "int", "float", "enum", "bool", "size", "hash", "lora"];

// Suggested field names for common inputs, so captured rows read cleanly.
const FIELD_ALIASES = {
    ckpt_name: "model", unet_name: "model", model_name: "model",
    sampler_name: "sampler", scheduler: "scheduler", noise_seed: "seed",
};

// The "usual suspects" template: common metadata fields with sensible types,
// offered as one-click adds. `key` is the metadata field name; the user still
// binds each to a node/input. Order here is the order they're offered + inserted.
export const FIELD_TEMPLATE = [
    { key: "positive", type: "prompt", group: "Prompts" },
    { key: "negative", type: "prompt", group: "Prompts" },
    { key: "model", type: "string", group: "Model" },
    { key: "sampler", type: "enum", group: "Sampling" },
    { key: "scheduler", type: "enum", group: "Sampling" },
    { key: "steps", type: "int", group: "Sampling" },
    { key: "cfg", type: "float", group: "Sampling" },
    { key: "seed", type: "int", group: "Sampling" },
    { key: "denoise", type: "float", group: "Sampling" },
    { key: "width", type: "int", group: "Dimensions" },
    { key: "height", type: "int", group: "Dimensions" },
    { key: "clip_skip", type: "int", group: "Model" },
    { key: "vae", type: "string", group: "Model" },
];

// ---- node / field basics ----------------------------------------------------

export function nodeClass(node) { return node?.type ?? node?.comfyClass ?? ""; }
export function nodeLabel(node) { return `${node.title || nodeClass(node)} (#${node.id})`; }

/** Union of a node's widget names and input names. */
export function fieldNames(node) {
    const names = new Set();
    for (const w of node?.widgets ?? []) if (w?.name) names.add(w.name);
    for (const i of node?.inputs ?? []) if (i?.name) names.add(i.name);
    return names;
}

/** Capturable fields of a node: widgets, plus linked inputs (resolvable via wire-follow). */
export function captureFields(node) {
    const seen = new Set();
    const out = [];
    for (const w of node?.widgets ?? []) {
        if (!w?.name || w.type === "button" || seen.has(w.name)) continue;
        seen.add(w.name); out.push(w.name);
    }
    for (const i of node?.inputs ?? []) {
        if (!i?.name || i.link == null || seen.has(i.name)) continue;
        seen.add(i.name); out.push(i.name);
    }
    return out;
}

function widgetFor(node, name) {
    return (node?.widgets ?? []).find(w => w?.name === name && w.type !== "button") ?? null;
}

/** Describe a field for display: human label, whether it's a wire, current value. */
export function fieldInfo(node, name) {
    const widget = widgetFor(node, name);
    if (widget) return { label: widget.label || name, wired: false, value: widget.value };
    return { label: name, wired: true, value: undefined };
}

/** Short, single-line preview of a widget value. */
export function previewValue(v) {
    if (v == null || v === "") return "";
    if (typeof v === "string") {
        const s = v.replace(/\s+/g, " ").trim();
        return s.length > 40 ? s.slice(0, 40) + "…" : s;
    }
    if (typeof v === "object") return Array.isArray(v) ? "[…]" : "{…}";
    return String(v);
}

/** "label · value" for widgets, "label → wired" for linked inputs. */
export function fieldOptionLabel(node, name) {
    const info = fieldInfo(node, name);
    if (info.wired) return `${info.label} → wired`;
    const preview = previewValue(info.value);
    return preview ? `${info.label} · ${preview}` : info.label;
}

/** A metadata field name suggested from an input name (+ positive/negative heuristics). */
export function suggestFieldName(inputName, boundKeys = []) {
    if (inputName === "text") {
        const bound = new Set(boundKeys);
        if (!bound.has("positive")) return "positive";
        if (!bound.has("negative")) return "negative";
        return "prompt";
    }
    return FIELD_ALIASES[inputName] ?? inputName;
}

/** Best-effort metadata type for an input, from its widget definition. `auto`
 *  when there's nothing to go on (e.g. a wired input with no widget). */
export function deriveType(node, inputName) {
    const w = widgetFor(node, inputName);
    if (!w) return "auto";
    const t = String(w.type ?? "").toLowerCase();
    const opts = w.options ?? {};
    if (t === "combo") return "enum";
    if (t === "toggle" || typeof w.value === "boolean") return "bool";
    if (t === "text" || t === "customtext" || t === "string") {
        return /prompt|positive|negative|^text$/i.test(inputName) ? "prompt" : "string";
    }
    if (t === "number") {
        if (opts.precision === 0) return "int";
        const stepInt = opts.step == null || Number.isInteger(opts.step);
        if (typeof w.value === "number" && Number.isInteger(w.value) && stepInt) return "int";
        return "float";
    }
    return "string";
}

// ---- graph search (for the picker dialog) -----------------------------------

/** All non-resolver nodes, sorted by label. */
export function pickableNodes(graph) {
    return (graph?._nodes ?? [])
        .filter(n => nodeClass(n) !== RESOLVER_NODE)
        .sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));
}

/** Flatten every node's capturable fields into search rows: one per (node, field),
 *  plus a bare node row (input:null) so a node can be picked without a field. */
export function buildSearchIndex(graph) {
    const rows = [];
    for (const n of pickableNodes(graph)) {
        const id = String(n.id);
        const title = n.title || "";
        const cls = nodeClass(n);
        rows.push({ nodeId: id, node: n, input: null, nodeTitle: title, nodeClass: cls, nodeLabel: nodeLabel(n) });
        for (const f of captureFields(n)) {
            const info = fieldInfo(n, f);
            rows.push({
                nodeId: id, node: n, input: f, nodeTitle: title, nodeClass: cls, nodeLabel: nodeLabel(n),
                fieldLabel: info.label, wired: info.wired, valuePreview: previewValue(info.value),
                optionLabel: fieldOptionLabel(n, f),
            });
        }
    }
    return rows;
}

/** Filter the search index by a query. Supports:
 *   - `#123`  → node id prefix match
 *   - text    → matches node title/class, field name, and value preview (all tokens)
 *  Node-only rows are kept only when the query is empty or clearly node-oriented,
 *  so a field query surfaces field rows rather than bare nodes. */
export function searchIndex(rows, query) {
    const q = String(query ?? "").trim();
    if (!q) return rows;

    if (q.startsWith("#")) {
        const idq = q.slice(1).trim();
        return rows.filter(r => r.nodeId.includes(idq));
    }

    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (r) => [r.nodeTitle, r.nodeClass, r.nodeId, r.input, r.fieldLabel, r.valuePreview]
        .filter(Boolean).join(" ").toLowerCase();
    return rows.filter(r => { const h = hay(r); return tokens.every(t => h.includes(t)); });
}

// ---- auto-fill (trace a sampler-centred graph) ------------------------------

function inputSource(graph, node, inputName) {
    const input = (node?.inputs ?? []).find(i => i?.name === inputName);
    if (!input || input.link == null) return null;
    const link = graph.links?.[input.link];
    return link ? (graph.getNodeById(link.origin_id) ?? null) : null;
}

function findSampler(graph) {
    return (graph?._nodes ?? []).find(n => /KSampler|SamplerCustom/.test(nodeClass(n))) ?? null;
}

function traceToWidget(graph, node, inputName, targets, depth = 0) {
    if (depth > 16) return null;
    const src = inputSource(graph, node, inputName);
    if (!src) return null;
    const names = fieldNames(src);
    for (const t of targets) if (names.has(t)) return { node: src, widget: t };
    if (names.has(inputName)) return traceToWidget(graph, src, inputName, targets, depth + 1);
    return null;
}

function traceToSize(graph, node, inputName, depth = 0) {
    if (depth > 16) return null;
    const src = inputSource(graph, node, inputName);
    if (!src) return null;
    const names = fieldNames(src);
    if (names.has("width") && names.has("height")) return src;
    for (const p of ["latent_image", "samples", "latent"]) {
        if (names.has(p)) { const r = traceToSize(graph, src, p, depth + 1); if (r) return r; }
    }
    return null;
}

/** Power Lora Loader (rgthree) lora slots: widgets whose value is a {lora, on,...} dict. */
function loraSlots(node) {
    const slots = [];
    for (const w of node?.widgets ?? []) {
        if (w?.name && w.value && typeof w.value === "object" && typeof w.value.lora === "string" && w.value.lora) {
            slots.push({ input: w.name, enabled: w.value.on !== false });
        }
    }
    return slots;
}

/** Multi Lora Loader (Mottoes): the whole LoRA stack lives in a single `loras`
 *  widget holding a JSON array of {on, lora, strength} rows — not rgthree's
 *  per-row dict widgets. Detected by that widget's presence; the (bespoke) gallery
 *  parses the JSON array into per-LoRA metadata. */
function hasLoraStack(node) {
    return (node?.widgets ?? []).some(w => w?.name === "loras");
}

/** Trace a sampler-centred graph into grouped, typed entries (mirrors the gallery).
 *  Grouped Standard (prompts, model, size) → Sampling → LoRAs, each group emitted
 *  contiguously so a single header covers it. */
export function autoFillEntries(graph) {
    const sampler = findSampler(graph);
    if (!sampler) return [];

    const sid = String(sampler.id);
    const names = fieldNames(sampler);
    const out = [];
    const add = (key, nodeId, input, type, group) =>
        out.push({ key, nodeId: String(nodeId), input, type, group });

    // --- Standard: prompts, model, dimensions ---
    if (names.has("positive")) add("positive", sid, "positive", "prompt", "Standard");
    if (names.has("negative")) add("negative", sid, "negative", "prompt", "Standard");
    const loader = traceToWidget(graph, sampler, "model", ["ckpt_name", "unet_name"]);
    if (loader) add("model", loader.node.id, loader.widget, "string", "Standard");
    const latent = traceToSize(graph, sampler, "latent_image");
    if (latent) {
        add("width", latent.id, "width", "int", "Standard");
        add("height", latent.id, "height", "int", "Standard");
    }

    // --- Sampling ---
    for (const [key, input, type] of [
        ["sampler", "sampler_name", "enum"], ["scheduler", "scheduler", "enum"],
        ["steps", "steps", "int"], ["cfg", "cfg", "float"], ["denoise", "denoise", "float"],
    ]) if (names.has(input)) add(key, sid, input, type, "Sampling");
    if (names.has("seed")) add("seed", sid, "seed", "int", "Sampling");
    else if (names.has("noise_seed")) add("seed", sid, "noise_seed", "int", "Sampling");

    // --- LoRAs ---
    for (const n of graph?._nodes ?? []) {
        const cls = nodeClass(n);
        if (/Power Lora Loader/i.test(cls)) {
            // rgthree Power Lora Loader: one {on, lora, strength} widget per row.
            for (const slot of loraSlots(n)) {
                if (slot.enabled) add(slot.input, n.id, slot.input, "lora", "LoRAs");
            }
        } else if (/Multi Lora Loader/i.test(cls) && hasLoraStack(n)) {
            // Multi Lora Loader (Mottoes): bind the whole stack once; the gallery
            // expands the `loras` JSON array into per-LoRA metadata.
            add("loras", n.id, "loras", "lora", "LoRAs");
        }
    }
    return out;
}
