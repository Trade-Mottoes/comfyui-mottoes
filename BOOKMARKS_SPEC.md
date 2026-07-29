# Bookmarks — Design Spec

**Status:** draft v1 · **Target:** frontend-only extension in ComfyUI-Mottoes · no node, no Python.

## 1. Why

Jump the canvas to a named region of a workflow with a keypress, and manage all
those jumps in one place. rgthree does this with a **virtual node** you drop at a
corner and a single-char shortcut — we're deliberately moving away from that
canvas-control style. This is a **sidebar panel + hotkeys**, targets a **group**
(a region, not a point), and binds by the group's **id** so it survives renames.

Renderer-agnostic (sidebar + a keydown listener + `ds` math) — works identically
on legacy and Nodes 2.0, so it sidesteps the whole legacy question: **no node,
no DOM widget, no compromise.**

## 2. Verified platform facts (this is what the design rests on)

- **Groups have a stable `id`** that serializes with the workflow
  (`serialize().groups[i]` = `{ id, title, bounding, color, flags }`). Binding by
  id is rename-proof. ✅
- **`graph.extra` serializes** with the workflow → per-workflow bookmark storage,
  no node required. ✅
- **`registerSidebarTab({ id, icon, title, type:'custom', render })`** — `render(el)`
  is called on **tab activation**, once; mount the Vue app there (guard re-mount).
- **Commands/keybindings are static** — a runtime `registerExtension` did not land
  (`runtimeCommandLanded:false`), but an extension file loaded at startup registers
  fine. So the per-bookmark combos use a **manual keydown listener**; ComfyUI's
  native command+hotkey is used only for the one static "Toggle Bookmarks" action.
- **Centering:** no `fitView`; `centerOnNode` is node-only. Group bounds are
  `group._bounding = [x,y,w,h]`; fit via `canvas.ds` (`scale` + `offset`).

## 3. Data model (per-workflow, in `graph.extra`)

```json
graph.extra.mottoesBookmarks = [
  { "id": "<uid>", "groupId": 3, "combo": "alt+1" }
]
```

- `groupId` — the LiteGraph group id (rename-proof; unresolved id ⇒ shown "missing").
- `combo` — canonical `"[ctrl+][alt+][shift+][meta+]<key>"`, key from `event.code`
  (`KeyK`→`k`, `Digit1`→`1`) so it's layout-stable. **A modifier is required.**
- `id` — a local uid for stable list keys.

## 4. UX — the "Bookmarks" sidebar panel (Vue)

Rows, each: **drag handle** · **target group** (`<select>` of live groups, value =
id, shows current title, or "⚠ missing" if the id is gone) · **combo** (click →
capture: press a modifier+key) · **▶ go** (jump now) · **✕ remove**.

- **+ Add bookmark** — appends a row (first group, next free `Alt+N`).
- **↻ refresh** — re-read groups (they change as you edit the workflow).
- Empty state: "No bookmarks yet. Add groups to your workflow, then bookmark them."
- Reloads its list on workflow load (`afterConfigureGraph`) and on refresh.

## 5. Keys

- **Per-bookmark:** one global `window` keydown listener. Ignore it while typing
  (target is `input`/`textarea`/`[contenteditable]`). Require a modifier. On a
  canonical-combo match → fit that bookmark's group. `preventDefault`.
- **Toggle panel:** a single static native command `mottoes.bookmarks.toggle` →
  `sidebarTab.toggleSidebarTab("mottoes.bookmarks")`. This is the "global key for
  the manager". Ships with **no default combo** — assign one in ComfyUI's own
  hotkey settings. Declaring a default risks colliding with another extension's,
  which makes ComfyUI throw on every load and drops ours.

## 6. Centering — fit-to-group

Scale so the group fits the canvas viewport with padding, centered:

```
scale  = clamp(min(vw/(gw+2p), vh/(gh+2p)), ds.min_scale, ds.max_scale)
offset = [ vw/2/scale - (gx+gw/2), vh/2/scale - (gy+gh/2) ]
ds.setDirtyCanvas(true,true)
```

Exact transform confirmed live during build (viewport in CSS px via the canvas
`getBoundingClientRect`).

## 7. Files (frontend-only; reuse the vendored Vue, no build step)

- `js/bookmarks.js` — entry: `registerExtension` (sidebar tab, static toggle
  command, keydown listener, `afterConfigureGraph` reload).
- `js/bookmarks/model.js` — pure helpers: read/write `graph.extra`, live groups,
  combo canonicalize/display, `fitGroup`.
- `js/bookmarks/panel.js` — the Vue panel mounted into the sidebar tab.

## 8. Non-goals (v1) / later

- Groups inside **subgraphs** (v1 = root graph only).
- Per-bookmark **zoom** override; **fit vs top-left** modes.
- Importing rgthree Bookmark nodes.
- Combo **collision warnings** against ComfyUI's own hotkeys (we require a
  modifier, which avoids most).
