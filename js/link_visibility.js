import { app } from "../../scripts/app.js";

// Toggle graph link visibility with a hotkey (Ctrl+Shift+L).
//
// We own the key ourselves — an event.code capture-phase listener — rather than
// a ComfyUI command/keybinding: ComfyUI matches by event.key (breaks on macOS,
// where Option+L is "¬") AND grabs any bound combo before an extension sees it.
// event.code ("KeyL") is layout/Option/Shift-proof, the same trick the bookmark
// combos use.
//
// Comfy.LinkRenderMode option values: Straight 0, Linear 1, Spline 2,
// Hidden -1 (LiteGraph.HIDDEN_LINK) — NOT 3. We remember the active visible
// style and flip to/from Hidden.

const SETTING = "Comfy.LinkRenderMode";
const VISIBLE_MODES = new Set([0, 1, 2]);
let lastVisible = 2; // spline

const COMBO = { code: "KeyL", ctrl: true, shift: true, alt: false, meta: false };

const hiddenValue = () =>
    typeof LiteGraph !== "undefined" && LiteGraph.HIDDEN_LINK != null ? LiteGraph.HIDDEN_LINK : -1;

function toggleLinks() {
    const setting = app.extensionManager.setting;
    const hidden = hiddenValue();
    const current = setting.get(SETTING);
    if (current === hidden) {
        setting.set(SETTING, VISIBLE_MODES.has(lastVisible) ? lastVisible : 2);
    } else {
        if (VISIBLE_MODES.has(current)) lastVisible = current;
        setting.set(SETTING, hidden);
    }
    app.canvas?.setDirty(true, true); // force the canvas to redraw with the new mode
    console.info(`[Mottoes] links ${setting.get(SETTING) === hidden ? "hidden" : "shown"}`);
}

function comboMatches(e) {
    return (
        e.code === COMBO.code &&
        e.ctrlKey === COMBO.ctrl &&
        e.shiftKey === COMBO.shift &&
        e.altKey === COMBO.alt &&
        e.metaKey === COMBO.meta
    );
}

function onKeydown(e) {
    const t = e.target;
    if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (comboMatches(e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleLinks();
    }
}

// Earlier builds registered a command; strip any ComfyUI keybinding saved for it
// so ComfyUI doesn't keep grabbing the combo before our listener.
function stripStaleBindings() {
    const setting = app.extensionManager.setting;
    const CMD = "mottoes.links.toggle";
    for (const id of ["Comfy.Keybinding.NewBindings", "Comfy.Keybinding.UnsetBindings"]) {
        try {
            const list = setting.get(id);
            if (Array.isArray(list) && list.some((b) => b?.commandId === CMD)) {
                setting.set(id, list.filter((b) => b?.commandId !== CMD));
            }
        } catch {
            /* ignore */
        }
    }
}

app.registerExtension({
    name: "Mottoes.LinkVisibility",
    setup() {
        stripStaleBindings();
        window.addEventListener("keydown", onKeydown, true); // capture phase
    },
});
