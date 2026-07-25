// State (de)serialization for the Prompt Builder node.
//
// The DOM widget persists the whole node model as one JSON string (see
// PROMPT_NODE_SPEC §8). Python (`nodes/prompt_builder.py`) reads the same shape,
// so keep the field names in lock-step. Section ids must be stable across
// save/reload — pins are keyed by section id.

let _seq = 0;
const uid = (p = "s") => `${p}${++_seq}_${Math.random().toString(36).slice(2, 7)}`;

export function makeSection(init = {}) {
    return {
        id: init.id || uid("s"),
        // Empty by default: the header falls back to a preview of the content,
        // which is more use than a generic "Section" — especially when collapsed.
        title: init.title ?? "",
        enabled: init.enabled ?? true,
        collapsed: init.collapsed ?? false,
        content: init.content ?? "",
    };
}

/** One option of a choice: `label` shows in the menu, `value` is injected. */
export function makeOption(init = {}) {
    return {
        id: init.id || uid("o"),
        label: init.label ?? "",
        value: init.value ?? "",
    };
}

/** A choice variable, referenced as `%name%`. `selected` is an option id.
 *  `mode` is "single" for now (random/multi reserved for later). */
export function makeChoice(init = {}) {
    const options =
        Array.isArray(init.options) && init.options.length
            ? init.options.map(makeOption)
            : [makeOption()];
    return {
        id: init.id || uid("c"),
        name: init.name ?? "",
        mode: init.mode ?? "single",
        options,
        selected: init.selected ?? options[0]?.id ?? null,
    };
}

export function defaultState() {
    return {
        version: 1,
        settings: { mode: "reroll", joiner: ", " },
        sections: [makeSection()],
        pins: {},
        counters: {},
        choices: [],
        cache: null,
        history: [],
    };
}

function normalize(o) {
    const st = defaultState();
    st.settings = { ...st.settings, ...(o.settings || {}) };
    st.sections =
        Array.isArray(o.sections) && o.sections.length
            ? o.sections.map((s) => makeSection(s))
            : st.sections;
    st.pins = o.pins && typeof o.pins === "object" ? o.pins : {};
    st.counters = o.counters && typeof o.counters === "object" ? o.counters : {};
    st.choices = Array.isArray(o.choices) ? o.choices.map(makeChoice) : [];
    st.cache = o.cache || null;
    st.history = Array.isArray(o.history) ? o.history : [];
    return st;
}

/** JSON (current) or, for anything else, a single section holding the raw text. */
export function deserialize(text) {
    const s = String(text ?? "").trim();
    if (!s) return defaultState();
    if (s.startsWith("{")) {
        try {
            const o = JSON.parse(s);
            if (o && typeof o === "object") return normalize(o);
        } catch {
            /* fall through */
        }
    }
    return { ...defaultState(), sections: [makeSection({ content: s })] };
}

/** The plain object the widget stores / the build route receives. */
export function toPlain(state) {
    return {
        version: 1,
        settings: state.settings,
        sections: state.sections.map((s) => ({
            id: s.id,
            title: s.title,
            enabled: s.enabled,
            collapsed: s.collapsed,
            content: s.content,
        })),
        pins: state.pins,
        counters: state.counters,
        choices: state.choices.map((c) => ({
            id: c.id,
            name: c.name,
            mode: c.mode,
            options: c.options.map((o) => ({ id: o.id, label: o.label, value: o.value })),
            selected: c.selected,
        })),
        cache: state.cache,
        history: state.history,
    };
}

export function serialize(state) {
    return JSON.stringify(toPlain(state), null, 2);
}
