import { app } from "../../scripts/app.js";

// Toggle graph link visibility with a hotkey. ComfyUI's Comfy.LinkRenderMode
// takes 0=Straight, 1=Linear, 2=Spline, 3=Hidden and drives the canvas render
// mode in both renderers. We remember the active visible style, flip to Hidden,
// and flip back — so links are there only when you want them.
//
// The hotkey is handled by our OWN keydown listener keyed on `event.code` (the
// physical key), NOT ComfyUI's built-in keybinding. ComfyUI matches by
// `event.key` (the character), which breaks on macOS — Option+L emits "¬", so
// an Alt+L binding never matches — and is Shift-case sensitive. `event.code`
// ("KeyL") is immune to all of that. Change COMBO to rebind.

const SETTING = "Comfy.LinkRenderMode";
const HIDDEN = 3;
let lastVisible = 2; // spline; overwritten with the active style each time we hide

const COMBO = { code: "KeyL", ctrl: true, shift: true, alt: false, meta: false };

function toggleLinks() {
    const setting = app.extensionManager.setting;
    const current = setting.get(SETTING);
    if (current === HIDDEN) {
        setting.set(SETTING, lastVisible);
    } else {
        lastVisible = current; // remember Straight/Linear/Spline, whatever is on
        setting.set(SETTING, HIDDEN);
    }
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

app.registerExtension({
    name: "Mottoes.LinkVisibility",
    // Command is kept so it's runnable from the palette; the key is ours, above.
    commands: [
        {
            id: "mottoes.links.toggle",
            label: "Toggle link visibility (hide / show)",
            function: toggleLinks,
        },
    ],
    setup() {
        // Capture phase so we win before ComfyUI's own key handling.
        window.addEventListener("keydown", onKeydown, true);
    },
});
