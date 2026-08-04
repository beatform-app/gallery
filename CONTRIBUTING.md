# Contributing

Thanks for wanting to add your work to the Beatform gallery!

All submissions go through pull requests, and the full step-by-step guide lives in the [README, under "Submitting content"](README.md#submitting-content) — ID and file naming, hashes, commit pinning, the worked example entry, licensing, and what review looks for. The PR template walks you through the same checklist.

Two things worth repeating because they block merges most often:

1. Your PR description must contain the explicit license grant sentence, choosing `CC0-1.0` or `CC-BY-4.0`.
2. CI must be green: `node scripts/validate.mjs` (Node 24, no dependencies) has to pass, which means your `index.json` entry, filenames, hashes, sizes, and commit-pinned URLs all agree with the files you added.

Changes to the schema, validator, or documentation are welcome too — open an issue first for anything that would change what the app has to understand.
