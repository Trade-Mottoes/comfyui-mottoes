// Vue editor for the Power Lora Loader node.
//
// A standalone Vue app (vendored full build — templates compile at runtime, no
// build step) mounted into the node's DOM widget. The reactive model is a flat
// list of LoRA rows; the extension entry (../power_lora_loader.js) owns the DOM
// widget + (de)serialization and passes the model in. Loading/hashing/CivitAI all
// happen in Python at execution time — the frontend only edits the stack.
//
// UX note: reordering is surfaced as inline ▲/▼ buttons and a drag handle (no
// right-click context menu, unlike rgthree).

import * as Vue from "../lib/vue.esm-browser.prod.js";
import { makeRow } from "./serialize.js";

const { createApp, reactive, ref, computed, nextTick } = Vue;

const MAX_RESULTS = 300;

function injectStyles() {
    if (document.getElementById("imgsaver-lora-css")) return;
    const style = document.createElement("style");
    style.id = "imgsaver-lora-css";
    // Themed via ComfyUI / PrimeVue CSS variables (literal fallbacks) so the editor
    // follows the active theme in both the classic and Nodes 2.0 renderers.
    style.textContent = `
        .pll-editor { display:flex; flex-direction:column; gap:4px; padding:4px 2px;
            font-size:12px; box-sizing:border-box; color:var(--input-text,#ddd); }
        .pll-editor button, .pll-editor input {
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:4px;
            padding:2px 6px; font-size:12px; height:24px; box-sizing:border-box; }
        .pll-editor button { cursor:pointer; }
        .pll-editor button:hover:not(:disabled) { border-color:var(--p-primary-color,#4a90d9); }
        .pll-editor button:disabled { opacity:0.35; cursor:default; }
        .pll-editor input:focus, .pll-editor button:focus { outline:none; border-color:var(--p-primary-color,#4a90d9); }

        /* header */
        .pll-head { display:flex; align-items:center; gap:6px; padding:0 2px 2px; }
        .pll-head .pll-alllabel { flex:1 1 0; font-weight:600; color:var(--descrip-text,#aaa);
            text-transform:uppercase; letter-spacing:0.03em; font-size:10px; }
        .pll-head .pll-slabel { flex:0 0 148px; text-align:center; font-weight:600;
            color:var(--descrip-text,#aaa); text-transform:uppercase; letter-spacing:0.03em; font-size:10px; }

        /* rows */
        .pll-rows { display:flex; flex-direction:column; gap:4px; }
        .pll-row { display:flex; align-items:center; gap:5px; border:1px solid var(--border-color,#444);
            border-radius:6px; background:var(--comfy-menu-bg,#2a2a2a); padding:3px 5px; }
        .pll-row.off { opacity:0.5; }
        .pll-row.dragging { opacity:0.4; }
        .pll-row.drop-before { box-shadow:inset 0 3px 0 var(--p-primary-color,#4a90d9); }
        .pll-handle { flex:0 0 12px; cursor:grab; text-align:center; color:var(--descrip-text,#888);
            user-select:none; line-height:22px; }
        .pll-name { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            text-align:left; }
        .pll-name.empty { color:var(--descrip-text,#888); font-style:italic; }
        .pll-strength { flex:0 0 62px; text-align:center; -moz-appearance:textfield; }
        .pll-strength::-webkit-outer-spin-button, .pll-strength::-webkit-inner-spin-button { margin:0; }
        .pll-move { flex:0 0 22px; padding:0; line-height:1; }
        .pll-remove { flex:0 0 24px; padding:0; }
        .pll-remove:hover { border-color:var(--error-text,#c0504d); color:var(--error-text,#c0504d); }

        /* toggle switch */
        .pll-tog { flex:0 0 34px; height:18px; border-radius:9px; position:relative; padding:0;
            background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#555); cursor:pointer; }
        .pll-tog::after { content:''; position:absolute; top:1px; left:1px; width:13px; height:13px;
            border-radius:50%; background:var(--descrip-text,#999); transition:transform .12s, background .12s; }
        .pll-tog.on { background:var(--p-primary-color,#4a90d9); border-color:var(--p-primary-color,#4a90d9); }
        .pll-tog.on::after { transform:translateX(15px); background:#fff; }
        .pll-tog.mixed::after { transform:translateX(7px); background:#e0a44a; }

        .pll-add button { width:100%; height:26px; }
        .pll-empty { padding:8px; text-align:center; color:var(--descrip-text,#888); font-size:11px;
            border:1px dashed var(--border-color,#444); border-radius:6px; }

        /* search dialog (teleported to body) */
        .pll-overlay { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.45);
            display:flex; align-items:flex-start; justify-content:center; }
        .pll-overlay .dialog { margin-top:12vh; width:min(560px,90vw); max-height:70vh;
            display:flex; flex-direction:column; background:var(--comfy-menu-bg,#2a2a2a);
            border:1px solid var(--border-color,#444); border-radius:8px; overflow:hidden;
            box-shadow:0 12px 40px rgba(0,0,0,0.5); color:var(--input-text,#ddd); font-size:13px; }
        .pll-overlay .search { width:100%; box-sizing:border-box; border:none;
            border-bottom:1px solid var(--border-color,#444); background:var(--comfy-input-bg,#222);
            color:var(--input-text,#ddd); padding:12px 14px; font-size:15px; outline:none; }
        .pll-overlay .results { overflow-y:auto; }
        .pll-overlay .result { display:flex; align-items:baseline; gap:10px; padding:7px 14px;
            cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.04); }
        .pll-overlay .result.active { background:var(--p-primary-color,#4a90d9); color:#fff; }
        .pll-overlay .result .r-name { font-weight:600; flex:0 0 auto; }
        .pll-overlay .result .r-dir { flex:1 1 auto; color:var(--descrip-text,#aaa);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .pll-overlay .result.active .r-dir { color:rgba(255,255,255,0.85); }
        .pll-overlay .empty { padding:16px; text-align:center; color:var(--descrip-text,#888); }
        .pll-overlay .hint { padding:6px 14px; font-size:11px; color:var(--descrip-text,#888);
            border-top:1px solid var(--border-color,#444); }
    `;
    document.head.appendChild(style);
}

