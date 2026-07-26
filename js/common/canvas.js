import { app } from "../../../scripts/app.js";

// Canvas/viewport helpers shared by more than one feature (bookmarks, the group
// toggle nodes). Everything here reaches into `app.canvas`, so keeping it in one
// place means only one module has to track LiteGraph's viewport conventions.

// Only ever zoom OUT to frame a group — never magnify past 1:1, so jumping to a
// small group centres it at a readable size instead of blowing it up.
const MAX_FIT_SCALE = 1;

/** Fit `group` into the canvas viewport (scaled to fit, centered) with padding. */
export function fitGroup(group, pad = 60) {
    const canvas = app.canvas;
    const ds = canvas?.ds;
    if (!group || !ds) return;
    const b = group._bounding ?? [group.pos?.[0] ?? 0, group.pos?.[1] ?? 0, group.size?.[0] ?? 200, group.size?.[1] ?? 120];
    const [gx, gy, gw, gh] = [b[0], b[1], b[2], b[3]];
    const rect = canvas.canvas.getBoundingClientRect();
    // Fall back to sane defaults if the canvas isn't laid out (hidden tab etc.)
    // so we never divide by ~0 and jump to a degenerate scale.
    const vw = rect.width || 1200;
    const vh = rect.height || 800;
    const raw = Math.min(vw / (gw + pad * 2), vh / (gh + pad * 2));
    const scale = Math.max(ds.min_scale ?? 0.1, Math.min(raw, MAX_FIT_SCALE));
    ds.scale = scale;
    ds.offset[0] = vw / 2 / scale - (gx + gw / 2);
    ds.offset[1] = vh / 2 / scale - (gy + gh / 2);
    canvas.setDirty(true, true);
}
