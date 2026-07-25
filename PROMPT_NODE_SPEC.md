# ComfyUI Prompt Builder — Design Spec

**Status:** Phase 1 shipped · Choice Blocks (single / multi / random) landed · **Target:** Vue-standalone node in **ComfyUI-Mottoes** (repo renamed from ComfyUI-Image-Saver; this spec predates the rename, so ignore stale "Image Saver" mentions below).

## 1. Why

ComfyUI prompt entry is a single dumb textarea. Every "prompt" node (including Pixaroma's — nicer-looking, same limitations) is a prettier textarea. Real prompt work is compositional and iterative: you toggle ideas on/off, keep variants, roll dice on style/subject, and want the *exact* prompt that produced a good image back later. Marinara-Engine's world-info / preset system already solved this for chat — composable enable/disable/reorder sections + a **seeded, lockable wildcard engine** + curated "choice" variables. This node ports that flexibility to image prompts, in the repo's existing Vue-standalone style (the Resolver editor).

**Guiding principle: usability first.** The win is the interaction, not the feature count.

## 2. The node

- **Name:** `Prompt Builder (Mottoes)` — class `PromptBuilder`, category `Mottoes`.
- **Output:** `STRING` (the built prompt). Second `STRING` for a negative role: Phase 3.
- **Widgets/inputs:**
  - `seed` INT + `control_after_generate` — the reroll lever (native ComfyUI idiom).
  - `state` — a multiline `STRING` widget, **replaced by the Vue DOM widget** (`serialize:true`), holding the whole node model as JSON. Identical round-trip to the Resolver's `bindings`.
- `RETURN_TYPES = ("STRING",)`, `FUNCTION = "build"`.
- Unlike the Resolver (a pure declaration, no outputs), this node **emits a value**, so it resolves at run time.

## 3. Core model — three independent levers

The heart of the UX. Keep them distinct — most existing nodes conflate them and confuse everyone.

1. **Seed (per-run variation).** Wildcards resolve as a pure function of `(template, seed)`. `control_after_generate = randomize` → fresh roll each queue; `fixed` → same roll. "Build on run" with variety, using ComfyUI's own seed widget.
2. **Per-token pin (auto vs manual re-roll).** Any single wildcard can be *pinned* to a chosen value — a sparse override in node state. Pinned → ignores the seed (manual); unpinned → rolls from seed (auto). Click a token → pick/lock a value or clear it. Global 🎲 clears pins / bumps seed. *(User's "auto or manual re-role", built as Marinara's computed-result + sparse-override pattern.)*
3. **Prompt lock (freeze whole output).** "Locked" mode caches the entire built string; every run emits the cache verbatim, ignoring the seed. The **Build** button re-resolves, refreshes the cache, and pushes a history record. *(User's "lock the prompt, use last cached, hit Build to rebuild.")*

They compose: unlocked+randomize = variety each run; unlocked+fixed = stable; locked = frozen until Build.

## 4. Sections

Prompt = ordered list of **sections**, each an independent block.

`Section { id, title, enabled, collapsed, content }` (role: Phase 3).

- **Add / remove / disable / reorder (drag) / collapse-to-title** — all in-editor. Disabled sections skipped at build; collapsed shows only the title bar.
- **Build** joins enabled sections' resolved text with a configurable joiner (default `", "`; newline optional). Empty results dropped.
- Reorder reuses the Resolver's hand-rolled HTML5 drag (no library).
- Groups / nesting + XML/Markdown wrap: **Phase 3, off by default** — image prompts are comma tag-soup, not chat; probably never needed.

## 5. Wildcard grammar

Three token types, resolved at build:

| Syntax | Meaning | Resolution |
|---|---|---|
| `{a\|b\|c}` | weighted random choice, pick one | `seededRandom(seed:salt)`; weights `{3::red\|2::blue\|green}` |
| `[a\|b\|c]` | array, sequential | index-based: run mode → `seed mod n`; Build mode → per-token counter++ |
| `__name__` | wildcard file / list | load list `name`, pick like `{…}` |

- **Nesting** supported (`{red|{light|dark} blue}`); the winner is recursively resolved.
- Each token salted by its own text + occurrence index, so tokens roll independently but **stably for a given seed** (Marinara pattern).
- **Pins** (lever 2) key on `hash(sectionId + rawToken + occurrence)` — editing a token naturally invalidates its pin (self-healing).
- `[a|b|c]` sequential: run mode uses the seed as counter (`control_after_generate = increment` → rotate per run); Build mode increments a stored per-token index. Combinatorial expansion (all permutations) is out of scope for v1.

## 6. Build artifact + history

Build (button, or per-run in reroll mode) produces an **intermediate record**:

```json
BuildRecord {
  "builtAt": <ts>, "seed": <int>, "mode": "reroll|locked",
  "sections": [{ "id", "title", "enabled", "resolved" }],
  "rolls":    [{ "key", "type", "raw", "chosen", "index" }],
  "output":   "<final joined string>"
}
```

- Pushed to a **bounded history** (last 25) in node state.
- **Restore** loads a record's sections + pins + seed back into the editor — "that one great prompt" comes back whole, rolls and all.
- Doubles as the **compiled-prompt inspector** (Marinara's PeekPrompt): the Preview panel shows `output` + per-section resolved text + what each token rolled. (Token counts: Phase 2.)

## 7. Editor UX

Top → bottom:

- **Toolbar:** mode toggle (🎲 Reroll / 🔒 Locked) · **Build** · **Preview** · **History ▾** · global 🎲 · joiner.
- **Sections list:** row = drag handle `⠿` · enable checkbox · collapse chevron · inline-editable title · remove ✕. Expanded → the content editor.
- **Content editor:** a real `<textarea>` with a **highlight overlay behind it** (keeps native cursor / IME / undo — contenteditable fights all three). Tokens colour-coded: `{}` choice / `[]` array / `__` wildcard / unbalanced = error tint. Click a token → **popup list editor** (rows: value + weight, add/remove/reorder, "pin this value"). Inline editing always allowed; popup never forced.
- **Preview panel:** resolved output (copyable) + collapsible per-section + roll list — the intermediate JSON made human.
- **+ Add section.**

*Open-question answers:* highlighting = yes (overlay); inline vs popup = both, popup optional.

## 8. Serialized state (the DOM widget's JSON)

```json
PromptNodeState {
  "version": 1,
  "settings": { "mode": "reroll|locked", "joiner": ", " },
  "sections": [ Section ],
  "pins":     { "<key>": "<value>" },
  "counters": { "<key>": <int> },     // [a|b|c] Build-mode indices
  "cache":    BuildRecord | null,      // locked-mode frozen output
  "history":  [ BuildRecord ]          // bounded 25
  // Phase 2: "choices": [ ChoiceDef ]
}
Section { "id", "title", "enabled", "collapsed", "content" }
```

## 9. Architecture

- **Vue standalone**, reuse vendored `js/lib/vue.esm-browser.prod.js` — Composition API, string template, no build step. Files: entry `js/prompt_builder.js` (top-level, auto-loaded); app in `js/prompt/{editor,tokens,serialize}.js`.
- **DOM widget round-trip:** scrape+splice the auto `state` widget, `addDOMWidget("state", …, { serialize:true, getValue: serialize, setValue: deserialize })`; belt-and-suspenders `onConfigure` rehydrate. Add the `onRemoved`→`unmount` the Resolver omits.
- **Resolver lives in Python** (single source of truth): `resolve(state, seed) → BuildRecord`. Used at run time (`build()`), and by a **preview API route** `POST /image_saver/prompt/build` that the JS Build/Preview buttons call — so preview and run agree, and it works headless / via API (no frontend-only resolution). JS does only *tokenizing for highlighting* (simple), never resolution — no grammar drift.
- **IS_CHANGED:** reroll mode → key on `seed` + state hash; locked mode → key on `cache.output`. Locked runs stay cache-stable; reroll runs vary with seed.
- **Tests:** `tests/test_prompt_builder.py`, mirroring `test_resolver.py` — grammar, weights, seeded determinism, pins, sequential, nesting.

## 10. Marinara-inspired additions (proposed, phased — flag any you don't want)

- **Choice Blocks — ✅ landed (single / multi / random).** Named variables with a curated option list, **label ≠ value** (dropdown shows "Cinematic", injects "cinematic, dramatic lighting, film grain"), referenced `%name%` in any section. Resolved in Python with **variable semantics** — one value per build, reused across every reference; injected values re-resolve nested `{}`/`[]`/`__`; undefined `%name%` warns and is left verbatim. Three modes: **single** (dropdown), **multi** (tick several, values joined — comma/space/newline), **random** (one option rolled per build, seeded by `(seed, name)`). Rendered as a compact "knobs" strip (dropdown / summary / 🎲 by mode) with an options-manager dialog (mode picker + radio/checkbox/dice rows); `selected` is an array of option ids (rename/reorder-safe, back-compat with the old scalar). *Still to do:* save-as-default, exposing choices as real node combo widgets.
- **Conditionals / variables (P3).** `{{if style == cinematic}}…{{/if}}`, `{{setvar}}` — conditional inclusion without graph branching. Heavy; likely optional for image work.
- **Group nesting + XML/MD wrap (P3).** From the preset system; probably unneeded for image prompts.

## 11. Phasing

- **Phase 1 — ✅ shipped:** sections (add/remove/disable/reorder/collapse/**split-at-cursor**) · inline editor w/ live highlighting · `{a|b|c}` weighted + `[a|b|c]` sequential + `__name__` · per-token pin (auto/manual, with **pinned-value chips**) · popup list editor · seed reroll + locked/cache + Build · history + restore + preview · Python resolver + route + `STRING` output · tests.
- **Phase 2:** Choice Blocks — ✅ **single / multi / random** (knobs strip + manager) landed · token counts · wildcard-file management UI.
- **Phase 3:** conditionals / variables · **section groups** (collapsible; enable/disable and reorder a whole group as a block, à la the Resolver's group-block drag — JA flagged wanting this on 2026-07-23; deferred as possible overkill) · negative-role output · expose choices as node combo widgets.

## 12. Styling

Match host theme via ComfyUI / PrimeVue CSS vars (repo's approach): `--comfy-input-bg`, `--input-text`, `--border-color`, `--descrip-text`, `--p-primary-color`, each with a hex fallback. Section cards: rounded, subtle border, accent on active / drag. Pixaroma is the polish bar — its source hasn't been read (different machine); a screenshot lets me calibrate.

## 13. Open decisions (proceeding unless told otherwise)

1. `[a|b|c]` = sequential rotation (not combinatorial). ⚠️ assumed.
2. Resolution in Python + preview route (not dual JS/Python grammar). ⚠️ assumed.
3. Adopt Choice Blocks in P2. ✅ shipped — single / multi / random.
4. Node name `Prompt Builder (Mottoes)`. ✅ resolved (repo renamed from ComfyUI-Image-Saver).
