import { app } from "../../scripts/app.js";

// Toggle graph link visibility. A normal ComfyUI command with a default hotkey
// (Ctrl+Shift+L) — so it's remappable in Settings -> Keybindings and runnable
// from the command palette. ComfyUI's native keybinding fires this fine on macOS
// for Ctrl+Shift+L (verified). Note: ComfyUI matches keybindings by character,
// so Option/Alt-based combos are unreliable on macOS (Option+L emits "¬") —
// prefer Ctrl/Cmd/Shift combos when rebinding.
//
// Comfy.LinkRenderMode option values: Straight 0, Linear 1, Spline 2,
// Hidden -1 (LiteGraph.HIDDEN_LINK) — NOT 3, which was the real bug.

const SETTING = "Comfy.LinkRenderMode";
const VISIBLE_MODES = new Set([0, 1, 2]);
let lastVisible = 2; // spline

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
}

app.registerExtension({
    name: "Mottoes.LinkVisibility",
    commands: [
        {
            id: "mottoes.links.toggle",
            label: "Toggle link visibility (hide / show)",
            function: toggleLinks,
        },
    ],
    keybindings: [{ commandId: "mottoes.links.toggle", combo: { key: "L", ctrl: true, shift: true } }],
});
