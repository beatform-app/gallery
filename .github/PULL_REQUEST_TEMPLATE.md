<!-- Thank you for submitting to the Beatform gallery! Please fill in the checklist. PRs that skip the license grant sentence cannot be merged. Full instructions: README.md, "Submitting content". -->

## What is this?

<!-- One or two sentences about your look or theme: what it does, what music it suits. -->

## Checklist

- [ ] Content file added under the correct folder: `looks/<entry-id>.bfpreset` or `themes/<entry-id>.bftheme`, filename equal to the entry `id`.
- [ ] Entry appended to `index.json` following the worked example in the README.
- [ ] `sha256` and `sizeBytes` in the entry match the file exactly. To compute the hash:
  - Windows: `certutil -hashfile looks\<entry-id>.bfpreset SHA256`
  - macOS/Linux: `shasum -a 256 looks/<entry-id>.bfpreset`
- [ ] `contentUrl` (and `preview.url`) are pinned to the 40-hex commit SHA that adds the files.
- [ ] Preview image included at `previews/<entry-id>.png` or `.jpg`, at most 512 KB, showing the content actually running.
- [ ] License chosen: `CC0-1.0` or `CC-BY-4.0` (no other values are accepted).
- [ ] `author` is me, or the credited creator who agreed to this submission.
- [ ] Tested in Beatform version: <!-- e.g. 2.68.1 --> — and `minAppVersion` reflects it.

## License grant (required)

<!-- Keep exactly one of the two license names. This sentence is required for the PR to be mergeable. -->

I license this submission under [CC0-1.0 / CC-BY-4.0] and confirm I have the right to do so.
