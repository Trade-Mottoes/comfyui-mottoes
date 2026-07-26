// Vue editor for the Group Muter / Group Bypasser nodes.
//
// A standalone Vue app (vendored full build — templates compile at runtime, no
// build step) mounted into the node's DOM widget. The rows are pushed in from
// the shared live-groups service (./service.js) via `setGroups`; the entry
// (../group_toggle.js) owns the node lifecycle and persists the settings.
//
// The graph is the single source of truth: a switch shows whether the group has
// any live node, and flipping it writes the modes back. Nothing about which
// group is on is stored on the node, so muting a group from anywhere else
// (Ctrl+M, the context menu, a second toggle node) shows up here within a tick.

import * as Vue from "../lib/vue.esm-browser.prod.js";
import { fitGroup } from "../common/canvas.js";
import { applyStates } from "./service.js";

const { createApp, reactive, ref, computed, watch, nextTick } = Vue;

export const DEFAULTS = {
    sort: "position",       // "position" | "alpha"
    filter: "",             // title match; /re/flags for a regular expression
    restriction: "none",    // "none" | "max-one" | "always-one"
    showNav: true,
};

function injectStyles() {
    if (document.getElementById("mottoes-groups-css")) return;
    const style = document.createElement("style");
    style.id = "mottoes-groups-css";
    // Themed via ComfyUI / PrimeVue CSS variables (literal fallbacks) so the editor
    // follows the active theme in both the classic and Nodes 2.0 renderers.
    style.textContent = `
        .mgt-editor { display:flex; flex-direction:column; gap:4px; padding:4px 2px;
            font-size:12px; box-sizing:border-box; color:var(--input-text,#ddd); }
        .mgt-editor button, .mgt-editor input, .mgt-editor select {
            background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
            border:1px solid var(--border-color,#444); border-radius:4px;
            padding:2px 6px; font-size:12px; height:24px; box-sizing:border-box; }
        .mgt-editor button { cursor:pointer; }
        .mgt-editor button:hover:not(:disabled) { border-color:var(--p-primary-color,#4a90d9); }
        .mgt-editor button:disabled { opacity:0.35; cursor:default; }
        .mgt-editor input:focus, .mgt-editor button:focus, .mgt-editor select:focus {
            outline:none; border-color:var(--p-primary-color,#4a90d9); }

        /* header — toggle-all, count, and the two panel buttons */
        .mgt-head { display:flex; align-items:center; gap:5px; padding:0 5px 2px; }
        .mgt-head .mgt-count { flex:1 1 0; font-weight:600; color:var(--descrip-text,#aaa);
            text-transform:uppercase; letter-spacing:0.03em; font-size:10px; }
        .mgt-icon { flex:0 0 22px; padding:0; height:18px; line-height:1; font-size:12px; }
        .mgt-icon.on { border-color:var(--p-primary-color,#4a90d9); color:var(--p-primary-color,#4a90d9); }

        .mgt-filter { width:100%; }

        /* settings panel */
        .mgt-settings { display:flex; flex-direction:column; gap:4px; padding:6px 5px;
            border:1px solid var(--border-color,#444); border-radius:6px;
            background:var(--comfy-menu-bg,#2a2a2a); }
        .mgt-set { display:flex; align-items:center; gap:6px; }
        .mgt-set > span { flex:1 1 0; color:var(--descrip-text,#aaa); }
        .mgt-set select { flex:0 0 130px; }
        .mgt-set input[type=checkbox] { flex:0 0 auto; width:14px; height:14px; padding:0;
            accent-color:var(--p-primary-color,#4a90d9); cursor:pointer; }

        /* rows */
        .mgt-rows { display:flex; flex-direction:column; gap:4px; }
        .mgt-row { display:flex; align-items:center; gap:5px; border:1px solid var(--border-color,#444);
            border-radius:6px; background:var(--comfy-menu-bg,#2a2a2a); padding:3px 5px 3px 0; overflow:hidden; }
        .mgt-row.off { opacity:0.55; }
        .mgt-swatch { flex:0 0 4px; align-self:stretch; margin-right:3px;
            background:var(--border-color,#444); }
        /* the title is a click target but should read as a label, not a control —
           the .mgt-editor prefix is what lets it beat the base button rule */
        .mgt-editor .mgt-name { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis;
            white-space:nowrap; text-align:left; border:1px solid transparent; background:none;
            padding:0 2px; }
        .mgt-editor .mgt-name:hover:not(:disabled) { color:var(--p-primary-color,#4a90d9); }
        .mgt-tag { flex:0 0 auto; color:var(--descrip-text,#888); font-size:10px; font-style:italic; }
        .mgt-nav { flex:0 0 22px; padding:0; line-height:1; }

        /* toggle switch — the .mgt-editor prefix lets height/radius beat the base button rule */
        .mgt-editor .mgt-tog { flex:0 0 34px; height:16px; border-radius:8px; position:relative; padding:0;
            background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#555); cursor:pointer; }
        .mgt-tog::after { content:''; position:absolute; top:1px; left:1px; width:12px; height:12px;
            border-radius:50%; background:var(--descrip-text,#999); transition:transform .12s, background .12s; }
        .mgt-tog.on { background:var(--p-primary-color,#4a90d9); border-color:var(--p-primary-color,#4a90d9); }
        .mgt-tog.on::after { transform:translateX(18px); background:#fff; }
        .mgt-tog.mixed::after { transform:translateX(9px); background:#e0a44a; }

        .mgt-empty { padding:8px; text-align:center; color:var(--descrip-text,#888); font-size:11px;
            border:1px dashed var(--border-color,#444); border-radius:6px; line-height:1.5; }
    `;
    document.head.appendChild(style);
}

