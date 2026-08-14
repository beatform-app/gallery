# Beatform Gallery

This is the community gallery for [Beatform](https://github.com/beatform-app), the free and open-source music visualizer. It holds reviewed, hash-verified looks and themes that are browsable directly inside the app — press the **Gallery** button in the top bar (Beatform 2.72.0 or newer). Everything here is free content under a free license — there are no paid tiers and never will be.

The gallery is **live**: the first curated collection (eleven seed looks and themes) shipped on 2026-08-05, and now holds eighteen entries — thirteen looks and five themes.

The gallery is deliberately boring infrastructure: one JSON registry (`index.json`), content files committed to this repository, and a small validator that CI runs on every change. The app never trusts anything it downloads until it has verified it.

## What lives here

| Folder | Contents |
| --- | --- |
| `looks/` | `.bfpreset` files — a named snapshot of one visual mode's parameters and sync settings ("looks"). |
| `themes/` | `.bftheme` files — a whole shareable setup: metadata plus a complete project document (styles, background, overlays, timeline scenes, post chain). |
| `previews/` | One preview image per entry (PNG or JPEG, at most 512 KB). |
| `schema/` | The JSON Schema describing `index.json`, plus a generated snapshot of the app's parameter specs that CI checks content against. See [schema/README.md](schema/README.md). |
| `scripts/` | The dependency-free validator that CI runs. |

Both content formats are pure data. They contain no code of any kind, and the app parses them with strict validators before anything is shown. Shader content is planned for a later registry version and will arrive with its own, much stricter review bar.

## How installation works (the security model, in plain words)

1. The app fetches `index.json` from this repository.
2. Every entry's `contentUrl` is pinned to a specific git commit (`raw.githubusercontent.com/beatform-app/gallery/<40-hex-commit>/...`). Pinned URLs are immutable by construction: nobody — including us — can change what that URL serves without the URL itself changing. There is no silent-replacement path.
3. Before downloading, the app checks `minAppVersion` and the content `schemaVersion`, so it never downloads something it cannot parse. It also rejects any registry entry whose declared `sizeBytes` is above the 32 MB ceiling (512 KB for previews) at the moment it reads the index — that check happens before any content request is made.
4. The download goes to memory, never straight to disk, and redirects are refused outright. The received bytes must then match the declared `sizeBytes` **exactly**, and their SHA-256 must match the `sha256` in the registry. On either mismatch the bytes are discarded before parsing. To be precise about the ordering: the transfer itself is not truncated mid-flight — the size check is enforced on the bytes in hand, before anything downstream may touch them.
5. Only after hash verification does the app parse and validate the file, show a preview along with the author, license, and attribution, and — only on an explicit "Install" click — persist it locally.

Removal never deletes: an entry that has to go is marked with `"tombstone": true`, and the app drops it while reading the index — it is never listed, never downloaded, never installable. IDs are never reused and history is never rewritten. An entry may also carry `replacedBy` pointing at a successor id; that is a registry-side annotation for reviewers and CI, and the app does not read it or surface the successor anywhere today.

## Submitting content

Submissions are pull requests, and every PR is reviewed by the repository owner before merge. The flow:

1. **Fork** this repository.
2. **Export** your look or theme from Beatform (`.bfpreset` for a look, `.bftheme` for a theme). Export it rather than hand-editing the numbers afterwards: the app's own controls always leave values on their step grid, and CI refuses content that sits off it — see [Validation](#validation).
3. **Pick an ID**: a lowercase slug like `midnight-phonk`, 3–64 characters, letters/digits/single hyphens. The content file must be named after it: `looks/<id>.bfpreset` or `themes/<id>.bftheme`.
4. **Add a preview**: `previews/<id>.png` or `.jpg`, at most 512 KB, showing the look actually running.
5. **Append an entry** to `index.json` (see the worked example below). Compute the SHA-256 and byte size of your files:
   - Windows: `certutil -hashfile looks\my-id.bfpreset SHA256`
   - macOS/Linux: `shasum -a 256 looks/my-id.bfpreset`
6. **Set the commit pin**: the `contentUrl` and `preview.url` must contain the 40-hex SHA of the commit that adds your files. Push your content commit first, copy its SHA, then add the index entry in a NEW commit. **Never amend or force-push after copying the SHA** — that orphans the pin and the URLs will 404. CI byte-verifies every pinned URL against git history (sha256 + size), whatever commit it points at.
7. **Open the PR** using the template. Your PR description must include an explicit license grant sentence — see below. CI must be green.

### Licensing

The repository's own MIT license covers the schema, scripts, CI, and documentation — not the content entries. Each entry carries its own `license` field, and at launch exactly two values are accepted:

- `CC0-1.0` — public domain dedication.
- `CC-BY-4.0` — free use with attribution; the app displays the `author` field wherever the content appears.

You must either be the creator of the content or have the right to submit it with the credited creator named in `author`. Every PR must contain this sentence (with your choices filled in): *"I license this submission under [CC0-1.0 / CC-BY-4.0] and confirm I have the right to do so."*

### The worked example entry

This example is documentation only — it is **not** in the live index and is not installable (the commit pin and hashes below are placeholders). A real entry looks exactly like this:

```json
{
  "id": "midnight-phonk",
  "type": "theme",
  "name": "Midnight Phonk",
  "description": "Slow purple tunnel with a heavy bass pulse and drifting particle backdrop. Tuned for 80-100 BPM phonk and lo-fi sets.",
  "author": {
    "name": "Example Author",
    "url": "https://github.com/example-author"
  },
  "license": "CC-BY-4.0",
  "contentUrl": "https://raw.githubusercontent.com/beatform-app/gallery/0000000000000000000000000000000000000000/themes/midnight-phonk.bftheme",
  "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "sizeBytes": 48213,
  "minAppVersion": "2.68.0",
  "schemaVersion": 13,
  "preview": {
    "url": "https://raw.githubusercontent.com/beatform-app/gallery/0000000000000000000000000000000000000000/previews/midnight-phonk.png",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

Field notes:

- `schemaVersion` is the version of the **content** format, not of this registry. For a theme it is the embedded project document's schema version (`projectSchemaVersion` inside the `.bftheme`, 14 as of Beatform 2.85.0); for a look it is the `.bfpreset` `schemaVersion` (still 1). Read the number out of the file you exported rather than copying one from here — the app uses it to skip content it cannot parse yet, and a number higher than the reader supports gates the entry.
- `minAppVersion` is the oldest Beatform release that can load the entry. Use the version you actually tested with.
- `sizeBytes` must be the exact byte size of the content file. The app requires an exact match, not merely "no larger than" — a file that has changed by one byte since you hashed it is refused.
- `preview` is optional in the schema for now, but submissions are expected to include one — entries without a preview are hard to browse and will usually be asked to add it in review.

## Moderation policy

Every pull request is reviewed and merged by the repository owner. Reviews are human and opinionated; being valid JSON is necessary, not sufficient. Submissions are rejected when they:

- contain anything other than data the app's parsers accept (no code, no embedded executables, no external references);
- infringe someone else's work, or credit is missing or wrong;
- lack the license grant sentence, or pick a license outside the accepted list;
- include offensive, hateful, or sexually explicit names, descriptions, or previews;
- are effectively duplicates of existing entries, or are too low-effort to help discovery;
- have a misleading preview that does not show the actual content.

## Removal and tombstones

If content must be pulled (license dispute, takedown request, quality or safety problem), the entry is not deleted. It gets `"tombstone": true` and keeps its ID forever. The app drops tombstoned entries while reading the index, so they are never listed and never installable. `replacedBy` may name a successor id for reviewers and CI; the app does not read that field, so a successor is not surfaced to users anywhere today. Git history is never rewritten to remove content; if a legal obligation ever required expunging history, the affected pins would break and the tombstone would remain as the record.

To report a problem with published content, open a GitHub issue on this repository. See also [SECURITY.md](SECURITY.md).

## Validation

CI runs `node scripts/validate.mjs` on every push and pull request (Node 24, no external dependencies, no network). You can run the same command locally from the repository root.

It checks two different things:

**The index.** Registry entries against the schema rules, ID uniqueness and ID-to-filename identity, commit-pinned URLs into this repository, and byte-for-byte verification of every pinned content and preview blob against its declared SHA-256 and size — resolved out of git history, so it verifies what the pinned URL actually serves rather than only what happens to be checked out.

**The content those pins resolve to.** Every parameter value in every `.bfpreset` and `.bftheme` must sit on the step grid of the slider that edits it, checked against a committed snapshot of the app's own parameter specs. A value off its grid renders as authored until a user touches that slider, which snaps it — quietly turning the entry into one nobody reviewed. [schema/README.md](schema/README.md) explains the rule, its exact scope, and how to regenerate the snapshot when the app's parameters change.