const TEMPLATE = `
<div class="pll-editor">
  <div v-if="model.rows.length" class="pll-head">
    <button class="pll-tog" :class="allClass" @click="toggleAll"
            :title="allState === true ? 'Disable all' : 'Enable all'"></button>
    <span class="pll-alllabel">Toggle all</span>
    <span class="pll-slabel">Strength</span>
  </div>

  <div class="pll-rows">
    <div v-for="(r,i) in model.rows" :key="r.id" class="pll-row" :class="rowClass(r,i)"
         @dragover.prevent="onDragOver(i)" @drop.prevent="onDrop(i)">
      <span class="pll-handle" title="Drag to reorder" draggable="true"
            @dragstart="onDragStart(i)" @dragend="onDragEnd">⠿</span>
      <button class="pll-tog" :class="{on:r.on}" @click="toggle(r)"
              :title="r.on ? 'Disable' : 'Enable'"></button>
      <button class="pll-name" :class="{empty:!r.lora}" @click="openSearch(r)"
              :title="r.lora || 'Click to choose a LoRA'">{{ label(r) }}</button>
      <input class="pll-strength" type="number" step="0.05" :value="r.strength"
             @change="setStrength(r,$event.target.value)"
             title="LoRA strength (model + CLIP)" />
      <button class="pll-move" :disabled="i===0" @click="move(i,-1)" title="Move up">▲</button>
      <button class="pll-move" :disabled="i===model.rows.length-1" @click="move(i,1)" title="Move down">▼</button>
      <button class="pll-remove" @click="remove(i)" title="Remove">✕</button>
    </div>
  </div>

  <div v-if="!model.rows.length" class="pll-empty">No LoRAs yet — add one below.</div>

  <div class="pll-add">
    <button @click="addLora" title="Add a LoRA to the stack">➕ Add LoRA</button>
  </div>

  <teleport to="body">
    <div v-if="search.open" class="pll-overlay" @click.self="closeSearch">
      <div class="dialog">
        <input ref="searchInput" class="search" :value="search.query"
               @input="search.query = $event.target.value; search.active = 0"
               @keydown="onSearchKey" placeholder="Search LoRAs by name or folder…" />
        <div class="results">
          <div v-for="(r,ri) in results" :key="r" class="result"
               :class="{active: ri===search.active}"
               @click="choose(r)" @mouseenter="search.active = ri">
            <span class="r-name">{{ baseName(r) }}</span>
            <span class="r-dir">{{ dirName(r) }}</span>
          </div>
          <div v-if="!results.length" class="empty">{{ loading ? 'Loading…' : 'No matches' }}</div>
        </div>
        <div class="hint">↑↓ to move · Enter to select · Esc to close</div>
      </div>
    </div>
  </teleport>
</div>
`;

/** Strip a known model extension for display; keep the sub-folder path. */
function stripExt(path) {
    return String(path).replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, "");
}
function baseName(path) {
    const p = stripExt(path);
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i >= 0 ? p.slice(i + 1) : p;
}
function dirName(path) {
    const p = stripExt(path);
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i >= 0 ? p.slice(0, i) : "";
}

