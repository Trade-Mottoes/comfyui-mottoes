import { app } from "../../scripts/app.js";

// Bookmarks — jump the canvas to a workflow group via a hotkey, managed from a
// sidebar panel. Frontend-only, no node: bookmarks live in graph.extra and bind
// to a group's stable id. See BOOKMARKS_SPEC.md.

import { readBookmarks, comboFromEvent, gotoBookmark } from "./bookmarks/model.js";
import { mountPanel } from "./bookmarks/panel.js";

const TAB_ID = "mottoes.bookmarks";
let panel = null;

// Combos a focused text field genuinely needs — we leave these for typing even
// when they're bookmarked. Mirrors ComfyUI's own keybinding rule: Shift-only
// combos (uppercase / selection) plus the standard editing set. Everything else
// (a bookmark's Alt/Ctrl+Shift combo) still fires while you type.
const RESERVED_EDITING = new Set([
    "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z", "ctrl+y", "ctrl+p",
    "ctrl+backspace", "ctrl+delete",
    "ctrl+home", "ctrl+end", "ctrl+left", "ctrl+right",
    "ctrl+shift+home", "ctrl+shift+end", "ctrl+shift+left", "ctrl+shift+right",
]);

function reservedByTextInput(combo) {
    const parts = combo.split("+");
    const mods = parts.slice(0, -1);
    if (mods.length > 0 && mods.every((m) => m === "shift")) return true; // Shift-only
    const normalized = parts.map((p) => (p === "meta" ? "ctrl" : p)).join("+"); // Cmd ≈ Ctrl
    return RESERVED_EDITING.has(normalized);
}

/** Per-bookmark hotkeys: one global listener. Fires even while typing, except
 *  for combos a text field needs (so Ctrl+A etc. still work in a prompt box). */
function onKeydown(e) {
    const combo = comboFromEvent(e);
    if (!combo) return;
    const t = e.target;
    if (t?.closest?.('input, textarea, [contenteditable="true"]') && reservedByTextInput(combo)) return;
    const bm = readBookmarks().find((b) => b.combo === combo);
    if (bm && gotoBookmark(bm)) {
        e.preventDefault();
        e.stopPropagation();
    }
}

app.registerExtension({
    name: "Mottoes.Bookmarks",

    // The one native command — everything else is managed in the panel. No default
    // hotkey on purpose: assign one in Settings -> Keybindings. Shipping a default
    // means colliding with whatever other pack claims the same combo, and ComfyUI
    // then throws on every load. See the note in link_visibility.js.
    commands: [
        {
            id: "mottoes.bookmarks.toggle",
            label: "Toggle Bookmarks panel",
            function: () => app.extensionManager.sidebarTab.toggleSidebarTab(TAB_ID),
        },
    ],

    async setup() {
        // Capture phase so a bookmark combo wins before ComfyUI's own handling.
        window.addEventListener("keydown", onKeydown, true);

        app.extensionManager.registerSidebarTab({
            id: TAB_ID,
            icon: "pi pi-bookmark",
            title: "Bookmarks",
            tooltip: "Jump to workflow groups",
            type: "custom",
            render: (el) => {
                // render() fires on activation; mount once, reload on re-show.
                if (el.__mottoesMounted) {
                    panel?.reload();
                    return;
                }
                el.__mottoesMounted = true;
                panel = mountPanel(el);
            },
        });
    },

    // Reload the panel's list when a different workflow is opened.
    afterConfigureGraph() {
        panel?.reload();
    },
});
