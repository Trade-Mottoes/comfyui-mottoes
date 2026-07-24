import { app } from "../../scripts/app.js";

// Bookmarks — jump the canvas to a workflow group via a hotkey, managed from a
// sidebar panel. Frontend-only, no node: bookmarks live in graph.extra and bind
// to a group's stable id. See BOOKMARKS_SPEC.md.

import { readBookmarks, comboFromEvent, gotoBookmark } from "./bookmarks/model.js";
import { mountPanel } from "./bookmarks/panel.js";

const TAB_ID = "mottoes.bookmarks";
let panel = null;

/** Per-bookmark hotkeys: one global listener, ignored while typing. */
function onKeydown(e) {
    const t = e.target;
    if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const bm = readBookmarks().find((b) => b.combo === combo);
    if (bm && gotoBookmark(bm)) {
        e.preventDefault();
        e.stopPropagation();
    }
}

app.registerExtension({
    name: "Mottoes.Bookmarks",

    // The one native, remappable hotkey — everything else is managed in the panel.
    commands: [
        {
            id: "mottoes.bookmarks.toggle",
            label: "Toggle Bookmarks panel",
            function: () => app.extensionManager.sidebarTab.toggleSidebarTab(TAB_ID),
        },
    ],
    keybindings: [{ commandId: "mottoes.bookmarks.toggle", combo: { key: "b", alt: true } }],

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
