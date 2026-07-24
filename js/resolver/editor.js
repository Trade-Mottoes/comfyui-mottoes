// Vue editor for the Workflow Metadata Resolver node.
//
// A standalone Vue app (vendored full build — templates compile at runtime, no
// build step) mounted into the node's DOM widget. The reactive model is a flat
// list of `group`/`field` entries; the extension entry (../metadata_resolver_picker.js)
// owns the DOM widget + (de)serialization and passes the model in.

import * as Vue from "../lib/vue.esm-browser.prod.js";
import {
    FIELD_TYPES, FIELD_TEMPLATE, RESOLVER_NODE,
    nodeLabel, captureFields, fieldNames, fieldOptionLabel, fieldInfo,
    suggestFieldName, deriveType, buildSearchIndex, searchIndex, autoFillEntries,
} from "./graph.js";
import { makeField, makeGroup, boundKeys } from "./serialize.js";

const { createApp, reactive, ref, computed, nextTick } = Vue;

function injectStyles() {
    if (document.getElementById("imgsaver-resolver-css")) return;
    const style = document.createElement("style");
    style.id = "imgsaver-resolver-css";
    // Themed via ComfyUI / PrimeVue CSS variables (literal fallbacks) so the editor
    // follows the active theme in both the classic and Nodes 2.0 renderers.
    style.textContent = `
        .imgsaver-resolver { display:flex; flex-direction:column; gap:3px; padding:4px 2px;
            font-size:11px; box-sizing:border-box; color:var(--input-text,#ddd); }
        .imgsaver-resolver .rows { display:flex; flex-direction:column; gap:3px; }
        .imgsaver-resolver .row { display:flex; gap:3px; align-items:center; border-radius:4px; }
        .imgsaver-resolver .row.drop-before { box-shadow:inset 0 2px 0 var(--p-primary-color,#4a90d9); }
        .imgsaver-resolver .row.dragging { opacity:0.4; }
        .imgsaver-resolver .handle { flex:0 0 14px; cursor:grab; text-align:center;
            color:var(--descrip-text,#888); user-select:none; line-height:22px; }
        .imgsaver-resolver input, .imgsaver-resolver select, .imgsaver-resolver button {
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:4px;
            padding:2px 6px; font-size:11px; height:22px; box-sizing:border-box; }
        .imgsaver-resolver input.key { flex:0 0 108px; min-width:0; }
        /* items nested under a group read one step in */
        .imgsaver-resolver .row.nested .handle { margin-left:10px; }
        .imgsaver-resolver button.node { flex:1 1 0; min-width:0; overflow:hidden;
            text-overflow:ellipsis; white-space:nowrap; cursor:pointer; text-align:left; }
        .imgsaver-resolver select.input { flex:1 1 0; min-width:0; text-overflow:ellipsis; }
        .imgsaver-resolver select.type { flex:0 0 62px; min-width:0; }
        .imgsaver-resolver input:focus, .imgsaver-resolver select:focus, .imgsaver-resolver button:focus {
            outline:none; border-color:var(--p-primary-color,#4a90d9); }
        .imgsaver-resolver .row.unbound input.key { color:var(--descrip-text,#888); font-style:italic; }
        .imgsaver-resolver .row.unbound button.node, .imgsaver-resolver .row.unbound select.input { opacity:0.6; }
        .imgsaver-resolver .row.invalid { background:rgba(192,80,77,0.14); }
        .imgsaver-resolver .row.invalid button.node.bad, .imgsaver-resolver .row.invalid select.input.bad {
            border-color:var(--error-text,#c0504d); }
        /* group header row */
        .imgsaver-resolver .row.group { background:var(--comfy-menu-bg,#2a2a2a); padding:1px 2px; }
        .imgsaver-resolver .row.group input.gtitle { flex:1 1 0; font-weight:600;
            text-transform:uppercase; letter-spacing:0.03em; font-size:10px; }
        .imgsaver-resolver button.remove { flex:0 0 24px; cursor:pointer; }
        .imgsaver-resolver button.remove:hover { border-color:var(--error-text,#c0504d); color:var(--error-text,#c0504d); }
        .imgsaver-resolver button:hover { border-color:var(--p-primary-color,#4a90d9); }
        .imgsaver-resolver .toolbar { display:flex; gap:4px; margin-top:3px; }
        .imgsaver-resolver .toolbar button { flex:1 1 0; height:24px; cursor:pointer; }
        .imgsaver-resolver .toolbar button.icon { flex:0 0 28px; }
        .imgsaver-resolver .template-menu { display:grid; grid-template-columns:repeat(3,1fr);
            gap:3px; margin-top:3px; }
        .imgsaver-resolver .template-menu button { cursor:pointer; display:flex; justify-content:space-between; gap:4px; }
        .imgsaver-resolver .template-menu button small { color:var(--descrip-text,#888); }

        /* search dialog (teleported to body) */
        .imgsaver-resolver-overlay { position:fixed; inset:0; z-index:10000;
            background:rgba(0,0,0,0.45); display:flex; align-items:flex-start; justify-content:center; }
        .imgsaver-resolver-overlay .dialog { margin-top:12vh; width:min(560px,90vw); max-height:70vh;
            display:flex; flex-direction:column; background:var(--comfy-menu-bg,#2a2a2a);
            border:1px solid var(--border-color,#444); border-radius:8px; overflow:hidden;
            box-shadow:0 12px 40px rgba(0,0,0,0.5); color:var(--input-text,#ddd); font-size:13px; }
        .imgsaver-resolver-overlay .search { width:100%; box-sizing:border-box; border:none;
            border-bottom:1px solid var(--border-color,#444); background:var(--comfy-input-bg,#222);
            color:var(--input-text,#ddd); padding:12px 14px; font-size:15px; outline:none; }
        .imgsaver-resolver-overlay .results { overflow-y:auto; }
        .imgsaver-resolver-overlay .result { display:flex; align-items:baseline; gap:10px;
            padding:7px 14px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.04); }
        .imgsaver-resolver-overlay .result.active { background:var(--p-primary-color,#4a90d9); color:#fff; }
        .imgsaver-resolver-overlay .result.node { opacity:0.85; font-style:italic; }
        .imgsaver-resolver-overlay .result .r-field { font-weight:600; flex:0 0 auto; }
        .imgsaver-resolver-overlay .result .r-node { flex:1 1 auto; color:var(--descrip-text,#aaa);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .imgsaver-resolver-overlay .result.active .r-node,
        .imgsaver-resolver-overlay .result.active .r-val { color:rgba(255,255,255,0.85); }
        .imgsaver-resolver-overlay .result .r-val { flex:0 0 auto; color:var(--descrip-text,#888);
            max-width:38%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .imgsaver-resolver-overlay .empty { padding:16px; text-align:center; color:var(--descrip-text,#888); }
        .imgsaver-resolver-overlay .hint { padding:6px 14px; font-size:11px; color:var(--descrip-text,#888);
            border-top:1px solid var(--border-color,#444); }
    `;
    document.head.appendChild(style);
}

