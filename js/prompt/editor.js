// Vue editor for the Prompt Builder node.
//
// A standalone Vue app (vendored full build — templates compile at runtime, no
// build step) mounted into the node's DOM widget. The reactive model IS the
// serialized node state (sections + settings + pins + cache + history); the
// entry (../prompt_builder.js) owns the DOM widget, the seed bridge, and the
// build-route call, and passes them in. Resolution happens in Python — the
// frontend only tokenizes for highlighting and renders the resolved record.

import * as Vue from "../lib/vue.esm-browser.prod.js";
import { makeSection, makeChoice, makeOption } from "./serialize.js";
import { tokenize, highlightHtml, tokenContextAt, splitTopLevel, parseOption, buildTokenString } from "./tokens.js";

const { createApp, reactive, ref, nextTick } = Vue;

const GROW_CAP = 340;
const OPT_GROW_CAP = 150;   // option rows in the token dialog stay compact

/** Size a textarea to its content, up to a cap (then it scrolls). */
function autoGrow(el, cap = GROW_CAP) {
    if (!el) return;
    el.style.height = "auto";
    const full = el.scrollHeight;
    el.style.height = Math.min(full, cap) + "px";
    el.style.overflowY = full > cap ? "auto" : "hidden";
}

/** Keep the highlight backdrop scrolled in step with its textarea. */
function syncScroll(ev) {
    const bd = ev.target.parentElement?.querySelector(".pb-backdrop");
    if (bd) {
        bd.scrollTop = ev.target.scrollTop;
        bd.scrollLeft = ev.target.scrollLeft;
    }
}

/** Where an Alt+Enter split actually cuts. The caret snaps LEFT to the start of
 *  the token or word it sits inside, so a {…}/[…] token or a mid-word is never
 *  bisected — the whole unit falls into the new second section. A caret already
 *  at a whitespace or token boundary cuts exactly there. */
function snapSplit(content, caret) {
    const p = Math.max(0, Math.min(caret | 0, content.length));
    for (const seg of tokenize(content)) {
        if (p <= seg.start || p >= seg.end) continue;   // not strictly inside this segment
        if (seg.type !== "text") return seg.start;       // inside a token → cut before it
        if (/\s/.test(content[p - 1]) || /\s/.test(content[p])) return p;  // at a word edge already
        let q = p;
        while (q > seg.start && !/\s/.test(content[q - 1])) q--;
        return q;                                         // inside a word → cut before the word
    }
    return p;
}

/** Re-key a `${sectionId}|${raw}|${occ}` map (pins or counters) across a split at
 *  `cut`. Tokens left of the cut keep their key (occurrence order is preserved);
 *  tokens at/after it move to `newId`, renumbered from zero. Keys belonging to
 *  other sections pass through untouched. `cut` is always on a token boundary, so
 *  nothing is split mid-token. */
function rekeyMap(map, origId, newId, cut, content) {
    if (!map || typeof map !== "object") return map || {};
    const out = {};
    const counts = {}, after = {};
    for (const seg of tokenize(content)) {
        if (seg.type === "text") continue;
        const occ = counts[seg.text] ?? 0; counts[seg.text] = occ + 1;
        const oldKey = `${origId}|${seg.text}|${occ}`;
        if (!(oldKey in map)) continue;
        if (seg.start < cut) {
            out[oldKey] = map[oldKey];
        } else {
            const n = after[seg.text] ?? 0; after[seg.text] = n + 1;
            out[`${newId}|${seg.text}|${n}`] = map[oldKey];
        }
    }
    for (const k in map) if (!k.startsWith(origId + "|")) out[k] = map[k];
    return out;
}

