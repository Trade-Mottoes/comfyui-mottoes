// Wildcard tokenizer — for syntax highlighting only.
//
// The frontend NEVER resolves wildcards (Python is the single source of truth);
// it only classifies spans so the editor can colour them. The grammar mirrors
// nodes/prompt_builder.py: {a|b|c} choice, [a|b|c] array, __name__ wildcard.

const OPENERS = "{[";
const CLOSERS = "}]";
const MATCH = { "}": "{", "]": "[" };
const WILDCARD = /^__([A-Za-z0-9_./-]+)__/;
const VAR = /^%([A-Za-z0-9_]+)%/;   // %name% choice variable

function findSpan(text, i) {
    const stack = [text[i]];
    for (let j = i + 1; j < text.length; j++) {
        const c = text[j];
        if (OPENERS.includes(c)) stack.push(c);
        else if (CLOSERS.includes(c)) {
            if (stack[stack.length - 1] === MATCH[c]) {
                stack.pop();
                if (!stack.length) return j;
            } else return -1;
        }
    }
    return -1;
}

/** Segments: {type:'text'|'choice'|'array'|'wildcard'|'error', text, start, end}. */
export function tokenize(text) {
    const segs = [];
    let i = 0;
    let buf = "";
    let bufStart = 0;
    const flush = (at) => {
        if (buf) segs.push({ type: "text", text: buf, start: bufStart, end: at });
        buf = "";
    };
    while (i < text.length) {
        const c = text[i];
        if (c === "{" || c === "[") {
            const end = findSpan(text, i);
            if (end === -1) {
                flush(i);
                segs.push({ type: "error", text: c, start: i, end: i + 1 });
                bufStart = i + 1;
                i += 1;
                continue;
            }
            flush(i);
            segs.push({
                type: c === "{" ? "choice" : "array",
                text: text.slice(i, end + 1),
                start: i,
                end: end + 1,
            });
            bufStart = end + 1;
            i = end + 1;
        } else if (c === "_" && text.startsWith("__", i)) {
            const m = WILDCARD.exec(text.slice(i));
            if (m) {
                flush(i);
                segs.push({ type: "wildcard", text: m[0], start: i, end: i + m[0].length });
                bufStart = i + m[0].length;
                i += m[0].length;
            } else {
                if (!buf) bufStart = i;
                buf += c;
                i += 1;
            }
        } else if (c === "%") {
            const m = VAR.exec(text.slice(i));
            if (m) {
                flush(i);
                segs.push({ type: "var", text: m[0], start: i, end: i + m[0].length });
                bufStart = i + m[0].length;
                i += m[0].length;
            } else {
                if (!buf) bufStart = i;
                buf += c;
                i += 1;
            }
        } else {
            if (!buf) bufStart = i;
            buf += c;
            i += 1;
        }
    }
    flush(i);
    return segs;
}

const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML for the highlight backdrop behind the textarea. Trailing newline keeps
 *  the backdrop's height in step with the textarea as the last line is edited.
 *  Pass the section id, pins and modes to tint tokens that are pinned to a value
 *  or dealing from a deck — a mode you can't otherwise see without reopening the
 *  token dialog. A pin wins the tint: it overrides the mode entirely at build. */
export function highlightHtml(text, sectionId = "", pins = null, choiceNames = null, modes = null) {
    const counts = {};
    const html = tokenize(text)
        .map((s) => {
            if (s.type === "text") return esc(s.text);
            if (s.type === "var") {
                // undefined choice name (or none defined yet) → error tint so typos show
                const undef = choiceNames && !choiceNames.has(s.text.slice(1, -1));
                return `<span class="tok ${undef ? "tok-error" : "tok-var"}">${esc(s.text)}</span>`;
            }
            // occurrence counting mirrors tokenContextAt / Python's _next_key
            const occ = counts[s.text] ?? 0;
            counts[s.text] = occ + 1;
            const key = `${sectionId}|${s.text}|${occ}`;
            const pinned = pins && pins[key] !== undefined;
            const deck = !pinned && modes && modes[key] === "deck";
            const extra = pinned ? " tok-pinned" : deck ? " tok-deck" : "";
            return `<span class="tok tok-${s.type}${extra}">${esc(s.text)}</span>`;
        })
        .join("");
    return html + "\n";
}

/** The token whose span contains the caret offset, or null. */
export function tokenAt(text, offset) {
    for (const s of tokenize(text)) {
        if (s.type === "text") continue;
        if (offset >= s.start && offset <= s.end) return s;
    }
    return null;
}

// --- helpers for the popup list editor (parsing/rebuilding a single token) ---

/** Split token inner text on `|` at bracket-depth 0 (nested tokens stay whole). */
export function splitTopLevel(content) {
    const parts = [];
    let depth = 0;
    let cur = "";
    for (const c of content) {
        if (OPENERS.includes(c)) { depth++; cur += c; }
        else if (CLOSERS.includes(c)) { depth--; cur += c; }
        else if (c === "|" && depth === 0) { parts.push(cur); cur = ""; }
        else cur += c;
    }
    parts.push(cur);
    return parts;
}

const OPT_WEIGHT = /^\s*(\d+(?:\.\d+)?)::([\s\S]*)$/;

/** One option string -> {value, weight} (weight only meaningful for choices). */
export function parseOption(opt, type) {
    if (type === "choice") {
        const m = OPT_WEIGHT.exec(opt);
        if (m) return { value: m[2], weight: m[1] };
    }
    return { value: opt, weight: "" };
}

/** Rebuild a token string from edited options. Mirrors the grammar Python reads. */
export function buildTokenString(type, options) {
    if (type === "choice") {
        const body = options
            .map((o) => {
                const w = String(o.weight ?? "").trim();
                return w && w !== "1" ? `${w}::${o.value}` : o.value;
            })
            .join("|");
        return `{${body}}`;
    }
    return `[${options.map((o) => o.value).join("|")}]`;
}

/** The token at `offset` plus its occurrence index among identical tokens in the
 *  string — the pieces of the pin key, kept in step with Python's `_next_key`. */
export function tokenContextAt(content, offset) {
    const counts = {};
    for (const s of tokenize(content)) {
        if (s.type === "text") continue;
        const occ = counts[s.text] ?? 0;
        counts[s.text] = occ + 1;
        if (offset >= s.start && offset <= s.end) return { seg: s, occ };
    }
    return null;
}
