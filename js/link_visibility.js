import { app } from "../../scripts/app.js";

// Toggle graph link visibility with a hotkey. ComfyUI's `Comfy.LinkRenderMode`
// setting takes 0=Straight, 1=Linear, 2=Spline, 3=Hidden (it drives the canvas
// render mode for both the legacy and Nodes 2.0 renderers). We remember whatever
// visible style is active, flip to Hidden, and flip back — so links are there
// only when you want them.

const SETTING = "Comfy.LinkRenderMode";
const HIDDEN = 3;
let lastVisible = 2; // spline; overwritten with the active style each time we hide

function toggleLinks() {
    const setting = app.extensionManager.setting;
    const current = setting.get(SETTING);
    if (current === HIDDEN) {
        setting.set(SETTING, lastVisible);
    } else {
        lastVisible = current; // remember Straight/Linear/Spline, whatever it is
        setting.set(SETTING, HIDDEN);
    }
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
    keybindings: [{ commandId: "mottoes.links.toggle", combo: { key: "l", alt: true } }],
});