function injectStyles() {
    if (document.getElementById("imgsaver-prompt-css")) return;
    const style = document.createElement("style");
    style.id = "imgsaver-prompt-css";
    style.textContent = `
        .pb-editor { display:flex; flex-direction:column; gap:5px; padding:4px 2px;
            font-size:12px; box-sizing:border-box; color:var(--input-text,#ddd); }
        .pb-editor button, .pb-editor select, .pb-editor input {
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:4px;
            padding:2px 6px; font-size:12px; height:24px; box-sizing:border-box; }
        .pb-editor button { cursor:pointer; }
        .pb-editor button:hover:not(:disabled) { border-color:var(--p-primary-color,#4a90d9); }
        .pb-editor button:disabled { opacity:0.5; cursor:default; }
        .pb-editor input:focus, .pb-editor select:focus, .pb-editor textarea:focus { outline:none; border-color:var(--p-primary-color,#4a90d9); }

        .pb-toolbar { display:flex; gap:4px; align-items:center; }
        .pb-toolbar .pb-mode { flex:0 0 auto; font-weight:600; }
        .pb-toolbar .pb-mode.locked { border-color:var(--p-primary-color,#4a90d9); color:var(--p-primary-color,#4a90d9); }
        .pb-toolbar > button:not(.pb-mode):not(.pb-icon) { flex:1 1 0; }
        .pb-toolbar .pb-icon { flex:0 0 30px; padding:0; }
        .pb-toolbar .pb-joiner { flex:0 0 84px; }
        .pb-add button { width:100%; }

        .pb-hint { font-size:11px; color:var(--descrip-text,#888); padding:1px 2px; }
        .pb-error { font-size:11px; color:var(--error-text,#c0504d); padding:1px 2px; }

        .pb-sections { display:flex; flex-direction:column; gap:5px; }
        .pb-section { border:1px solid var(--border-color,#444); border-radius:6px;
            background:var(--comfy-menu-bg,#2a2a2a); padding:4px; display:flex; flex-direction:column; gap:4px; }
        .pb-section.disabled { opacity:0.5; }
        .pb-section.dragging { opacity:0.4; }
        .pb-section.drop-before { box-shadow:inset 0 3px 0 var(--p-primary-color,#4a90d9); }
        .pb-shead { display:flex; align-items:center; gap:5px; }
        .pb-handle { cursor:grab; color:var(--descrip-text,#888); user-select:none; line-height:22px; }
        .pb-chev { cursor:pointer; width:14px; text-align:center; color:var(--descrip-text,#888); user-select:none; }
        .pb-en { flex:0 0 auto; width:14px; height:14px; padding:0; }
        .pb-title { flex:1 1 0; min-width:0; font-weight:600; }
        .pb-remove { flex:0 0 26px; }
        .pb-remove:hover { border-color:var(--error-text,#c0504d); color:var(--error-text,#c0504d); }

        .pb-ta-wrap { position:relative; border:1px solid var(--border-color,#444);
            border-radius:4px; background:var(--comfy-input-bg,#222); }
        .pb-backdrop, .pb-ta { margin:0; border:0; padding:6px 8px; box-sizing:border-box; width:100%;
            font-family:'Segoe UI',system-ui,-apple-system,sans-serif; font-size:12px; line-height:1.5;
            letter-spacing:normal; tab-size:4; white-space:pre-wrap; overflow-wrap:break-word; word-break:break-word; }
        .pb-backdrop { position:absolute; inset:0; color:var(--input-text,#ddd); pointer-events:none; overflow:hidden; }
        .pb-ta { position:relative; display:block; min-height:46px; background:transparent; color:transparent;
            caret-color:var(--input-text,#ddd); resize:none; overflow-y:hidden; }
        .pb-ta::placeholder { color:var(--descrip-text,#777); }

        .pb-editor .tok-choice   { color:#e0a44a; }
        .pb-editor .tok-array    { color:#4aa3e0; }
        .pb-editor .tok-wildcard { color:#b57edc; }
        .pb-editor .tok-error    { color:var(--error-text,#c0504d); text-decoration:underline wavy; }
        /* pinned to a value — deliberately a hue none of the three types use */
        .pb-editor .tok-pinned   { color:#5ec9a0; background:rgba(94,201,160,0.15); border-radius:3px; }

        .pb-history { display:flex; flex-direction:column; gap:2px; max-height:150px; overflow-y:auto;
            border:1px solid var(--border-color,#444); border-radius:4px; padding:2px; }
        .pb-hitem { display:flex; gap:6px; align-items:baseline; padding:3px 5px; cursor:pointer; border-radius:3px; }
        .pb-hitem:hover { background:var(--comfy-input-bg,#222); }
        .pb-hout { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .pb-hseed { flex:0 0 auto; color:var(--descrip-text,#888); font-size:11px; }

        .pb-preview { border:1px solid var(--border-color,#444); border-radius:6px; padding:5px;
            display:flex; flex-direction:column; gap:5px; background:var(--comfy-menu-bg,#2a2a2a); }
        .pb-phead { display:flex; align-items:center; gap:6px; font-weight:600; font-size:11px;
            text-transform:uppercase; letter-spacing:0.03em; color:var(--descrip-text,#aaa); }
        .pb-phead .pb-grow { flex:1 1 0; }
        .pb-phead .pb-icon { height:22px; flex:0 0 26px; padding:0; }
        .pb-phead .pb-seed { text-transform:none; letter-spacing:normal; font-weight:400; }
        .pb-out { background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#444);
            border-radius:4px; padding:6px 8px; white-space:pre-wrap; word-break:break-word;
            cursor:copy; min-height:20px; }
        .pb-warn { font-size:11px; color:#e0a44a; }
        .pb-rolls { display:flex; flex-direction:column; gap:2px; font-size:11px; }
        .pb-roll { display:flex; gap:5px; align-items:baseline; }
        .pb-roll .pb-arrow { color:var(--descrip-text,#888); }
        .pb-roll .pb-chosen { color:var(--input-text,#ddd); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .pb-empty { padding:6px; text-align:center; color:var(--descrip-text,#888); font-size:11px; }

        /* an untitled section falls back to a preview of its content */
        .pb-editor .pb-title::placeholder { color:var(--descrip-text,#9aa0a6); opacity:1; font-style:italic; }

        /* token list editor (teleported to body, so it needs its own styling) */
        .pb-overlay { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.45);
            display:flex; align-items:flex-start; justify-content:center; }
        .pb-dialog { margin-top:9vh; width:min(720px,94vw); background:var(--comfy-menu-bg,#2a2a2a);
            border:1px solid var(--border-color,#444); border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,0.5);
            color:var(--input-text,#ddd); font-size:12px; overflow:hidden; display:flex; flex-direction:column; }
        .pb-dhead { display:flex; align-items:baseline; gap:8px; padding:9px 12px; font-weight:600;
            border-bottom:1px solid var(--border-color,#444); }
        .pb-dhead .pb-dsub { font-weight:400; font-size:11px; color:var(--descrip-text,#888); }
        .pb-dhead .pb-dtype { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:4px; padding:3px 6px;
            font-size:12px; font-weight:600; height:27px; cursor:pointer; }
        .pb-dhead .pb-dtype:hover { border-color:var(--p-primary-color,#4a90d9); }
        .pb-orows { display:flex; flex-direction:column; gap:4px; padding:8px 10px; max-height:64vh; overflow-y:auto; }
        /* top-aligned: a wrapped multi-line value keeps its controls on the first line */
        .pb-orow { display:flex; align-items:flex-start; gap:5px; border-radius:4px; }
        .pb-orow.dragging { opacity:0.4; }
        .pb-orow.drop-before { box-shadow:inset 0 2px 0 var(--p-primary-color,#4a90d9); }
        .pb-orow input, .pb-orow textarea { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:4px; padding:4px 7px;
            box-sizing:border-box; font-size:12px; font-family:'Segoe UI',system-ui,-apple-system,sans-serif; }
        .pb-orow input { height:28px; }
        /* values wrap and grow, so long options stay readable instead of clipping */
        .pb-orow .pb-oval { flex:1 1 0; min-width:0; min-height:28px; line-height:1.5; resize:none;
            overflow-y:hidden; white-space:pre-wrap; overflow-wrap:break-word; word-break:break-word; }
        .pb-orow .pb-owt { flex:0 0 54px; text-align:center; }
        .pb-orow .pb-ohandle { flex:0 0 13px; cursor:grab; user-select:none; text-align:center;
            color:var(--descrip-text,#888); line-height:28px; }
        .pb-orow .pb-pin { flex:0 0 17px; cursor:pointer; opacity:0.3; filter:grayscale(1);
            user-select:none; text-align:center; line-height:28px; }
        .pb-orow .pb-pin.on { opacity:1; filter:none; }
        .pb-orow .pb-orm { flex:0 0 28px; height:28px; cursor:pointer; border-radius:4px;
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd); border:1px solid var(--border-color,#444); }
        .pb-orow .pb-orm:hover { border-color:var(--error-text,#c0504d); color:var(--error-text,#c0504d); }
        .pb-dfoot { display:flex; align-items:center; gap:8px; padding:8px 10px;
            border-top:1px solid var(--border-color,#444); }
        .pb-dfoot button { height:26px; padding:3px 10px; cursor:pointer; border-radius:4px;
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd); border:1px solid var(--border-color,#444); }
        .pb-dfoot button:hover { border-color:var(--p-primary-color,#4a90d9); }
        .pb-dfoot .pb-pinnote { font-size:11px; color:var(--descrip-text,#aaa); }
        .pb-dfoot .pb-grow { flex:1 1 0; }

        .pb-shead .pb-split { flex:0 0 26px; padding:0; }
        .pb-shead .pb-split:hover { border-color:var(--p-primary-color,#4a90d9); }

        /* pin chips — which value each pinned token is locked to (green to match the token tint) */
        .pb-pins { display:flex; flex-wrap:wrap; gap:4px; padding:1px 2px 0; }
        .pb-pinchip { display:inline-flex; align-items:center; gap:3px; max-width:100%; cursor:pointer;
            font-size:11px; line-height:1.4; padding:1px 3px 1px 5px; border-radius:10px;
            color:var(--input-text,#ddd); background:rgba(94,201,160,0.14); border:1px solid rgba(94,201,160,0.45); }
        .pb-pinchip:hover { border-color:#5ec9a0; }
        .pb-pinchip .pb-pinval { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px; }
        .pb-pinchip .pb-pinx { flex:0 0 auto; height:16px; padding:0 2px; border:0; border-radius:3px;
            background:transparent; color:var(--descrip-text,#888); font-size:11px; line-height:1; cursor:pointer; }
        .pb-pinchip .pb-pinx:hover { color:var(--error-text,#c0504d); }

        /* choice variable %name% — a hue distinct from the three token types + pinned */
        .pb-editor .tok-var { color:#e0729e; }

        /* knobs strip: the choice variables, picked inline */
        .pb-knobs { display:flex; flex-wrap:wrap; align-items:center; gap:5px; padding:1px 2px; }
        .pb-knob { display:inline-flex; align-items:center; gap:3px; max-width:100%;
            border:1px solid var(--border-color,#444); border-radius:6px; padding:1px 3px 1px 6px;
            background:var(--comfy-menu-bg,#2a2a2a); }
        .pb-knob .pb-kname { color:#e0729e; font-weight:600; cursor:pointer; white-space:nowrap; }
        .pb-knob .pb-kname:hover { text-decoration:underline; }
        .pb-knob .pb-ksel { height:22px; max-width:160px; }
        .pb-knob .pb-kedit, .pb-knob .pb-krm { height:22px; flex:0 0 auto; padding:0 5px; }
        .pb-knob .pb-krm:hover { border-color:var(--error-text,#c0504d); color:var(--error-text,#c0504d); }
        .pb-knobs .pb-kadd { height:22px; }

        /* choice editor dialog (shares .pb-dialog / .pb-orow with the token editor) */
        .pb-dhead .pb-cname { width:130px; height:27px; font-weight:600; color:#e0729e;
            background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#444);
            border-radius:4px; padding:3px 6px; }
        .pb-dhead .pb-cname:focus { border-color:var(--p-primary-color,#4a90d9); }
        .pb-orow .pb-csel { flex:0 0 15px; margin-top:7px; cursor:pointer; }
        .pb-orow .pb-clabel { flex:0 0 150px; height:28px; }
    `;
    document.head.appendChild(style);
}

