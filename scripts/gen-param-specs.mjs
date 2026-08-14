#!/usr/bin/env node
// Regenerates schema/param-specs.json — the snapshot of every built-in
// Beatform preset's parameter spec (min/max/step) that scripts/validate.mjs
// reads to prove entry content sits on the app's own slider grids.
//
//   node scripts/gen-param-specs.mjs <path-to-beatform-app-checkout>
//
// This is a MAINTAINER tool, not part of CI. CI stays dependency-free and
// offline: it reads the committed snapshot and never runs this script. That
// split is deliberate — the alternative (CI cloning the app repo to read the
// specs live) would make every gallery PR depend on the app's default branch
// and on the network, and would let an unrelated app-side change turn a
// green PR red overnight. A committed snapshot moves in reviewable commits
// instead.
//
// WHY THIS GOES THROUGH VITE: the app's src/ uses bundler-style
// extensionless relative imports ("./types"), which Node's own ESM resolver
// does not follow. `server.ssrLoadModule` is Vite's supported API for
// running project TypeScript outside a browser, and vite is already a
// devDependency of the app repo — nothing new is installed anywhere, and
// this repository still has no dependencies of its own. The app's own
// scripts/gallery-submit.mjs loads its modules exactly this way and says so
// at greater length.
//
// The specs are read through the app's real `presets` registry and its real
// `allParams()`, never re-declared here: a snapshot that restated the
// numbers by hand could drift from the sliders it claims to describe, which
// is the precise failure the rule exists to catch.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(process.argv[2] ?? "");
if (process.argv[2] === undefined) {
  console.error("usage: node scripts/gen-param-specs.mjs <path-to-beatform-app-checkout>");
  process.exit(1);
}

// vite belongs to the APP repo, not this one. Resolving from there is what
// lets this repository keep zero dependencies.
const appRequire = createRequire(pathToFileURL(join(appRoot, "package.json")));
let createServer;
try {
  ({ createServer } = await import(pathToFileURL(appRequire.resolve("vite")).href));
} catch (e) {
  console.error(
    `could not load vite from "${appRoot}" — is that a Beatform checkout with node_modules installed?\n${e.message}`,
  );
  process.exit(1);
}

// src/state/persistence.ts touches localStorage at module scope (inside a
// try/catch, so this is a quiet-output nicety rather than a crash fix).
if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}

const server = await createServer({
  configFile: false,
  root: appRoot,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  ssr: {},
});

let presetsMod, typesMod, versionMod;
try {
  presetsMod = await server.ssrLoadModule("/src/render/presets/index.ts");
  typesMod = await server.ssrLoadModule("/src/render/types.ts");
  versionMod = await server.ssrLoadModule("/src/version.ts");
} finally {
  // middlewareMode + never calling .listen() means no port was ever bound;
  // this is a one-shot module loader, not a dev server.
  await server.close();
}

const { presets } = presetsMod;
const { allParams } = typesMod;
const { APP_VERSION } = versionMod;

let appCommit = "";
try {
  appCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: appRoot }).toString().trim();
} catch {
  appCommit = "unknown";
}

const out = {};
for (const preset of [...presets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
  const specs = {};
  for (const p of allParams(preset)) specs[p.key] = { min: p.min, max: p.max, step: p.step };
  out[preset.id] = specs;
}

const doc = {
  note:
    "GENERATED FILE - do not hand-edit. One entry per built-in Beatform preset, " +
    "one entry per parameter, carrying the spec's min/max/step exactly as " +
    "src/render/presets/* declares it. scripts/validate.mjs reads this to prove " +
    "every parameter value in every entry's content lands on the step grid its " +
    "slider snaps to. Regenerate with `node scripts/gen-param-specs.mjs " +
    "<path-to-beatform-app-checkout>` and commit the result - see schema/README.md.",
  appVersion: APP_VERSION,
  appCommit,
  presets: out,
};

const dest = join(repoRoot, "schema", "param-specs.json");
writeFileSync(dest, JSON.stringify(doc, null, 2) + "\n");
const keys = Object.values(out).reduce((a, s) => a + Object.keys(s).length, 0);
console.log(
  `schema/param-specs.json: ${Object.keys(out).length} presets, ${keys} parameter specs ` +
    `(Beatform ${APP_VERSION} @ ${appCommit.slice(0, 12)})`,
);
