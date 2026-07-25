// Node "view" surface for the Prompt Builder.
//
// The node itself is now a compact, read-only summary bound to the shared
// reactive model — no editing happens here, so it sidesteps every node-surface
// constraint (renderer differences, sizing, orphaned textareas). All editing
// lives in the full-screen dialog (js/prompt/editor.js), opened from here.

import * as Vue from "../lib/vue.esm-browser.prod.js";

const { createApp, computed } = Vue;

function injectStyles() {
    if (document.getElementById("mottoes-pb-nodeview-css")) return;
    const style = document.createElement("style");
    style.id = "mottoes-pb-nodeview-css";
    style.textContent = `
        .pb-nv { display:flex; flex-direction:column; gap:6px; padding:4px 2px;
            font-size:12px; box-sizing:border-box; color:var(--input-text,#ddd); }
        .pb-nv .pb-nv-open { width:100%; height:30px; cursor:pointer; font-weight:600;
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:5px; }
        .pb-nv .pb-nv-open:hover { border-color:var(--p-primary-color,#4a90d9); color:var(--p-primary-color,#4a90d9); }
        .pb-nv-summary { display:flex; flex-wrap:wrap; gap:6px; font-size:11px;
            color:var(--descrip-text,#aaa); padding:0 2px; }
        .pb-nv-summary .pb-nv-choice { color:#e0729e; }
        .pb-nv-out { background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#444);
            border-radius:5px; padding:6px 8px; max-height:96px; overflow:hidden; white-space:pre-wrap;
            word-break:break-word; color:var(--input-text,#ddd); font-size:11.5px; line-height:1.45; }
        .pb-nv-out.empty { color:var(--descrip-text,#888); font-style:italic; }
        .pb-nv-locked { color:var(--p-primary-color,#4a90d9); }
    `;
    document.head.appendChild(style);
}

const TEMPLATE = `
<div class="pb-nv">
  <button class="pb-nv-open" @click="openEditor" title="Open the full Prompt Builder editor (double-click the node too)">✎ Open editor</button>
  <div class="pb-nv-summary">
    <span>{{ model.sections.length }} section{{ model.sections.length===1 ? '' : 's' }}</span>
    <span>· {{ enabledCount }} on</span>
    <span v-if="model.choices.length" class="pb-nv-choice">· {{ model.choices.length }} choice{{ model.choices.length===1 ? '' : 's' }}</span>
    <span :class="{'pb-nv-locked': model.settings.mode==='locked'}">· {{ model.settings.mode==='locked' ? '🔒 locked' : '🎲 reroll' }}</span>
  </div>
  <div class="pb-nv-out" :class="{empty: !lastOutput}" :title="lastOutput || ''">{{ lastOutput || 'Not built yet — open the editor and hit Build.' }}</div>
</div>
`;

/** Mount the compact node view into `container`, bound to the shared `model`.
 *  `openEditor` opens the full editor dialog. */
export function mountNodeView({ container, model, openEditor }) {
    injectStyles();
    const app = createApp({
        setup() {
            const enabledCount = computed(() => model.sections.filter((s) => s.enabled).length);
            const lastOutput = computed(() => (model.cache && model.cache.output) || "");
            return { model, openEditor, enabledCount, lastOutput };
        },
        template: TEMPLATE,
    });
    app.mount(container);
    return { app, unmount: () => app.unmount() };
}
