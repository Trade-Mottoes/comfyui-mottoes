// Serialization for the resolver editor's row model.
//
// The editor's source of truth is a flat, ordered list of entries — either a
// `group` header or a `field` binding — and grouping is positional (a header
// applies to the fields that follow it, until the next header). This list is
// stored in the node's hidden `bindings` widget so it travels in the workflow /
// prompt, where the gallery reads it back.
//
// Going forward the widget holds JSON (v2). We still PARSE the legacy line format
// (`field: #id.input`) so old workflows open cleanly; we only ever WRITE JSON.

let _uid = 0;
const nextId = () => `e${++_uid}_${Math.random().toString(36).slice(2, 7)}`;

export function makeField(partial = {}) {
    return {
        id: nextId(), kind: "field",
        key: partial.key ?? "",
        nodeId: partial.nodeId ?? null,
        input: partial.input ?? null,
        type: partial.type ?? "auto",
    };
}

export function makeGroup(title = "") {
    return { id: nextId(), kind: "group", title };
}

// ---- write (always JSON v2) -------------------------------------------------

export function serialize(entries) {
    const out = [];
    for (const e of entries ?? []) {
        if (e.kind === "group") {
            out.push({ kind: "group", title: e.title ?? "" });
        } else if (e.key) {
            const row = { kind: "field", key: e.key };
            if (e.nodeId != null) row.node = String(e.nodeId);
            if (e.input) row.input = e.input;
            if (e.type && e.type !== "auto") row.type = e.type;
            out.push(row);
        }
    }
    return JSON.stringify({ version: 2, entries: out }, null, 2);
}

// ---- read (JSON v2 or legacy lines) -----------------------------------------

function parseJson(obj) {
    const entries = [];
    for (const e of obj?.entries ?? []) {
        if (!e || typeof e !== "object") continue;
        if (e.kind === "group") {
            entries.push(makeGroup(String(e.title ?? "")));
        } else {
            entries.push(makeField({
                key: String(e.key ?? "").trim(),
                nodeId: e.node != null ? String(e.node) : null,
                input: e.input ? String(e.input) : null,
                type: e.type ?? "auto",
            }));
        }
    }
    return entries;
}

function separatorIndex(line) {
    const found = [":", "="].map(c => line.indexOf(c)).filter(i => i >= 0);
    return found.length ? Math.min(...found) : -1;
}

function parseLegacy(text) {
    const entries = [];
    for (const raw of String(text ?? "").split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("//")) {
            // `// #group: Title` markers become group headers; other comments drop.
            const m = /^\/\/\s*#group:\s*(.*)$/i.exec(line);
            if (m) entries.push(makeGroup(m[1].trim()));
            continue;
        }
        const idx = separatorIndex(line);
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        if (!key) continue;
        const pointer = line.slice(idx + 1).trim().replace(/^#/, "").trim();
        if (!pointer) { entries.push(makeField({ key })); continue; }
        const dot = pointer.indexOf(".");
        if (dot < 0) { entries.push(makeField({ key })); continue; }
        entries.push(makeField({
            key, nodeId: pointer.slice(0, dot).trim(), input: pointer.slice(dot + 1).trim(),
        }));
    }
    return entries;
}

/** Parse the widget value (JSON v2 or legacy lines) into the entry model. */
export function deserialize(text) {
    const s = String(text ?? "").trim();
    if (!s) return [];
    if (s.startsWith("{")) {
        try {
            const obj = JSON.parse(s);
            if (obj && typeof obj === "object" && Array.isArray(obj.entries)) return parseJson(obj);
        } catch { /* fall through to legacy */ }
    }
    return parseLegacy(s);
}

/** Bound field entries only — used for validation counts, etc. */
export function boundKeys(entries) {
    return (entries ?? []).filter(e => e.kind === "field" && e.key).map(e => e.key);
}
