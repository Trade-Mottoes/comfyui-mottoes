// Bookmarks — the sidebar panel (Vue).
//
// A standalone Vue app (vendored full build, no build step) mounted into the
// "Bookmarks" sidebar tab. Rows bind a workflow group (by stable id) to a key
// combo; the entry (../bookmarks.js) owns the global hotkey listener and reads
// the same graph.extra store this panel writes.

import * as Vue from "../lib/vue.esm-browser.prod.js";
import {
    uid, currentGroups, readBookmarks, writeBookmarks,
    comboFromEvent, comboDisplay, suggestCombo, gotoBookmark, findGroup,
} from "./model.js";

const { createApp, reactive, ref, computed } = Vue;

const clone = (b) => ({ id: b.id || uid(), groupId: b.groupId ?? null, combo: b.combo || "" });

function injectStyles() {
    if (document.getElementById("mottoes-bookmarks-css")) return;
    const style = document.createElement("style");
    style.id = "mottoes-bookmarks-css";
    style.textContent = `
        .mtb { display:flex; flex-direction:column; gap:6px; padding:8px; box-sizing:border-box;
            font-size:12px; color:var(--input-text,#ddd); }
        .mtb button, .mtb select, .mtb input {
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:4px;
            padding:3px 6px; font-size:12px; height:26px; box-sizing:border-box; }
        .mtb button { cursor:pointer; }
        .mtb button:hover:not(:disabled) { border-color:var(--p-primary-color,#4a90d9); }
        .mtb button:disabled { opacity:0.5; cursor:default; }
        .mtb select:focus, .mtb input:focus, .mtb button:focus { outline:none; border-color:var(--p-primary-color,#4a90d9); }

        .mtb-head { display:flex; gap:6px; align-items:center; }
        .mtb-head .mtb-title { font-weight:600; flex:1 1 auto; }
        .mtb-head button { flex:0 0 auto; height:26px; }
        .mtb-hint { color:var(--descrip-text,#888); font-size:11px; line-height:1.4; }

        .mtb-rows { display:flex; flex-direction:column; gap:5px; }
        .mtb-row { display:flex; align-items:center; gap:4px; border-radius:5px; }
        .mtb-row.dragging { opacity:0.4; }
        .mtb-row.drop-before { box-shadow:inset 0 2px 0 var(--p-primary-color,#4a90d9); }
        .mtb-handle { flex:0 0 12px; cursor:grab; color:var(--descrip-text,#888); user-select:none; text-align:center; }
        .mtb-group { flex:1 1 0; min-width:0; }
        .mtb-group.missing { border-color:var(--error-text,#c0504d); color:var(--error-text,#c0504d); }
        .mtb-combo { flex:0 0 86px; text-align:center; cursor:pointer; caret-color:transparent; }
        .mtb-combo.capturing { border-color:var(--p-primary-color,#4a90d9); color:var(--p-primary-color,#4a90d9); }
        .mtb-combo::placeholder { color:var(--descrip-text,#888); font-style:italic; }
        .mtb-go, .mtb-del { flex:0 0 26px; padding:0; }
        .mtb-del:hover { border-color:var(--error-text,#c0504d); color:var(--error-text,#c0504d); }

        .mtb-add { width:100%; }
        .mtb-empty { color:var(--descrip-text,#888); font-size:11px; text-align:center; padding:10px 4px; line-height:1.5; }
    `;
    document.head.appendChild(style);
}

