# schema/

Machine-readable descriptions of what this repository accepts.

| File | What it is |
| --- | --- |
| `index.schema.json` | JSON Schema for `index.json` — the shape of a registry entry. Documentation for humans and tooling; `scripts/validate.mjs` enforces the same rules and is what CI runs. |
| `param-specs.json` | **Generated.** A snapshot of five grids read out of the app's own source (preset parameters, the post chain, the motion masters, the modulation-amount grid, the sync-trio grid), used to check the *content* files rather than the index. |

## `param-specs.json` — the step-grid rule

Every parameter value inside a `.bfpreset` or `.bftheme` in this repository must land on the step grid of the slider that edits it. `scripts/validate.mjs` enforces this on every pull request.

**Why it is a rule.** A value off its grid renders exactly as authored right up until a user brushes that slider — at which point the range input rewrites the value onto the grid and the entry silently becomes a different one from the one that was reviewed. Nothing in the app prevents it: the content validators keep every finite number verbatim, with no range, step or spec lookup anywhere in the path. So the file is accepted, installs cleanly, and only misbehaves under the user's hand. Beatform enforces the same rule on its own built-in styles (`src/render/presetStyles.test.ts`) and on its own factory theme pack (`factoryThemes.test.ts`'s post/motion/amount checks, `ParamsPanel.tsx`'s sync-trio sliders); this is that rule applied to the content the gallery ships, and the arithmetic is deliberately identical.

**What is covered — five grids, one map apiece in this file:**

| Map | Covers | Lives in content as |
| --- | --- | --- |
| `presets` | Parameters of the visual presets — the specs declared in the app's `src/render/presets/*`. | Look: `preset.params`. Theme: `document.paramsByPreset`, any timeline scene's `params` override, every automation-lane keyframe value. |
| `post` | The post chain (`POST_MOD_TARGETS`) — every key except the boolean `tonemap`. | Theme only: `document.post`. Looks have no post chain. |
| `motion` | The motion masters (`MOTION_MASTER_SPECS`). | Theme only: `document.motion`. Looks have no motion masters. |
| `modAmount` | Modulation route amounts (`MOD_AMOUNT_STEP`) — one flat grid, not per parameter. | Theme only: every route's `amount` under `document.modsByPreset`. Looks cannot carry modulation routes. |
| `syncTrio` | The sync-trio sliders (`SYNC_TRIO_STEP`) — `smooth`/`attack`/`release`, also one flat grid. | Look: `preset.sync`. Theme: any entry of `document.syncByPreset`. |

`presets` alone shipped with Track C (owner decision C); `post`/`motion`/`modAmount`/`syncTrio` joined in C5(b) — owner decision #6, 2026-08-16 ("extend"). Extending was byte-neutral: the 18 live entries were already legal on all four new grids (the app-side C5 work that closed the post/motion/amount gap, and the sync-trio step's 0.01 → 0.002 refinement that legalized blacklight's `sync.attack = 0.012`, both landed before this rule started checking them here) — proven by running the extended rule against them, not assumed.

**What is not covered, deliberately.** Everything else a `SyncSettings` object can carry — `mode`, `contrast`, `freqMin`, `freqMax`, `shapeMerge`, `shapeRound`, and the three spectrum-display enums — is not on the sync-trio grid in the app either, so checking it here would invent a rule the app itself does not enforce. Likewise route `id`/`source`/`param`/`curve`/`attack`/`release`/`muted` (only `amount` is on a grid), and scene/background/overlay/asset content generally. The snapshot's per-key entries carry `min` and `max` alongside `step` (unused by this rule) in case a range check is ever wanted — but that is a different rule, not this one.

### Regenerating

Every grid is read from the app's real exports, never re-typed by hand — a snapshot that restated the numbers could drift from the sliders it claims to describe, which is the exact failure the rule exists to catch.

```bash
node scripts/gen-param-specs.mjs /path/to/beatform-app-checkout
```

The checkout needs its `node_modules` installed (the generator borrows the app's own `vite` to load its TypeScript; this repository still has no dependencies of its own). Re-running on an unchanged app produces byte-identical output, so a diff always means the app's specs actually moved. Commit the result.

Regenerate when the app adds a visual, adds or removes a parameter, or changes a parameter's (or the post chain's, the motion masters', the mod-amount grid's, or the sync-trio's) `min`/`max`/`step`. The generated file records which Beatform version and commit it came from. Until it is regenerated, content using a visual or a parameter the snapshot does not know is **refused** with a message naming this script — deliberately, because a rule that silently stops running is worse than no rule.

CI never runs the generator. It reads the committed snapshot and nothing else: the validator stays dependency-free and offline, and the specs it checks against move only in reviewable commits rather than with the app's default branch.