const TEMPLATE = `
<div class="mgt-editor">
  <div class="mgt-head">
    <button class="mgt-tog" :class="allClass" @click="toggleAll" :disabled="!actionable.length"
            :title="allState === true ? offVerbCap + ' all' : 'Enable all'"></button>
    <span class="mgt-count">{{ onCount }} / {{ actionable.length }} on</span>
    <button class="mgt-icon" :class="{on: ui.filtering}" @click="toggleFilter"
            title="Filter groups by title">⌕</button>
    <button class="mgt-icon" :class="{on: ui.settings}" @click="ui.settings = !ui.settings"
            title="Settings">⚙</button>
  </div>

  <input v-if="ui.filtering" ref="filterInput" class="mgt-filter" :value="settings.filter"
         @input="set('filter', $event.target.value)" @keydown.escape="clearFilter"
         placeholder="Filter by title — /regex/ works too" />

  <div v-if="ui.settings" class="mgt-settings">
    <label class="mgt-set">
      <span>Order</span>
      <select :value="settings.sort" @change="set('sort', $event.target.value)">
        <option value="position">Canvas position</option>
        <option value="alpha">Title A → Z</option>
      </select>
    </label>
    <label class="mgt-set">
      <span>Allow on</span>
      <select :value="settings.restriction" @change="set('restriction', $event.target.value)"
              title="Restrict how many groups can be on at once">
        <option value="none">Any number</option>
        <option value="max-one">At most one</option>
        <option value="always-one">Exactly one</option>
      </select>
    </label>
    <label class="mgt-set">
      <span>Jump buttons</span>
      <input type="checkbox" :checked="settings.showNav" @change="set('showNav', $event.target.checked)" />
    </label>
  </div>

  <div class="mgt-rows">
    <div v-for="g in visible" :key="g.id" class="mgt-row" :class="{off: !g.on}">
      <span class="mgt-swatch" :style="g.color ? {background: g.color} : null"></span>
      <button class="mgt-tog" :class="{on: g.on}" @click="toggle(g)" :disabled="!g.total"
              :title="g.total ? (g.on ? offVerbCap + ' this group' : 'Enable this group') : 'Group is empty'"></button>
      <button class="mgt-name" @click="toggle(g)" :disabled="!g.total"
              :title="g.title + ' — ' + g.total + ' node' + (g.total === 1 ? '' : 's')">{{ g.title }}</button>
      <span v-if="!g.total" class="mgt-tag">empty</span>
      <button v-if="settings.showNav" class="mgt-nav" @click.stop="nav(g)"
              title="Jump the canvas to this group">➜</button>
    </div>
  </div>

  <div v-if="!model.groups.length" class="mgt-empty">
    No groups here yet.<br/>Select some nodes and press Ctrl+G to make one.
  </div>
  <div v-else-if="!visible.length" class="mgt-empty">No groups match the filter.</div>
</div>
`;

/** Build a title matcher from the filter box: `/re/flags` is a regex, anything
 *  else a case-insensitive substring. A malformed regex matches nothing rather
 *  than throwing mid-render. */
function matcher(filter) {
    const text = (filter ?? "").trim();
    if (!text) return null;
    const re = /^\/(.*)\/([a-z]*)$/.exec(text);
    if (re) {
        try {
            const rx = new RegExp(re[1], re[2].includes("i") ? re[2] : re[2] + "i");
            return (title) => rx.test(title);
        } catch {
            return () => false;
        }
    }
    const needle = text.toLowerCase();
    return (title) => title.toLowerCase().includes(needle);
}