const TEMPLATE = `
<div class="pb-editor" ref="rootEl">
  <div class="pb-toolbar">
    <button class="pb-mode" :class="{locked: model.settings.mode==='locked'}" @click="toggleMode"
            :title="model.settings.mode==='locked' ? 'Locked: runs reuse the last Build' : 'Reroll: wildcards re-roll from the seed each run'">
      {{ model.settings.mode==='locked' ? '🔒 Locked' : '🎲 Reroll' }}
    </button>
    <button @click="doBuild" :disabled="busy" title="Resolve now, cache it, and log to history">Build</button>
    <button @click="doPreview" :disabled="busy" title="Resolve at the current seed — no changes">Preview</button>
    <button class="pb-icon" @click="reseed" :disabled="busy" title="New random seed + preview">🎲</button>
    <button @click="historyOpen=!historyOpen" :disabled="!model.history.length"
            :title="model.history.length + ' builds'">History</button>
    <select class="pb-joiner" :value="model.settings.joiner" @change="setJoiner($event.target.value)" title="How sections join">
      <option value=", ">comma</option>
      <option value="\\n">newline</option>
      <option value=" BREAK ">BREAK</option>
    </select>
  </div>

  <div v-if="model.settings.mode==='locked'" class="pb-hint">Locked — runs reuse the last Build. Hit Build to refresh.</div>
  <div v-if="error" class="pb-error">{{ error }}</div>

  <div v-if="historyOpen" class="pb-history">
    <div v-for="(h,hi) in model.history" :key="hi" class="pb-hitem" @click="restore(h)" :title="'Restore — ' + h.output">
      <span class="pb-hout">{{ h.output || '(empty)' }}</span>
      <span class="pb-hseed">#{{ h.seed }}</span>
    </div>
    <div v-if="!model.history.length" class="pb-empty">No builds yet</div>
  </div>

  <div class="pb-knobs">
    <div v-for="c in model.choices" :key="c.id" class="pb-knob">
      <span class="pb-kname" @click="openChoiceEditor(c)" :title="'Edit choice — reference it as %'+(c.name||'name')+'% in a section'">%{{ c.name || '…' }}%</span>
      <select class="pb-ksel" :value="c.selected" @change="selectOption(c,$event.target.value)" :title="'Injected: ' + selOptValue(c)">
        <option v-for="o in c.options" :key="o.id" :value="o.id">{{ o.label || o.value || '(empty)' }}</option>
      </select>
      <button class="pb-kedit" @click="openChoiceEditor(c)" title="Edit this choice's options">✎</button>
      <button class="pb-krm" @click="removeChoice(c)" title="Remove choice">✕</button>
    </div>
    <button class="pb-kadd" @click="addChoice" title="Add a choice variable (a labelled pick-list, referenced as %name%)">+ Choice</button>
  </div>

  <div class="pb-sections">
    <div v-for="(s,i) in model.sections" :key="s.id" class="pb-section" :class="sectionClass(s,i)"
         @dragover.prevent="onDragOver($event,i)" @drop.prevent="onDrop(i)">
      <div class="pb-shead">
        <span class="pb-handle" draggable="true" @dragstart="onDragStart(i)" @dragend="onDragEnd" title="Drag to reorder">⠿</span>
        <input type="checkbox" class="pb-en" :checked="s.enabled" @change="toggleEnabled(s)" title="Enable / disable" />
        <span class="pb-chev" @click="toggleCollapsed(s)" :title="s.collapsed ? 'Expand' : 'Collapse to title'">{{ s.collapsed ? '▸' : '▾' }}</span>
        <input class="pb-title" :value="s.title" @input="setTitle(s,$event.target.value)" :placeholder="titlePlaceholder(s)" />
        <button v-if="!s.collapsed" class="pb-split" @click="splitAtCaret(s)" title="Split at the cursor (Alt+Enter)">✂</button>
        <button class="pb-remove" @click="removeSection(i)" title="Remove section">✕</button>
      </div>
      <div v-if="!s.collapsed" class="pb-ta-wrap">
        <div class="pb-backdrop" v-html="highlight(s)"></div>
        <textarea class="pb-ta" v-pbgrow :value="s.content" @input="setContent(s,$event)" @scroll="onScroll"
                  @keydown="onTaKeydown(s,$event)" @keyup="trackCaret(s,$event)" @click="trackCaret(s,$event)" @select="trackCaret(s,$event)"
                  @dblclick="onTaDblClick(s,$event)" title="Double-click a {…}/[…] token to edit its options · Alt+Enter splits the section here" spellcheck="false" placeholder="prompt — {a|b|c} choice · [a|b|c] array · __wildcard__"></textarea>
      </div>
      <div v-if="!s.collapsed && sectionPins(s).length" class="pb-pins">
        <span v-for="p in sectionPins(s)" :key="p.key" class="pb-pinchip" @click="openPinEditor(s,p)" :title="p.raw + '  →  ' + p.value">
          📌<span class="pb-pinval">{{ p.value }}</span>
          <button class="pb-pinx" @click.stop="unpin(p.key)" title="Unpin — let it re-roll">✕</button>
        </span>
      </div>
    </div>
  </div>

  <div class="pb-toolbar pb-add"><button @click="addSection">+ Add section</button></div>

  <teleport to="body">
    <div v-if="popup.open" class="pb-overlay" @click.self="closeTokenEditor(true)">
      <div class="pb-dialog">
        <div class="pb-dhead">
          <select class="pb-dtype" :value="popup.type" @change="setPopupType($event.target.value)"
                  title="Switch this token between weighted-random and sequential">
            <option value="choice">Choice  {…}</option>
            <option value="array">Array  […]</option>
          </select>
          <span class="pb-dsub">{{ popup.type==='choice' ? 'weighted random — one is picked' : 'sequential — advances by index' }}</span>
        </div>
        <div class="pb-orows">
          <div v-for="(o,oi) in popup.options" :key="oi" class="pb-orow" :class="optRowClass(oi)"
               @dragover.prevent="onOptDragOver($event,oi)" @drop.prevent="onOptDrop(oi)">
            <span class="pb-ohandle" draggable="true" @dragstart="onOptDragStart(oi)" @dragend="onOptDragEnd"
                  :title="popup.type==='array' ? 'Drag to reorder — this order is the sequence' : 'Drag to reorder'">⠿</span>
            <span class="pb-pin" :class="{on: popup.pinned===o.value}" @click="togglePin(o)"
                  :title="popup.pinned===o.value ? 'Pinned (manual) — click to let it re-roll' : 'Pin this value (manual re-roll)'">📌</span>
            <textarea class="pb-oval" v-pbgrowopt rows="1" :value="o.value"
                      @input="o.value=$event.target.value" placeholder="value"></textarea>
            <input v-if="popup.type==='choice'" class="pb-owt" :value="o.weight"
                   @input="o.weight=$event.target.value" placeholder="1" title="Relative weight (0 never wins)" />
            <button class="pb-orm" @click="popup.options.splice(oi,1)" title="Remove option">✕</button>
          </div>
          <div v-if="!popup.options.length" class="pb-empty">No options</div>
        </div>
        <div class="pb-dfoot">
          <button @click="addOption">+ Option</button>
          <span v-if="popup.pinned!=null" class="pb-pinnote">📌 pinned “{{ popup.pinned }}”</span>
          <span class="pb-grow"></span>
          <button @click="closeTokenEditor(true)">Done</button>
        </div>
      </div>
    </div>
  </teleport>

  <teleport to="body">
    <div v-if="choiceDlg.open" class="pb-overlay" @click.self="closeChoiceEditor(true)">
      <div class="pb-dialog">
        <div class="pb-dhead">
          <span>Choice</span>
          <input class="pb-cname" :value="choiceDlg.name" @input="choiceDlg.name = sanitizeName($event.target.value)"
                 placeholder="name" title="Letters, digits, underscore — referenced as %name%" />
          <span class="pb-dsub">%{{ choiceDlg.name || 'name' }}% — the menu shows each label; the prompt gets its value</span>
        </div>
        <div class="pb-orows">
          <div v-for="(o,oi) in choiceDlg.options" :key="o.id" class="pb-orow" :class="cOptRowClass(oi)"
               @dragover.prevent="onCOptDragOver($event,oi)" @drop.prevent="onCOptDrop(oi)">
            <span class="pb-ohandle" draggable="true" @dragstart="onCOptDragStart(oi)" @dragend="onCOptDragEnd" title="Drag to reorder">⠿</span>
            <input type="radio" class="pb-csel" :checked="choiceDlg.selected===o.id" @change="choiceDlg.selected=o.id"
                   title="Select this value (what the prompt uses)" />
            <input class="pb-clabel" :value="o.label" @input="o.label=$event.target.value" placeholder="label (menu)" />
            <textarea class="pb-oval" v-pbgrowopt rows="1" :value="o.value" @input="o.value=$event.target.value" placeholder="value (injected into the prompt)"></textarea>
            <button class="pb-orm" @click="removeChoiceOption(oi)" title="Remove option">✕</button>
          </div>
          <div v-if="!choiceDlg.options.length" class="pb-empty">No options — add one below</div>
        </div>
        <div class="pb-dfoot">
          <button @click="addChoiceOption">+ Option</button>
          <span class="pb-grow"></span>
          <button @click="closeChoiceEditor(true)">Done</button>
        </div>
      </div>
    </div>
  </teleport>

  <div v-if="previewOpen && preview" class="pb-preview">
    <div class="pb-phead">
      <span>Resolved</span>
      <span class="pb-seed">seed #{{ preview.seed }}</span>
      <span class="pb-grow"></span>
      <button class="pb-icon" @click="copyOut" title="Copy prompt">⧉</button>
      <button class="pb-icon" @click="previewOpen=false" title="Hide">✕</button>
    </div>
    <div class="pb-out" @click="copyOut">{{ preview.output || '(empty)' }}</div>
    <div v-if="preview.warnings && preview.warnings.length" class="pb-warn">⚠ {{ preview.warnings.join(' · ') }}</div>
    <div v-if="preview.rolls && preview.rolls.length" class="pb-rolls">
      <div v-for="(r,ri) in preview.rolls" :key="ri" class="pb-roll">
        <span class="tok" :class="['tok-'+r.type, {'tok-pinned': r.source==='pin'}]">{{ r.raw }}</span>
        <span class="pb-arrow">{{ r.source==='pin' ? '📌' : '→' }}</span>
        <span class="pb-chosen">{{ r.chosen }}</span>
      </div>
    </div>
  </div>
</div>
`;

