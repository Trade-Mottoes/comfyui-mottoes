# ComfyUI Prompt Builder — Design Spec

**Status:** Phase 1 shipped · Choice Blocks (single / multi / random) landed · **Target:** Vue-standalone node in **ComfyUI-Mottoes** (repo renamed from ComfyUI-Image-Saver; this spec predates the rename, so ignore stale "Image Saver" mentions below).

## 1. Why

Real prompt work is compositional and iterative: you toggle ideas on/off, keep variants, roll dice on style/subject, and want the *exact* prompt that produced a good image back later. ComfyUI's own prompt entry is a single dumb textarea. Marinara-Engine's world-info / preset system already solved this shape of problem for chat — composable enable/disable/reorder sections + a **seeded, lockable wildcard engine** + curated "choice" variables. This node ports that flexibility to image prompts, in the repo's existing Vue-standalone style (the Resolver editor).

**The field has moved (source reviewed 2026-07-29).** Pixaroma's re-thought `Prompt Pixaroma` is no longer a prettier textarea: it ships a machine-global tag library (`@tag` snippets, `*category` random pick, `#list` line pick) with a card-based manager, categories, export/import, and shuffle / random / in-order pick modes. An earlier draft of this spec waved it off as "nicer-looking, same limitations" — that is no longer true and shouldn't be repeated. Two differentiators survive it, and they're the ones to build on:

1. **Resolution lives in Python, as a pure function of `(template, seed)`** (§9). Pixaroma expands on the frontend in a `graphToPrompt` hook and injects the result into a hidden input. That costs them three things we keep: a headless / API run gets an empty prompt (their own docstring says so); the pick is a persisted cursor with no seed relationship, so a good result can't be reproduced from its seed; and the preview can't show the real prompt — it prints the *mode* (`[shuffled line: animals]`) instead of the pick. Our preview and our run call the same resolver, so what you preview is what you render.
2. **Prompts are assets, not a private blob.** Their library is one JSON object in an unregistered ComfyUI setting — per-machine, invisible to the workflow, deliberately private. Ours is headed for the **Gallery**, managed alongside the rest of the assets, which is where a prompt library belongs once you care about finding and reusing what produced an image. That integration is the point of the node; today's sparse UX is unfinished work, not the end state.

Where they're ahead, take it: their no-repeat "deck" pick beats our sequential rotation (§5.1), and their library manager is real UX we don't have — wildcards are still bare `.txt` files with no editor (§11 P2).

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

### 5.1 Deck mode — seeded no-repeat picks (✅ shipped)

`{a|b|c}` is weighted-random per seed, so it repeats — `1,1,3,2,1` is normal. `[a|b|c]` rotates in fixed order, which never repeats but is entirely predictable. Neither gives the thing people actually want from a wildcard: *surprise me, but show me everything before you repeat.*

Pixaroma solves this with a **deck** — deal every option once, then reshuffle. Theirs is *stateful*: a cursor per list, persisted in ComfyUI settings outside the workflow. We can't adopt that shape. Our whole design says output is a pure function of `(template, seed)` (§3 lever 1, §9); a stored cursor would break preview==run, break reproducibility, and let a run dirty state.

**Stateless equivalent — same guarantee, derived instead of stored.** For a token with `n` options and the step counter `t` we already compute (`_sequential_index`: `t = seed + crc(key)` at run time, `counters[key]` in Build mode):

```
d = t // n                                 # which deck (cycle)
p = t %  n                                 # position within it
π = permutation of [0..n-1] from (key, d)  # NOT from the seed — see below
index = π[p]
```

⚠️ **`π` must not be salted with the run seed.** The seed advances on every step, so
seeding the shuffle with it re-deals the deck underneath you mid-deck and destroys
both coverage and the no-repeat guarantee. (Written that way first; the tests caught
it.) The seed still drives the sequence — it decides *which* deck you're in and where
in it, via `t` — so the pick stays a pure function of `(seed, key)` while the order
within a deck stays fixed for that deck's whole run.

Every option appears exactly once **per deck** — that is, per aligned window `t ∈ [d·n, (d+1)·n)` — the order reshuffles each cycle, and the whole thing is reproducible from `(seed, key)` with nothing persisted. Note the guarantee is per deck, not per arbitrary sliding window of `n`: a window straddling a boundary can still show one option twice. The boundary fix-up below removes the worst case (back-to-back), not every straddling duplicate.

