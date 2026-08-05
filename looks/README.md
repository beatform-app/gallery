# looks/

Community looks: `.bfpreset` files exported from Beatform. Each file is a named snapshot of one visual mode's parameters and sync settings.

Naming convention: the file must be named after its registry entry ID — `looks/<entry-id>.bfpreset`, where `<entry-id>` is a lowercase slug (letters, digits, single hyphens). CI enforces that the filename matches the `id` in `index.json`.