const TEMPLATE = `
<div class="imgsaver-resolver">
  <div class="rows">
    <div v-for="(e,i) in model.entries" :key="e.id"
         class="row" :class="rowClass(e,i)"
         @dragover.prevent="onDragOver($event,i)" @drop.prevent="onDrop(i)">
      <span class="handle" :title="e.kind==='group' ? 'Drag to move the whole group' : 'Drag to reorder'"
            draggable="true" @dragstart="onDragStart(i)" @dragend="onDragEnd">⠿</span>

      <template v-if="e.kind === 'group'">
        <input class="gtitle" :value="e.title" @change="setTitle(e,$event.target.value)"
               placeholder="Group title" />
      </template>

      <template v-else>
        <input class="key" :value="e.key" @change="setKey(e,$event.target.value)"
               placeholder="field" title="Metadata field name" />
        <button class="node" :class="{bad:nodeMissing(e)}" @click="openSearch(e)"
                :title="nodeButtonTitle(e)">{{ nodeButtonLabel(e) }}</button>
        <select class="input" :class="{bad:inputMissing(e)}" :value="e.input || ''"
                @change="setInput(e,$event.target.value)" :disabled="e.nodeId==null">
          <option value="">(field)</option>
          <option v-for="f in inputOptions(e)" :key="f.value" :value="f.value">{{ f.label }}</option>
          <option v-if="inputMissing(e)" :value="e.input">{{ e.input }} (missing)</option>
        </select>
        <select class="type" :value="e.type" @change="setType(e,$event.target.value)" title="Metadata type">
          <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </template>

      <button class="remove" @click="remove(i)" title="Remove">✕</button>
    </div>
  </div>

  <div class="toolbar">
    <button @click="addField" title="Add a binding row">+ Field</button>
    <button @click="toggleTemplate" title="Add a common field">Template ▾</button>
    <button @click="autoFill" title="Trace the sampler and fill common fields + LoRAs">Auto-fill</button>
    <button @click="addGroup" title="Add a group header">+ Group</button>
    <button class="icon" @click="refresh" title="Refresh node/field lookups">↻</button>
  </div>

  <div v-if="templateOpen" class="template-menu">
    <button v-for="t in TEMPLATE_FIELDS" :key="t.key" @click="addFromTemplate(t)">
      <span>{{ t.key }}</span><small>{{ t.type }}</small>
    </button>
  </div>

  <teleport to="body">
    <div v-if="search.open" class="imgsaver-resolver-overlay" @click.self="closeSearch">
      <div class="dialog">
        <input ref="searchInput" class="search" :value="search.query"
               @input="search.query = $event.target.value; search.active = 0"
               @keydown="onSearchKey"
               placeholder="Search nodes by name, #id, or field name…" />
        <div class="results">
          <div v-for="(r,ri) in searchResults" :key="ri" class="result"
               :class="{active: ri===search.active, node: !r.input}"
               @click="choose(r)" @mouseenter="search.active = ri">
            <template v-if="r.input">
              <span class="r-field">{{ r.fieldLabel || r.input }}</span>
              <span class="r-node">{{ r.nodeLabel }}</span>
              <span class="r-val">{{ r.wired ? '→ wired' : r.valuePreview }}</span>
            </template>
            <span v-else class="r-node">{{ r.nodeLabel }} — pick a field</span>
          </div>
          <div v-if="!searchResults.length" class="empty">No matches</div>
        </div>
        <div class="hint">Type a node name, <b>#id</b>, or a field like <b>positive</b> · ↑↓ to move · Enter to select · Esc to close</div>
      </div>
    </div>
  </teleport>
</div>
`;