const TEMPLATE = `
<div class="mtb">
  <div class="mtb-head">
    <span class="mtb-title">Bookmarks</span>
    <button class="mtb-icon" @click="refresh" title="Re-read the workflow's groups">↻</button>
  </div>
  <div class="mtb-hint">Jump the canvas to a group. Bound to the group itself, so renaming it is fine.</div>

  <div class="mtb-rows">
    <div v-for="(b,i) in state.bookmarks" :key="b.id" class="mtb-row" :class="rowClass(i)"
         @dragover.prevent="onDragOver($event,i)" @drop.prevent="onDrop(i)">
      <span class="mtb-handle" draggable="true" @dragstart="onDragStart(i)" @dragend="onDragEnd" title="Drag to reorder">⠿</span>
      <select class="mtb-group" :class="{missing: isMissing(b)}" :value="b.groupId ?? ''"
              @change="setGroup(b,$event.target.value)" title="Target group">
        <option value="">— pick a group —</option>
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.title }}</option>
        <option v-if="isMissing(b)" :value="b.groupId">⚠ missing (#{{ b.groupId }})</option>
      </select>
      <input class="mtb-combo" :class="{capturing: capturingId===b.id}" readonly
             :value="capturingId===b.id ? 'press keys…' : comboDisplay(b.combo)"
             @focus="capturingId=b.id" @blur="capturingId=null"
             @keydown.prevent.stop="onComboKey(b,$event)"
             placeholder="set key" title="Click, then press a modifier + key (e.g. Alt+1)" />
      <button class="mtb-go" @click="go(b)" :disabled="isMissing(b)||b.groupId==null" title="Jump to this group">▶</button>
      <button class="mtb-del" @click="remove(i)" title="Remove bookmark">✕</button>
    </div>
  </div>

  <div v-if="!state.bookmarks.length" class="mtb-empty">No bookmarks yet.<br/>Add groups to your workflow, then bookmark them.</div>

  <button class="mtb-add" @click="add">+ Add bookmark</button>
</div>
`;

export function mountPanel(container) {
    injectStyles();
    const state = reactive({ bookmarks: readBookmarks().map(clone), rev: 0 });
    const persist = () =>
        writeBookmarks(state.bookmarks.map((b) => ({ id: b.id, groupId: b.groupId, combo: b.combo })));

    const appVue = createApp({
        setup() {
            const capturingId = ref(null);
            const dragFrom = ref(-1);
            const dropAt = ref(-1);

            const groups = computed(() => { state.rev; return currentGroups(); });
            const isMissing = (b) => b.groupId != null && !groups.value.some((g) => g.id === b.groupId);

            const refresh = () => { state.rev++; };
            const add = () => {
                state.bookmarks.push({ id: uid(), groupId: groups.value[0]?.id ?? null, combo: suggestCombo(state.bookmarks) });
                persist();
            };
            const remove = (i) => { state.bookmarks.splice(i, 1); persist(); };
            const setGroup = (b, v) => { b.groupId = v === "" ? null : Number(v); persist(); };
            const onComboKey = (b, e) => {
                if (e.key === "Escape") { e.target.blur(); return; }
                const combo = comboFromEvent(e);       // null until a modifier is held
                if (combo) { b.combo = combo; persist(); e.target.blur(); }
            };
            const go = (b) => { if (!gotoBookmark(b)) state.rev++; };   // rev++ re-checks missing

            // reorder
            const rowClass = (i) => ({
                dragging: i === dragFrom.value,
                "drop-before": i === dropAt.value && dragFrom.value !== -1 && dragFrom.value !== i,
            });
            const onDragStart = (i) => { dragFrom.value = i; };
            const onDragOver = (e, i) => { e.dataTransfer.dropEffect = "move"; dropAt.value = i; };
            const onDrop = (i) => {
                const from = dragFrom.value;
                if (from !== -1 && from !== i) {
                    const [m] = state.bookmarks.splice(from, 1);
                    state.bookmarks.splice(i > from ? i - 1 : i, 0, m);
                    persist();
                }
                dragFrom.value = -1; dropAt.value = -1;
            };
            const onDragEnd = () => { dragFrom.value = -1; dropAt.value = -1; };

            return {
                state, groups, capturingId, comboDisplay,
                isMissing, refresh, add, remove, setGroup, onComboKey, go,
                rowClass, onDragStart, onDragOver, onDrop, onDragEnd,
            };
        },
        template: TEMPLATE,
    });

    appVue.mount(container);

    return {
        reload: () => {
            state.bookmarks.splice(0, state.bookmarks.length, ...readBookmarks().map(clone));
            state.rev++;
        },
        unmount: () => appVue.unmount(),
    };
}
