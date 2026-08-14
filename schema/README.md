# schema/

Machine-readable descriptions of what this repository accepts.

| File | What it is |
| --- | --- |
| `index.schema.json` | JSON Schema for `index.json` — the shape of a registry entry. Documentation for humans and tooling; `scripts/validate.mjs` enforces the same rules and is what CI runs. |
| `param-specs.json` | **Generated.** A snapshot of every built-in Beatform visual's parameter specs (`min`/`max`/`step`), used to check the *content* files rather than the index. |

## `param-specs.json` — the step-grid rule

Every parameter value inside a `.bfpreset` or `.bftheme` in this repository must land on the step grid of the slider that edits it. `scripts/validate.mjs` enforces this on every pull request.

**Why it is a rule.** A value off its grid renders exactly as authored right up until a user brushes that slider — at which point the range input rewrites the value onto the grid and the entry silently becomes a different one from the one that was reviewed. Nothing in the app prevents it: the content validators keep every finite number verbatim, with no range, step or spec lookup anywhere in the path. So the file is accepted, installs cleanly, and only misbehaves under the user's hand. Beatform enforces the same rule on its own built-in styles (`src/render/presetStyles.test.ts`); this is that rule applied to the content the gallery ships, and the arithmetic is deliberately identical.

**What is covered.** Parameters of the visual presets — the specs declared in the app's `src/render/presets/*`. In a look that is `preset.params`; in a theme it is `document.paramsByPreset`, any timeline scene's `params` override, and every automation-lane keyframe value.

**What is not.** The post chain, the motion masters and modulation route amounts have their own separate tables and are out of scope. The snapshot carries `min` and `max` alongside `step`, so a range rule would be a small addition — but it is not this rule, and no check reads those two fields today.

### Regenerating

The snapshot is read from the app's real preset registry, never re-typed by hand — a snapshot that restated the numbers could drift from the sliders it claims to describe, which is the exact failure the rule exists to catch.

```bash
node scripts/gen-param-specs.mjs /path/to/beatform-app-checkout
```

The checkout needs its `node_modules` installed (the generator borrows the app's own `vite` to load its TypeScript; this repository still has no dependencies of its own). Re-running on an unchanged app produces byte-identical output, so a diff always means the app's specs actually moved. Commit the result.

Regenerate when the app adds a visual, adds or removes a parameter, or changes a parameter's `min`/`max`/`step`. The generated file records which Beatform version and commit it came from. Until it is regenerated, content using a visual or a parameter the snapshot does not know is **refused** with a message naming this script — deliberately, because a rule that silently stops running is worse than no rule.

CI never runs the generator. It reads the committed snapshot and nothing else: the validator stays dependency-free and offline, and the specs it checks against move only in reviewable commits rather than with the app's default branch.