const MAX_RESULTS = 250;

/**
 * Mount the resolver editor into `container`. `getGraph()` returns the live
 * LiteGraph graph; `onChange()` is called after any mutation that affects
 * serialization or node height. Returns the reactive model plus a `setEntries`
 * that replaces the rows in place (so Vue reactivity and the caller's view of
 * the model stay in sync — the caller reads `model.entries` for serialization).
 */
export function mountEditor({ container, initialEntries = [], getGraph, onChange }) {
    injectStyles();
    const changed = () => onChange?.();
    const model = reactive({ entries: initialEntries });

    const app = createApp({
        setup() {
            const templateOpen = ref(false);
            const searchInput = ref(null);
            const rev = ref(0);                     // bump to re-read the (non-reactive) graph
            const dragFrom = ref(-1);
            const dropAt = ref(-1);
            const search = reactive({ open: false, query: "", active: 0, targetId: null });

            const graph = () => { rev.value; return getGraph?.() ?? null; };
            const nodeById = (id) => (id == null ? null : graph()?.getNodeById?.(Number(id)) ?? null);

            // ---- graph-derived helpers (re-run on rev bump / entry edits) ----
            const inputOptions = (e) => {
                const node = nodeById(e.nodeId);
                if (!node) return [];
                return captureFields(node).map(f => ({ value: f, label: fieldOptionLabel(node, f) }));
            };
            const nodeMissing = (e) => e.nodeId != null && !nodeById(e.nodeId);
            const inputMissing = (e) => !!e.input && (() => {
                const n = nodeById(e.nodeId); return !n || !fieldNames(n).has(e.input);
            })();
            const nodeButtonLabel = (e) => {
                if (e.nodeId == null) return "(pick node)";
                const n = nodeById(e.nodeId);
                return n ? nodeLabel(n) : `#${e.nodeId} (missing)`;
            };
            const nodeButtonTitle = (e) =>
                nodeMissing(e) ? `Node #${e.nodeId} is not in this workflow` : "Click to pick a node / field";
            const rowClass = (e, i) => {
                const cls = {};
                if (i === dragFrom.value) cls.dragging = true;
                if (i === dropAt.value && dragFrom.value !== -1) cls["drop-before"] = true;
                if (e.kind === "group") { cls.group = true; return cls; }
                // A field row is "nested" when a group header precedes it.
                for (let j = 0; j < i; j++) if (model.entries[j].kind === "group") { cls.nested = true; break; }
                const invalid = nodeMissing(e) || inputMissing(e);
                const bound = !!(e.nodeId && e.input) && !invalid;
                cls.invalid = invalid;
                cls.unbound = !invalid && !bound;
                return cls;
            };

            // ---- mutations ----
            const setKey = (e, v) => { e.key = v.trim(); changed(); };
            const setTitle = (e, v) => { e.title = v; changed(); };
            const setType = (e, v) => { e.type = v; changed(); };
            const setInput = (e, v) => { e.input = v || null; changed(); };
            const remove = (i) => { model.entries.splice(i, 1); changed(); };
            const addField = () => {
                const e = makeField();
                model.entries.push(e); changed();
                nextTick(() => openSearch(e));
            };
            const addGroup = () => { model.entries.push(makeGroup("")); changed(); };
            const toggleTemplate = () => { templateOpen.value = !templateOpen.value; nextTick(changed); };
            const addFromTemplate = (t) => {
                const e = makeField({ key: t.key, type: t.type });
                model.entries.push(e); templateOpen.value = false; changed();
                nextTick(() => openSearch(e));
            };
            const autoFill = () => {
                const traced = autoFillEntries(graph());
                if (!traced.length) return;
                // Non-destructive: never touch existing rows — only append fields whose
                // key isn't already present, creating a group header when a group is new.
                const haveKeys = new Set(model.entries.filter(e => e.kind === "field").map(e => e.key));
                const haveGroups = new Set(model.entries.filter(e => e.kind === "group").map(e => e.title));
                let lastGroup = null;
                for (const t of traced) {
                    if (haveKeys.has(t.key)) continue;
                    if (t.group && t.group !== lastGroup && !haveGroups.has(t.group)) {
                        model.entries.push(makeGroup(t.group));
                        haveGroups.add(t.group);
                    }
                    lastGroup = t.group;
                    model.entries.push(makeField(t));
                    haveKeys.add(t.key);
                }
                changed();
            };
            const refresh = () => { rev.value++; };

            // ---- drag reorder ----
            // A group header drags its whole block (the header + the field rows that
            // follow it up to the next header); a field row drags on its own.
            const blockLength = (from) => {
                if (model.entries[from]?.kind !== "group") return 1;
                let end = from + 1;
                while (end < model.entries.length && model.entries[end].kind !== "group") end++;
                return end - from;
            };
            const onDragStart = (i) => { dragFrom.value = i; };
            const onDragOver = (ev, i) => { ev.dataTransfer.dropEffect = "move"; dropAt.value = i; };
            const onDrop = (i) => {
                const from = dragFrom.value;
                const len = from === -1 ? 0 : blockLength(from);
                // Ignore a drop inside the block being moved.
                if (from !== -1 && !(i >= from && i < from + len)) {
                    const block = model.entries.splice(from, len);
                    const insertAt = i > from ? i - len : i;
                    model.entries.splice(insertAt, 0, ...block);
                    changed();
                }
                dragFrom.value = -1; dropAt.value = -1;
            };
            const onDragEnd = () => { dragFrom.value = -1; dropAt.value = -1; };

            // ---- search dialog ----
            const searchRows = computed(() => { rev.value; return search.open ? buildSearchIndex(graph()) : []; });
            const searchResults = computed(() => searchIndex(searchRows.value, search.query).slice(0, MAX_RESULTS));
            const openSearch = (e) => {
                search.targetId = e.id; search.query = ""; search.active = 0; search.open = true;
                nextTick(() => searchInput.value?.focus());
            };
            const closeSearch = () => { search.open = false; search.targetId = null; };
            const onSearchKey = (ev) => {
                if (ev.key === "Escape") { closeSearch(); return; }
                if (ev.key === "ArrowDown") { ev.preventDefault(); search.active = Math.min(search.active + 1, searchResults.value.length - 1); }
                else if (ev.key === "ArrowUp") { ev.preventDefault(); search.active = Math.max(search.active - 1, 0); }
                else if (ev.key === "Enter") { ev.preventDefault(); const r = searchResults.value[search.active]; if (r) choose(r); }
            };
            const choose = (r) => {
                const e = model.entries.find(x => x.id === search.targetId);
                if (!e) { closeSearch(); return; }
                e.nodeId = r.nodeId;
                if (r.input) {
                    e.input = r.input;
                    if (!e.key) e.key = suggestFieldName(r.input, boundKeys(model.entries).filter(k => k !== e.key));
                    if (e.type === "auto") e.type = deriveType(nodeById(r.nodeId), r.input);
                    changed(); closeSearch();
                } else {
                    // Node-only pick: keep the dialog open state closed, let the user
                    // choose the field from the row's input select.
                    e.input = null; changed(); closeSearch();
                }
            };

            return {
                model, search, templateOpen, searchInput, searchResults,
                TYPES: FIELD_TYPES, TEMPLATE_FIELDS: FIELD_TEMPLATE,
                inputOptions, nodeMissing, inputMissing, nodeButtonLabel, nodeButtonTitle, rowClass,
                setKey, setTitle, setType, setInput, remove, addField, addGroup, toggleTemplate, addFromTemplate, autoFill, refresh,
                onDragStart, onDragOver, onDrop, onDragEnd,
                openSearch, closeSearch, onSearchKey, choose,
            };
        },
        template: TEMPLATE,
    });

    app.mount(container);
    const setEntries = (list) => { model.entries.splice(0, model.entries.length, ...list); };
    return { app, model, setEntries, unmount: () => app.unmount() };
}

export { RESOLVER_NODE, fieldInfo };