/**
 * Mount the editor into `container`. Callbacks bridge to the node:
 *   getSeed()/setSeed(v) read & write the node's seed widget;
 *   build(state, seed) resolves via the Python route and returns a BuildRecord;
 *   onChange() re-measures the node after any mutation.
 * Returns the reactive model plus setState (replaces it in place, so the entry's
 * reference stays live for serialization).
 */
export function mountEditor({ container, initialState, getSeed, setSeed, build, onChange }) {
    injectStyles();
    const changed = () => onChange?.();
    const model = reactive(initialState);

    const app = createApp({
        setup() {
            const rootEl = ref(null);
            const busy = ref(false);
            const error = ref("");
            const preview = ref(null);
            const previewOpen = ref(false);
            const historyOpen = ref(false);
            const dragFrom = ref(-1);
            const dropAt = ref(-1);

            // NB: wrap the call — a bare .forEach(autoGrow) would pass the array
            // index as `cap` and collapse every textarea.
            const growAll = () => nextTick(() => rootEl.value?.querySelectorAll("textarea.pb-ta").forEach((el) => autoGrow(el)));

            // defined choice names, so %name% refs tint live (undefined → error)
            const choiceNameSet = () => new Set((model.choices || []).map((c) => c.name).filter(Boolean));
            // pins + choice names read here, so the backdrop re-tints the moment either changes
            const highlight = (s) => highlightHtml(s.content, s.id, model.pins, choiceNameSet());

            // ---- section mutations ----
            const setTitle = (s, v) => { s.title = v; changed(); };
            const setContent = (s, ev) => { s.content = ev.target.value; autoGrow(ev.target); changed(); };
            const toggleEnabled = (s) => { s.enabled = !s.enabled; changed(); };
            const toggleCollapsed = (s) => { s.collapsed = !s.collapsed; changed(); growAll(); };
            const removeSection = (i) => { model.sections.splice(i, 1); changed(); };
            const addSection = () => { model.sections.push(makeSection()); changed(); growAll(); };

            // ---- settings ----
            const setMode = (m) => { model.settings.mode = m; changed(); };
            const toggleMode = () => setMode(model.settings.mode === "locked" ? "reroll" : "locked");
            const setJoiner = (v) => { model.settings.joiner = v; changed(); };

            // ---- drag reorder ----
            const sectionClass = (s, i) => ({
                disabled: !s.enabled,
                dragging: i === dragFrom.value,
                "drop-before": i === dropAt.value && dragFrom.value !== -1 && dragFrom.value !== i,
            });
            const onDragStart = (i) => { dragFrom.value = i; };
            const onDragOver = (ev, i) => { ev.dataTransfer.dropEffect = "move"; dropAt.value = i; };
            const onDrop = (i) => {
                const from = dragFrom.value;
                if (from !== -1 && from !== i) {
                    const [moved] = model.sections.splice(from, 1);
                    model.sections.splice(i > from ? i - 1 : i, 0, moved);
                    changed();
                }
                dragFrom.value = -1; dropAt.value = -1;
            };
            const onDragEnd = () => { dragFrom.value = -1; dropAt.value = -1; };

            // ---- build / preview ----
            const run = async (commit) => {
                busy.value = true; error.value = "";
                try {
                    const seed = getSeed?.() ?? 0;
                    const record = await build(model, seed);
                    preview.value = record; previewOpen.value = true;
                    if (commit) {
                        const snapshot = {
                            sections: model.sections.map((s) => ({ ...s })),
                            pins: { ...model.pins }, counters: { ...model.counters },
                            choices: model.choices.map((c) => ({ ...c, options: c.options.map((o) => ({ ...o })) })),
                            settings: { ...model.settings }, seed,
                        };
                        model.cache = record;
                        model.history = [{ ...record, snapshot }, ...model.history].slice(0, 25);
                    }
                    changed();
                } catch (e) {
                    error.value = String(e?.message ?? e);
                } finally {
                    busy.value = false;
                }
            };
            const doPreview = () => run(false);
            const doBuild = () => run(true);
            const reseed = () => {
                setSeed?.(Math.floor(Math.random() * 0x100000000));
                run(false);
            };

            const restore = (h) => {
                const s = h.snapshot;
                if (!s) return;
                model.sections.splice(0, model.sections.length, ...s.sections.map((x) => makeSection(x)));
                model.pins = { ...s.pins }; model.counters = { ...s.counters }; model.settings = { ...s.settings };
                if (s.choices) model.choices = s.choices.map((c) => makeChoice(c));
                setSeed?.(s.seed);
                model.cache = { output: h.output, seed: h.seed, mode: h.mode, builtAt: h.builtAt, sections: h.sections, rolls: h.rolls, warnings: h.warnings };
                preview.value = h; previewOpen.value = true; historyOpen.value = false;
                changed(); growAll();
            };

            const copyOut = () => {
                try { navigator.clipboard?.writeText(preview.value?.output ?? ""); } catch { /* ignore */ }
            };

            // ---- an untitled section shows a preview of its content instead ----
            // (matters most collapsed, where the title is all you see)
            const titlePlaceholder = (s) => {
                const c = (s.content || "").replace(/\s+/g, " ").trim();
                if (!c) return "Section title";
                return c.length > 42 ? c.slice(0, 42).trimEnd() + "…" : c;
            };

            // ---- token list editor: double-click a {…}/[…] token ----
            const popup = reactive({
                open: false, sectionId: null, start: 0, end: 0,
                type: null, raw: "", key: "", options: [], pinned: null,
            });
            // Re-measure once the dialog has its final width: a mount-time
            // scrollHeight taken before layout settles wraps long and clamps
            // every row to the cap.
            const remeasureOptions = () => nextTick(() => requestAnimationFrame(() => {
                document.querySelectorAll(".pb-dialog .pb-oval").forEach((el) => autoGrow(el, OPT_GROW_CAP));
            }));
            const openTokenEditor = (s, offset) => {
                const ctx = tokenContextAt(s.content || "", offset);
                if (!ctx || (ctx.seg.type !== "choice" && ctx.seg.type !== "array")) return;
                popup.sectionId = s.id;
                popup.start = ctx.seg.start;
                popup.end = ctx.seg.end;
                popup.type = ctx.seg.type;
                popup.raw = ctx.seg.text;
                popup.key = `${s.id}|${ctx.seg.text}|${ctx.occ}`;
                popup.options = splitTopLevel(ctx.seg.text.slice(1, -1)).map((o) => parseOption(o, ctx.seg.type));
                popup.pinned = model.pins[popup.key] ?? null;
                popup.open = true;
                remeasureOptions();
            };
            /** Switch the token between weighted-random {…} and sequential […].
             *  The weight column appears/disappears, so the values reflow. */
            const setPopupType = (v) => { popup.type = v; remeasureOptions(); };
            const onTaDblClick = (s, ev) => openTokenEditor(s, ev.target.selectionStart ?? 0);
            const addOption = () => popup.options.push({ value: "", weight: "" });

            // Option reorder. Matters semantically for arrays, where the order
            // *is* the sequence; for choices it is presentation only.
            const optDragFrom = ref(-1);
            const optDropAt = ref(-1);
            const optRowClass = (i) => ({
                dragging: i === optDragFrom.value,
                "drop-before": i === optDropAt.value && optDragFrom.value !== -1 && optDragFrom.value !== i,
            });
            const onOptDragStart = (i) => { optDragFrom.value = i; };
            const onOptDragOver = (ev, i) => { ev.dataTransfer.dropEffect = "move"; optDropAt.value = i; };
            const onOptDrop = (i) => {
                const from = optDragFrom.value;
                if (from !== -1 && from !== i) {
                    const [moved] = popup.options.splice(from, 1);
                    popup.options.splice(i > from ? i - 1 : i, 0, moved);
                }
                optDragFrom.value = -1; optDropAt.value = -1;
            };
            const onOptDragEnd = () => { optDragFrom.value = -1; optDropAt.value = -1; };
            const togglePin = (o) => { popup.pinned = popup.pinned === o.value ? null : o.value; };
            const closeTokenEditor = (commit) => {
                if (commit) {
                    const sec = model.sections.find((s) => s.id === popup.sectionId);
                    if (sec) {
                        const rebuilt = buildTokenString(popup.type, popup.options);
                        sec.content = sec.content.slice(0, popup.start) + rebuilt + sec.content.slice(popup.end);
                        // Re-key the pin against the (possibly rewritten) token, and drop it
                        // if the pinned value no longer exists — same self-healing as Python.
                        const pins = { ...model.pins };
                        delete pins[popup.key];
                        const ctx = tokenContextAt(sec.content, popup.start);
                        if (ctx && popup.pinned != null && popup.options.some((o) => o.value === popup.pinned)) {
                            pins[`${sec.id}|${ctx.seg.text}|${ctx.occ}`] = popup.pinned;
                        }
                        model.pins = pins;
                        changed();
                        growAll();
                    }
                }
                popup.open = false;
            };

            // ---- pin chips: surface which value each pinned token is stuck on ----
            const sectionPins = (s) => {
                const pins = model.pins || {};
                const counts = {};
                const out = [];
                for (const seg of tokenize(s.content || "")) {
                    if (seg.type === "text") continue;
                    const occ = counts[seg.text] ?? 0; counts[seg.text] = occ + 1;
                    const key = `${s.id}|${seg.text}|${occ}`;
                    if (pins[key] !== undefined)
                        out.push({ key, raw: seg.text, type: seg.type, value: pins[key], start: seg.start });
                }
                return out;
            };
            const unpin = (key) => { const p = { ...model.pins }; delete p[key]; model.pins = p; changed(); };
            // wildcard pins have no list dialog — clicking the chip opens the editor only for {…}/[…]
            const openPinEditor = (s, pin) => { if (pin.type !== "wildcard") openTokenEditor(s, pin.start + 1); };

            // ---- split a section in two at the caret (Alt+Enter / the ✂ header button) ----
            const carets = {};   // last caret offset per section id; transient, never serialized
            const trackCaret = (s, ev) => { carets[s.id] = ev.target.selectionStart ?? 0; };
            const splitSection = (s, caret) => {
                const idx = model.sections.findIndex((x) => x.id === s.id);
                if (idx === -1) return;
                const content = s.content || "";
                const cut = snapSplit(content, caret);
                const ns = makeSection({ enabled: s.enabled, content: content.slice(cut) });
                s.content = content.slice(0, cut);
                // carry pins/counters on tokens that crossed into the new section
                model.pins = rekeyMap(model.pins, s.id, ns.id, cut, content);
                model.counters = rekeyMap(model.counters, s.id, ns.id, cut, content);
                model.sections.splice(idx + 1, 0, ns);
                changed();
                growAll();
                // land the caret at the top of the new section so you can keep typing
                nextTick(() => {
                    const el = rootEl.value?.querySelectorAll("textarea.pb-ta")?.[idx + 1];
                    if (el) { el.focus(); el.setSelectionRange(0, 0); }
                });
            };
            const splitAtCaret = (s) => splitSection(s, carets[s.id] ?? (s.content || "").length);
            const onTaKeydown = (s, ev) => {
                if (ev.key === "Enter" && ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
                    ev.preventDefault(); ev.stopPropagation();
                    splitSection(s, ev.target.selectionStart ?? (s.content || "").length);
                }
            };

            // ---- choice variables (%name%): the knobs strip + its editor dialog ----
            const selOptValue = (c) => {
                const o = (c.options || []).find((x) => x.id === c.selected) || c.options?.[0];
                return o ? (o.value || "(empty)") : "(no options)";
            };
            const uniqueChoiceName = () => {
                const used = new Set((model.choices || []).map((c) => c.name));
                let n = 1, name;
                do { name = `choice${n++}`; } while (used.has(name));
                return name;
            };
            const selectOption = (c, optId) => { c.selected = optId; changed(); };
            const removeChoice = (c) => {
                const i = model.choices.findIndex((x) => x.id === c.id);
                if (i >= 0) { model.choices.splice(i, 1); changed(); }
            };

            const choiceDlg = reactive({ open: false, id: null, name: "", options: [], selected: null });
            const sanitizeName = (v) => (v || "").replace(/[^A-Za-z0-9_]/g, "");
            const openChoiceEditor = (c) => {
                choiceDlg.id = c.id;
                choiceDlg.name = c.name;
                choiceDlg.options = (c.options || []).map((o) => ({ ...o }));   // edit copies; commit on Done
                choiceDlg.selected = c.selected ?? choiceDlg.options[0]?.id ?? null;
                choiceDlg.open = true;
                remeasureOptions();
            };
            const addChoiceOption = () => {
                const o = makeOption();
                choiceDlg.options.push(o);
                if (choiceDlg.selected == null) choiceDlg.selected = o.id;
                remeasureOptions();
            };
            const removeChoiceOption = (i) => {
                const [rm] = choiceDlg.options.splice(i, 1);
                if (rm && choiceDlg.selected === rm.id) choiceDlg.selected = choiceDlg.options[0]?.id ?? null;
            };
            const closeChoiceEditor = (commit) => {
                if (commit) {
                    const c = model.choices.find((x) => x.id === choiceDlg.id);
                    if (c) {
                        // name: non-empty and unique among the other choices
                        let nm = choiceDlg.name || c.name || uniqueChoiceName();
                        const others = new Set(model.choices.filter((x) => x.id !== c.id).map((x) => x.name));
                        if (others.has(nm)) { let k = 2; while (others.has(nm + k)) k++; nm = nm + k; }
                        c.name = nm;
                        c.options = choiceDlg.options.map((o) => makeOption(o));
                        c.selected = c.options.some((o) => o.id === choiceDlg.selected) ? choiceDlg.selected : (c.options[0]?.id ?? null);
                        changed(); growAll();
                    }
                }
                choiceDlg.open = false;
            };
            const addChoice = () => {
                const c = makeChoice({ name: uniqueChoiceName() });
                model.choices.push(c);
                changed(); growAll();
                openChoiceEditor(c);   // jump straight into filling it in
            };

            // choice-option reorder (own drag state, separate from sections + token dialog)
            const cOptDragFrom = ref(-1);
            const cOptDropAt = ref(-1);
            const cOptRowClass = (i) => ({
                dragging: i === cOptDragFrom.value,
                "drop-before": i === cOptDropAt.value && cOptDragFrom.value !== -1 && cOptDragFrom.value !== i,
            });
            const onCOptDragStart = (i) => { cOptDragFrom.value = i; };
            const onCOptDragOver = (ev, i) => { ev.dataTransfer.dropEffect = "move"; cOptDropAt.value = i; };
            const onCOptDrop = (i) => {
                const from = cOptDragFrom.value;
                if (from !== -1 && from !== i) {
                    const [moved] = choiceDlg.options.splice(from, 1);
                    choiceDlg.options.splice(i > from ? i - 1 : i, 0, moved);
                }
                cOptDragFrom.value = -1; cOptDropAt.value = -1;
            };
            const onCOptDragEnd = () => { cOptDragFrom.value = -1; cOptDropAt.value = -1; };

            return {
                model, rootEl, busy, error, preview, previewOpen, historyOpen,
                highlight, onScroll: syncScroll, setPopupType,
                setTitle, setContent, toggleEnabled, toggleCollapsed, removeSection, addSection,
                toggleMode, setJoiner,
                sectionClass, onDragStart, onDragOver, onDrop, onDragEnd,
                doPreview, doBuild, reseed, restore, copyOut,
                popup, titlePlaceholder, onTaDblClick, addOption, togglePin, closeTokenEditor,
                optRowClass, onOptDragStart, onOptDragOver, onOptDrop, onOptDragEnd,
                sectionPins, unpin, openPinEditor, trackCaret, onTaKeydown, splitAtCaret,
                addChoice, removeChoice, selectOption, selOptValue, openChoiceEditor,
                choiceDlg, sanitizeName, addChoiceOption, removeChoiceOption, closeChoiceEditor,
                cOptRowClass, onCOptDragStart, onCOptDragOver, onCOptDrop, onCOptDragEnd,
            };
        },
        template: TEMPLATE,
    });

    app.directive("pbgrow", { mounted: (el) => autoGrow(el), updated: (el) => autoGrow(el) });
    app.directive("pbgrowopt", { mounted: (el) => autoGrow(el, OPT_GROW_CAP), updated: (el) => autoGrow(el, OPT_GROW_CAP) });
    app.mount(container);

    const setState = (s) => {
        model.settings = s.settings;
        model.sections.splice(0, model.sections.length, ...s.sections);
        model.pins = s.pins; model.counters = s.counters;
        model.choices = s.choices || [];
        model.cache = s.cache; model.history = s.history;
        nextTick(() => container.querySelectorAll("textarea.pb-ta").forEach((el) => autoGrow(el)));
    };

    return { app, model, setState, unmount: () => app.unmount() };
}