/**
 * Mount the editor into `container`. `modeOff` is the mode a group is switched
 * off into (mute or bypass); `settings` seeds the persisted per-node settings and
 * `onSettings(plain)` fires whenever they change. `onLayout()` runs after any
 * change that alters the node's height. Returns `setGroups` to push in a fresh
 * snapshot from the service, and `setSettings` to re-seed after a graph load.
 */
export function mountEditor({ container, modeOff, offVerb = "mute", settings: initial, onSettings, onLayout }) {
    injectStyles();
    const model = reactive({ groups: [] });
    const settings = reactive({ ...DEFAULTS, ...(initial ?? {}) });
    // Which panels are open. Not persisted — except that a saved filter reopens
    // its box, so a node never comes back with a hidden filter silently applied.
    const ui = reactive({ filtering: !!settings.filter, settings: false });

    const appVue = createApp({
        setup() {
            const filterInput = ref(null);
            const offVerbCap = offVerb.charAt(0).toUpperCase() + offVerb.slice(1);

            // ---- derived ----
            const visible = computed(() => {
                const match = matcher(settings.filter);
                const rows = match ? model.groups.filter((g) => match(g.title)) : [...model.groups];
                if (settings.sort === "alpha") {
                    rows.sort((a, b) => a.title.localeCompare(b.title));
                } else {
                    // Reading order: top to bottom, then left to right. Snapped to a
                    // 30px grid so groups roughly side by side count as one row.
                    rows.sort((a, b) => {
                        const ay = Math.floor(a.pos[1] / 30);
                        const by = Math.floor(b.pos[1] / 30);
                        return ay === by ? Math.floor(a.pos[0] / 30) - Math.floor(b.pos[0] / 30) : ay - by;
                    });
                }
                return rows;
            });
            // Empty groups have nothing to switch, so they never count towards the
            // header state or take part in a toggle-all.
            const actionable = computed(() => visible.value.filter((g) => g.total));
            const onCount = computed(() => actionable.value.filter((g) => g.on).length);
            const allState = computed(() => {
                const rows = actionable.value;
                if (!rows.length) return false;
                if (rows.every((g) => g.on)) return true;
                if (rows.every((g) => !g.on)) return false;
                return null; // mixed
            });
            const allClass = computed(() =>
                allState.value === true ? "on" : allState.value === null ? "mixed" : "",
            );

            // ---- settings ----
            const set = (key, value) => {
                settings[key] = value;
                onSettings?.({ ...settings });
            };
            const toggleFilter = () => {
                ui.filtering = !ui.filtering;
                if (ui.filtering) nextTick(() => filterInput.value?.focus());
                else if (settings.filter) set("filter", ""); // hiding the box drops the filter
            };
            const clearFilter = () => {
                if (settings.filter) set("filter", "");
                else ui.filtering = false;
            };

            // ---- switching ----
            // The restriction ("at most one" / "exactly one") is applied over the
            // *visible* groups: the filter defines the set you are switching between.
            const toggle = (row) => {
                if (!row.total) return;
                const on = !row.on;
                const others = actionable.value.filter((g) => g !== row);
                if (!on && settings.restriction === "always-one" && !others.some((g) => g.on)) {
                    return; // the last one on stays on
                }
                const entries = [];
                if (on && settings.restriction !== "none") {
                    for (const g of others) if (g.on) entries.push({ group: g.group, on: false });
                }
                entries.push({ group: row.group, on });
                applyStates(entries, modeOff);
            };
            const toggleAll = () => {
                const rows = actionable.value;
                if (!rows.length) return;
                const to = !rows.some((g) => g.on);
                // Under a restriction "all on" means the first one on — and with
                // "exactly one", "all off" leaves the first on rather than none.
                const onlyFirst =
                    (to && settings.restriction !== "none") ||
                    (!to && settings.restriction === "always-one");
                applyStates(
                    rows.map((g, i) => ({ group: g.group, on: onlyFirst ? i === 0 : to })),
                    modeOff,
                );
            };
            const nav = (row) => fitGroup(row.group);

            // Anything that adds or removes a line re-measures the node.
            watch(
                () => [visible.value.length, ui.filtering, ui.settings].join(":"),
                () => nextTick(() => onLayout?.()),
            );

            return {
                model, settings, ui, visible, actionable, onCount, allState, allClass,
                filterInput, offVerbCap,
                set, toggleFilter, clearFilter, toggle, toggleAll, nav,
            };
        },
        template: TEMPLATE,
    });

    appVue.mount(container);

    return {
        model,
        setGroups: (rows) => { model.groups = rows; },
        setSettings: (next) => {
            Object.assign(settings, DEFAULTS, next ?? {});
            ui.filtering = !!settings.filter;
        },
        unmount: () => appVue.unmount(),
    };
}