**Deck-boundary repeat.** Pixaroma also guarantees a new deck never opens on the card the old one closed with. We get that and stay pure: `π` for deck `d-1` is derivable too, so if `π_d[0] == π_(d-1)[n-1]`, swap `π_d[0]` with `π_d[1]` (`n ≥ 2`).

**Where it applies** — a mode on the tokens that pick from a list:

- `[a|b|c]` arrays — `order` (today's behaviour, stays the default) | `deck`.
- `__name__` wildcards — same modes; this is where it earns its keep, on a long file where plain random repeats badly.
- `{a|b|c}` stays weighted-random. A deck guarantees uniform coverage, which is the opposite of what a weight asks for. (Integer weights could expand to a multiset — `3::red` → three copies — but fractional ones can't, so this is out of scope rather than half-done.)

**No new syntax.** The mode is a sparse per-token entry in node state, keyed exactly like pins (`hash(sectionId + rawToken + occurrence)`, §5) and set from the token popup editor that already exists. Editing the token invalidates its mode the same self-healing way pins work. Nothing new to parse — and no new delimiter to collide with `(…)` emphasis or `<lora:…>`.

**Surfaced like a pin, because an invisible mode may as well not exist.** A decked token gets an amber tint in the highlight backdrop (pins are green) and a 🎴 chip in the row under the section, clicking through to the dialog and dropping back to Order via its ✕ — the same affordances pins already had. A pin outranks a deck: it wins the tint and the chip, and the mode is kept underneath so unpinning restores it.

**Honest limitation.** The coverage guarantee holds while `t` advances by exactly 1 per run — `control_after_generate = increment`, or Build mode's counter. Under `randomize`, `t` jumps arbitrarily and you get random picks with locally-shuffled structure, not guaranteed coverage. Say so on the mode toggle. Pixaroma's stateful deck *does* hold under any seed mode — that's the one thing their design buys, and it costs them reproducibility everywhere else. The trade is right for us, but it is a real trade, not a free win.

**Interactions.** A pinned token skips the roll entirely, deck or not (§3 lever 2). Changing `n` by editing the option list moves every deck boundary and effectively restarts the sequence — same practical outcome as Pixaroma's "editing the list starts its deck over", with no migration step.

**Tests** (`tests/test_prompt_builder.py`): determinism for a given `(seed, key)`; exact coverage within each aligned deck window (not a sliding window — see above); no back-to-back repeat across a deck boundary; two consecutive decks differing in order; `n = 1` and empty-list edges; pin bypass; `order` mode behaviour unchanged.

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
- **Phase 2:** Choice Blocks — ✅ **single / multi / random** (knobs strip + manager) landed · **deck mode** (§5.1) ✅ landed (arrays + wildcards, Order/Deck picker in the token dialog, which now opens for `__wildcards__` too) · token counts · wildcard-file management UI (the gap Pixaroma's card library exposes — ours are bare `.txt` files) · Gallery as the prompt/asset store.
- **Phase 3:** conditionals / variables · **section groups** (collapsible; enable/disable and reorder a whole group as a block, à la the Resolver's group-block drag — JA flagged wanting this on 2026-07-23; deferred as possible overkill) · negative-role output · expose choices as node combo widgets.

## 12. Styling

Match host theme via ComfyUI / PrimeVue CSS vars (repo's approach): `--comfy-input-bg`, `--input-text`, `--border-color`, `--descrip-text`, `--p-primary-color`, each with a hex fallback. Section cards: rounded, subtle border, accent on active / drag. Pixaroma is still the polish bar; its source **has** now been read (2026-07-29, `custom_nodes/ComfyUI-Pixaroma/js/prompt/`) — the parts worth calibrating against are the fullscreen card-based library manager and the inline token highlighting (known/unknown/random shown in distinct colours right in the textarea).

## 13. Open decisions (proceeding unless told otherwise)

1. `[a|b|c]` = sequential rotation (not combinatorial). ⚠️ assumed.
2. Deck mode (§5.1) is a per-token **mode**, not new syntax, and is derived from the seed rather than persisted. ⚠️ assumed — the alternative (a stored cursor, as Pixaroma does it) buys coverage under `randomize` at the cost of reproducibility.
3. Resolution in Python + preview route (not dual JS/Python grammar). ⚠️ assumed.
4. Adopt Choice Blocks in P2. ✅ shipped — single / multi / random.
5. Node name `Prompt Builder (Mottoes)`. ✅ resolved (repo renamed from ComfyUI-Image-Saver).
