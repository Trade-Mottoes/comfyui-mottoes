import { app } from "../../scripts/app.js";

// Toggle graph link visibility with a hotkey.
//
// IMPORTANT: this does NOT register a ComfyUI command/keybinding. ComfyUI's own
// key handler (a) matches by event.key — the character — which breaks on macOS
// (Option+L emits "¬", Shift upper-cases), and (b) GRABS a bound combo before an
// extension listener sees it. So any shortcut you set for this in Settings →
// Keybindings actively sabotages it. We own the key ourselves, keyed on
// event.code (the physical key), exactly like the bookmark combos that work.
//
// Comfy.LinkRenderMode: 0=Straight 1=Linear 2=Spline 3=Hidden. We remember the
// active visible style, flip to Hidden, and flip back.

const SETTING = "Comfy.LinkRenderMode";
const HIDDEN = 3;
let lastVisible = 2; // spline; overwritten with the active style each time we hide

// Physical-key combo. Change here to rebind. `code` is layout/Option/Shift-proof.
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

// Earlier builds registered a command; if any ComfyUI keybinding was saved for it,
// ComfyUI will keep grabbing that combo. Strip those stored bindings so the key
// reaches us cleanly. (Safe no-op once there are none.)
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
        console.info("[Mottoes] Link visibility ready — Ctrl+Shift+L toggles graph links");
    },
});