/**
 * Mount the editor into `container`. `loadLoras()` resolves to the array of LoRA
 * filenames (from the backend route); `onChange()` runs after any mutation that
 * affects node height. Returns the reactive model plus `setRows` to replace the
 * rows in place (so Vue reactivity and the caller's serialized view stay in sync).
 */
export function mountEditor({ container, initialRows = [], loadLoras, onChange }) {
    injectStyles();
    const changed = () => onChange?.();
    const model = reactive({ rows: initialRows });

    const app = createApp({
        setup() {
            const searchInput = ref(null);
            const dragFrom = ref(-1);
            const dropAt = ref(-1);
            const allLoras = ref(null);          // cached file list (null = not fetched)
            const loading = ref(false);
            const search = reactive({ open: false, query: "", active: 0, targetId: null });

            // ---- derived ----
            const label = (r) => (r.lora ? baseName(r.lora) : "Click to choose a LoRA");
            const allState = computed(() => {
                const rows = model.rows;
                if (!rows.length) return false;
                if (rows.every((r) => r.on)) return true;
                if (rows.every((r) => !r.on)) return false;
                return null; // mixed
            });
            const allClass = computed(() =>
                allState.value === true ? "on" : allState.value === null ? "mixed" : "",
            );
            const rowClass = (r, i) => ({
                off: !r.on,
                dragging: i === dragFrom.value,
                "drop-before": i === dropAt.value && dragFrom.value !== -1,
            });

            // ---- mutations ----
            const toggle = (r) => { r.on = !r.on; };
            const toggleAll = () => {
                const to = allState.value !== true; // any-off (or all-off) → all-on; all-on → all-off
                model.rows.forEach((r) => (r.on = to));
            };
            const setStrength = (r, v) => {
                const n = Number(v);
                r.strength = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
            };
            const remove = (i) => { model.rows.splice(i, 1); changed(); };
            const move = (i, dir) => {
                const j = i + dir;
                if (j < 0 || j >= model.rows.length) return;
                const [row] = model.rows.splice(i, 1);
                model.rows.splice(j, 0, row);
            };
            const addLora = () => {
                const r = makeRow({ lora: null });
                model.rows.push(r);
                changed();
                nextTick(() => openSearch(r));
            };

            // ---- drag reorder ----
            const onDragStart = (i) => { dragFrom.value = i; };
            const onDragOver = (i) => { dropAt.value = i; };
            const onDrop = (i) => {
                const from = dragFrom.value;
                if (from !== -1 && from !== i) {
                    const [row] = model.rows.splice(from, 1);
                    model.rows.splice(from < i ? i - 1 : i, 0, row);
                    changed();
                }
                dragFrom.value = -1; dropAt.value = -1;
            };
            const onDragEnd = () => { dragFrom.value = -1; dropAt.value = -1; };

            // ---- search dialog ----
            const ensureLoras = async () => {
                if (allLoras.value != null) return;
                loading.value = true;
                try {
                    allLoras.value = (await loadLoras?.()) ?? [];
                } catch {
                    allLoras.value = [];
                } finally {
                    loading.value = false;
                }
            };
            const results = computed(() => {
                const list = allLoras.value ?? [];
                const terms = search.query.toLowerCase().split(/\s+/).filter(Boolean);
                const hits = terms.length
                    ? list.filter((f) => { const l = f.toLowerCase(); return terms.every((t) => l.includes(t)); })
                    : list;
                return hits.slice(0, MAX_RESULTS);
            });
            const openSearch = (r) => {
                search.targetId = r.id; search.query = ""; search.active = 0; search.open = true;
                ensureLoras();
                nextTick(() => searchInput.value?.focus());
            };
            const closeSearch = () => { search.open = false; search.targetId = null; };
            const onSearchKey = (ev) => {
                if (ev.key === "Escape") { closeSearch(); return; }
                if (ev.key === "ArrowDown") { ev.preventDefault(); search.active = Math.min(search.active + 1, results.value.length - 1); }
                else if (ev.key === "ArrowUp") { ev.preventDefault(); search.active = Math.max(search.active - 1, 0); }
                else if (ev.key === "Enter") { ev.preventDefault(); const r = results.value[search.active]; if (r) choose(r); }
            };
            const choose = (file) => {
                const r = model.rows.find((x) => x.id === search.targetId);
                if (r) r.lora = file;
                closeSearch();
            };

            return {
                model, search, searchInput, loading, results,
                allState, allClass, rowClass, label, baseName, dirName,
                toggle, toggleAll, setStrength, remove, move, addLora,
                onDragStart, onDragOver, onDrop, onDragEnd,
                openSearch, closeSearch, onSearchKey, choose,
            };
        },
        template: TEMPLATE,
    });

    app.mount(container);
    const setRows = (list) => { model.rows.splice(0, model.rows.length, ...list); };
    return { app, model, setRows, unmount: () => app.unmount() };
}
