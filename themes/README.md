# themes/

Community themes: `.bftheme` files exported from Beatform. Each file is a whole shareable setup — metadata plus a complete project document (styles, background, overlay layers with embedded assets, timeline scenes, post chain). Pure data, no code.

Naming convention: the file must be named after its registry entry ID — `themes/<entry-id>.bftheme`, where `<entry-id>` is a lowercase slug (letters, digits, single hyphens). CI enforces that the filename matches the `id` in `index.json`.
