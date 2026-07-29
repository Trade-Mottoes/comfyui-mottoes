import { app } from "../../scripts/app.js";

// Toggle graph link visibility. A plain ComfyUI command, runnable from the
// command palette — deliberately with NO default hotkey: assign one yourself in
// Settings -> Keybindings.
//
// Why no default: two extensions declaring the same *default* combo makes ComfyUI
// throw "Keybinding on <combo> already exists on <other command>" on every load,
// and ours is the one dropped. We shipped Ctrl+Shift+L and collided with KJNodes'
// ToggleForceShowSetGetLinks; any combo we pick can be claimed the same way by
// whatever pack a user installs next. Note the error is not fixable from the UI —
// the frontend's addDefaultKeybinding checks the *defaults* map, which the
// set/unset bindings written by Settings never touch.
//
// When picking a combo: ComfyUI matches keybindings by character, so Option/Alt
// combos are unreliable on macOS (Option+L emits "¬") — prefer Ctrl/Cmd/Shift.
// A combo already owned by another extension can be taken in Settings, which
// prompts to overwrite; that path is a user keybinding, so it collides with nothing.
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
});
