// State (de)serialization for the Power Lora Loader node.
//
// The DOM widget persists the whole stack as one JSON string: an array of row
// objects. Python (nodes/power_lora_loader.py `coerce_rows`) reads the same
// shape, so keep the field names in lock-step: {on, lora, strength, strengthClip}.
// `id` is a frontend-only handle for Vue keys/reorder and is never serialized.

let _seq = 0;
const uid = () => `l${++_seq}_${Math.random().toString(36).slice(2, 7)}`;

export function makeRow(init = {}) {
    return {
        id: init.id || uid(),
        on: init.on ?? true,
        lora: init.lora ?? null,
        strength: typeof init.strength === "number" ? init.strength : 1,
        // null → the model strength is reused for CLIP (single-strength mode).
        strengthClip: typeof init.strengthClip === "number" ? init.strengthClip : null,
    };
}

/** Parse the widget value (JSON string or array) into a rows array. */
export function deserialize(value) {
    let arr = value;
    if (typeof value === "string") {
        const s = value.trim();
        if (!s) return [];
        try {
            arr = JSON.parse(s);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && typeof r === "object").map((r) => makeRow(r));
}

/** The plain array the widget stores / Python receives (drops the frontend `id`). */
export function toPlain(rows) {
    return rows.map((r) => {
        const o = {
            on: !!r.on,
            lora: r.lora ?? null,
            strength: Number.isFinite(r.strength) ? r.strength : 0,
        };
        if (typeof r.strengthClip === "number") o.strengthClip = r.strengthClip;
        return o;
    });
}

export function serialize(rows) {
    return JSON.stringify(toPlain(rows));
}

/** `value` if it is our serialized stack (a JSON array string), else null.
 *  Like the Prompt Builder, every entry point validates the shape rather than
 *  trusting widget position — a sibling combo (e.g. a boolean's value) can be
 *  routed to this widget when widget positions shift. */
export function parsedStack(value) {
    if (typeof value !== "string") return null;
    const t = value.trim();
    if (!t.startsWith("[")) return null;
    try {
        return Array.isArray(JSON.parse(t)) ? value : null;
    } catch {
        return null;
    }
}
