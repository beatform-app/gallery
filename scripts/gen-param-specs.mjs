#!/usr/bin/env node
// Regenerates schema/param-specs.json — the snapshot of five grids
// scripts/validate.mjs checks entry content against: every built-in
// Beatform preset's parameter spec (min/max/step), the post chain
// (POST_MOD_TARGETS), the motion masters (MOTION_MASTER_SPECS), the
// modulation-amount grid (MOD_AMOUNT_STEP) and the sync-trio grid
// (SYNC_TRIO_STEP). The last four joined the preset map in C5(b) — owner
// decision #6, 2026-08-16 ("extend"); see schema/README.md for what each
// one covers and what it deliberately does not.
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
// Every grid is read through the app's real exports — `presets` and
// `allParams()`, `POST_MOD_TARGETS`, `MOTION_MASTER_SPECS`,
// `MOD_AMOUNT_STEP`, `SYNC_TRIO_STEP` — never re-declared here: a snapshot
// that restated the numbers by hand could drift from the sliders it claims
// to describe, which is the precise failure the rule exists to catch.

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

let presetsMod, typesMod, versionMod, modMatrixMod, audioTypesMod;
try {
  presetsMod = await server.ssrLoadModule("/src/render/presets/index.ts");
  typesMod = await server.ssrLoadModule("/src/render/types.ts");
  versionMod = await server.ssrLoadModule("/src/version.ts");
  // C5(b): POST_MOD_TARGETS and MOTION_MASTER_SPECS live in types.ts,
  // already loaded above. The amount and sync-trio steps live in their own
  // modules — each as light a load as types.ts itself (a handful of types,
  // consts and pure functions; no React, no DOM, no localStorage touch),
  // confirmed by reading both files rather than assumed.
  modMatrixMod = await server.ssrLoadModule("/src/state/modMatrix.ts");
  audioTypesMod = await server.ssrLoadModule("/src/audio/types.ts");
} finally {
  // middlewareMode + never calling .listen() means no port was ever bound;
  // this is a one-shot module loader, not a dev server.
  await server.close();
}

const { presets } = presetsMod;
const { allParams, POST_MOD_TARGETS, MOTION_MASTER_SPECS } = typesMod;
const { APP_VERSION } = versionMod;
const { MOD_AMOUNT_STEP } = modMatrixMod;
const { SYNC_TRIO_STEP } = audioTypesMod;

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

// POST_MOD_TARGETS / MOTION_MASTER_SPECS are already ParamSpec-shaped
// (key/label/min/max/step/default) — trimmed to min/max/step here, exactly
// like the preset map above, so validate.mjs reads one uniform shape
// everywhere instead of two.
const post = {};
for (const spec of POST_MOD_TARGETS) post[spec.key] = { min: spec.min, max: spec.max, step: spec.step };

const motion = {};
for (const spec of MOTION_MASTER_SPECS) motion[spec.key] = { min: spec.min, max: spec.max, step: spec.step };

// modAmount / syncTrio are each ONE flat grid, not a per-key map: a
// ModRoute's `amount` (whatever it targets) and a SyncSettings'
// smooth/attack/release (whatever preset it belongs to) each share a single
// step. Only the step itself is read from the app (MOD_AMOUNT_STEP,
// SYNC_TRIO_STEP) — the -1..1 / 0..1 bounds are the modulation-math and
// clamp01 CONTRACTS, not slider tuning, so unlike a preset's min/max they
// are not behind an exported spec object to read: they live inline as
// `Math.min(1, Math.max(-1, r.amount))` in validModRoutes
// (src/state/modMatrix.ts) and as `clamp01` in sanitizeSync
// (src/audio/types.ts), and are stable by construction the same way those
// two clamps are.
const modAmount = { min: -1, max: 1, step: MOD_AMOUNT_STEP };
const syncTrio = { min: 0, max: 1, step: SYNC_TRIO_STEP };

const doc = {
  note:
    "GENERATED FILE - do not hand-edit. Five grids scripts/validate.mjs checks " +
    "entry content against. `presets`: one entry per built-in Beatform preset, " +
    "one entry per parameter, carrying the spec's min/max/step exactly as " +
    "src/render/presets/* declares it. `post`: the post chain " +
    "(POST_MOD_TARGETS). `motion`: the motion masters (MOTION_MASTER_SPECS). " +
    "`modAmount`: the modulation-amount grid (MOD_AMOUNT_STEP). `syncTrio`: " +
    "the sync-trio grid (SYNC_TRIO_STEP). Regenerate with `node " +
    "scripts/gen-param-specs.mjs <path-to-beatform-app-checkout>` and commit " +
    "the result - see schema/README.md.",
  appVersion: APP_VERSION,
  appCommit,
  presets: out,
  post,
  motion,
  modAmount,
  syncTrio,
};

const dest = join(repoRoot, "schema", "param-specs.json");
writeFileSync(dest, JSON.stringify(doc, null, 2) + "\n");
const keys = Object.values(out).reduce((a, s) => a + Object.keys(s).length, 0);
console.log(
  `schema/param-specs.json: ${Object.keys(out).length} presets, ${keys} parameter specs, ` +
    `${Object.keys(post).length} post, ${Object.keys(motion).length} motion, ` +
    `modAmount step ${modAmount.step}, syncTrio step ${syncTrio.step} ` +
    `(Beatform ${APP_VERSION} @ ${appCommit.slice(0, 12)})`,
);
