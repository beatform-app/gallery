#!/usr/bin/env node
// Validates index.json for the Beatform gallery. Dependency-free by design:
// this script IS the machine-checked contract, and CI runs nothing else.
// The JSON Schema in schema/index.schema.json documents the same rules for
// humans and tooling; if you change one, change both.
//
// It checks two different kinds of thing:
//   1. The INDEX — shape, ids, licenses, commit-pinned URLs, and byte-exact
//      verification of every pinned content and preview blob.
//   2. The CONTENT those pins resolve to — every parameter value must sit on
//      its slider's step grid, read against the spec snapshot in
//      schema/param-specs.json. See "THE STEP-GRID RULE" below.
//
// Exit code 0 = valid, 1 = one or more problems (all are listed).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (msg) => errors.push(msg);

// The commit being validated. In CI this is the PR head / pushed commit;
// locally it is whatever HEAD is. URL pins equal to this commit must
// reference files that actually exist in the working tree with matching
// hash and size. Older pins are assumed immutable history and are skipped.
let headSha = process.env.GITHUB_SHA ?? "";
if (!/^[0-9a-f]{40}$/.test(headSha)) {
  try {
    headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
      .toString()
      .trim();
  } catch {
    headSha = "";
  }
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CONTENT_URL_RE =
  /^https:\/\/raw\.githubusercontent\.com\/beatform-app\/gallery\/([0-9a-f]{40})\/((looks|themes)\/[a-z0-9]+(?:-[a-z0-9]+)*\.(bfpreset|bftheme))$/;
const PREVIEW_URL_RE =
  /^https:\/\/raw\.githubusercontent\.com\/beatform-app\/gallery\/([0-9a-f]{40})\/(previews\/[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpg))$/;
const LICENSES = ["CC0-1.0", "CC-BY-4.0"];
const TYPES = ["look", "theme"];
const TYPE_FOLDER = { look: "looks", theme: "themes" };
const TYPE_EXT = { look: "bfpreset", theme: "bftheme" };
const MAX_CONTENT_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 512 * 1024;

/**
 * Snapshot of every built-in preset's parameter spec (min/max/step), taken
 * from the app's own src/render/presets/* by scripts/gen-param-specs.mjs.
 * Read here so CI can prove the STEP-GRID RULE below without cloning the app
 * or touching the network. A missing or unreadable snapshot is a hard
 * failure, not a skipped check — a rule that silently stops running is worse
 * than no rule.
 */
let PARAM_SPECS = null;
try {
  const raw = JSON.parse(readFileSync(join(repoRoot, "schema", "param-specs.json"), "utf8"));
  if (typeof raw?.presets !== "object" || raw.presets === null) throw new Error("no presets map");
  PARAM_SPECS = raw.presets;
} catch (e) {
  fail(`schema/param-specs.json is missing or unreadable (${e.message}) — regenerate it with scripts/gen-param-specs.mjs`);
}

function checkString(where, obj, key, maxLen) {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    fail(`${where}: "${key}" must be a non-empty string`);
    return null;
  }
  if (maxLen && v.length > maxLen) fail(`${where}: "${key}" exceeds ${maxLen} characters`);
  return v;
}

function checkKeys(where, obj, allowed, required) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`${where}: unknown property "${k}" (additionalProperties is not allowed)`);
  }
  for (const k of required) {
    if (!(k in obj)) fail(`${where}: missing required property "${k}"`);
  }
}

/**
 * Byte-verify a commit-pinned file via git history. Every non-tombstoned
 * entry gets this — the promise "CI verifies the exact bytes the pinned URL
 * serves" must hold for REAL submissions, whose pins are never HEAD (the
 * index commit comes after the content commit). Requires full history
 * (fetch-depth: 0 in CI); an unreachable pin is a hard failure, not a skip.
 */
function verifyPinnedBlob(where, pin, relPath, expectedSha, expectedSize, maxBytes, label) {
  let bytes;
  try {
    bytes = execFileSync("git", ["cat-file", "-p", `${pin}:${relPath}`], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    fail(
      `${where}: ${label} pin ${pin.slice(0, 12)} or path "${relPath}" is not reachable in git history — shallow clone, rewritten history, or a pin pointing outside this repo`,
    );
    return null;
  }
  if (expectedSha) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha) {
      fail(`${where}: ${label} sha256 mismatch at pin — index says ${expectedSha}, pinned "${relPath}" hashes to ${actual}`);
    }
  }
  if (expectedSize !== undefined && bytes.length !== expectedSize) {
    fail(`${where}: ${label} sizeBytes mismatch at pin — index says ${expectedSize}, pinned "${relPath}" is ${bytes.length} bytes`);
  }
  if (maxBytes && bytes.length > maxBytes) {
    fail(`${where}: ${label} pinned "${relPath}" is larger than the ${maxBytes}-byte limit`);
  }
  return bytes;
}

function verifyLocalFile(where, relPath, expectedSha, expectedSize, maxBytes, label) {
  const abs = join(repoRoot, ...relPath.split("/"));
  if (!existsSync(abs)) {
    fail(`${where}: ${label} URL is pinned to this commit but "${relPath}" does not exist in the repo`);
    return;
  }
  const bytes = readFileSync(abs);
  if (expectedSha) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha) {
      fail(`${where}: ${label} sha256 mismatch — index says ${expectedSha}, file "${relPath}" hashes to ${actual}`);
    }
  }
  if (expectedSize !== undefined && bytes.length !== expectedSize) {
    fail(`${where}: ${label} sizeBytes mismatch — index says ${expectedSize}, file "${relPath}" is ${bytes.length} bytes`);
  }
  if (maxBytes && statSync(abs).size > maxBytes) {
    fail(`${where}: ${label} "${relPath}" is larger than the ${maxBytes}-byte limit`);
  }
}

/* ------------------------------------------------------------------ *
 * THE STEP-GRID RULE
 *
 * Every parameter value in an entry's content must land on the step grid
 * of the slider that edits it.
 *
 * Why this is worth a CI rule rather than a review habit: a value off its
 * grid renders exactly as authored right up until the user brushes that
 * slider, at which point the range input rewrites the value onto the grid
 * and the entry silently becomes a different one. Nothing in the app
 * prevents it — the content validators keep every finite number verbatim,
 * with no range, step or spec lookup anywhere in the path — so the file is
 * accepted, installs cleanly, and only misbehaves under the user's hand.
 * Beatform enforces the same rule on its own in-code styles
 * (src/render/presetStyles.test.ts); this is that rule applied to the
 * content this registry ships. The math below is deliberately the same.
 *
 * DELIBERATE SCOPE. Only parameters of the visual presets are checked —
 * the specs in the app's src/render/presets/*. The post chain, the motion
 * masters and modulation route amounts have their own separate tables and
 * are NOT covered here; the snapshot carries min/max as well as step, so
 * a range rule is a small addition if one is ever wanted, but it is not
 * this rule.
 * ------------------------------------------------------------------ */

/** Where parameter values live inside a `.bfpreset` / `.bftheme`. Returns
 * `{ label, presetIds, key, value }` rows; `presetIds` has more than one
 * entry only for automation lanes, which target a bare param key against
 * whatever preset is active at that time (Beatform's own comment in
 * src/state/project.ts calls that cross-mode ambiguity out) — so a lane is
 * held to the grid of every preset the document actually uses that
 * declares the key. */
function paramValuesIn(type, json) {
  const rows = [];
  const add = (label, presetIds, params) => {
    for (const [key, value] of Object.entries(params ?? {})) {
      rows.push({ label, presetIds, key, value });
    }
  };
  if (type === "look") {
    const preset = json?.preset;
    if (typeof preset !== "object" || preset === null) return null;
    add("preset.params", [preset.presetId], preset.params);
    return rows;
  }
  const doc = json?.document;
  if (typeof doc !== "object" || doc === null) return null;
  for (const [presetId, params] of Object.entries(doc.paramsByPreset ?? {})) {
    add(`paramsByPreset.${presetId}`, [presetId], params);
  }
  const scenes = Array.isArray(doc.timeline?.scenes) ? doc.timeline.scenes : [];
  for (const scene of scenes) {
    add(`timeline scene "${scene?.id ?? "?"}"`, [scene?.presetId ?? doc.presetId], scene?.params);
  }
  const activePresets = [
    ...new Set([doc.presetId, ...scenes.map((s) => s?.presetId)].filter((p) => typeof p === "string")),
  ];
  for (const lane of Array.isArray(doc.timeline?.lanes) ? doc.timeline.lanes : []) {
    for (const kf of Array.isArray(lane?.keyframes) ? lane.keyframes : []) {
      rows.push({
        label: `automation lane "${lane?.param}" at t=${kf?.t}`,
        presetIds: activePresets,
        key: lane?.param,
        value: kf?.value,
      });
    }
  }
  return rows;
}

/* Own-property lookups, never bare indexing. Both the preset id and the
 * parameter key come out of a submitted JSON file, so `toString`,
 * `constructor` and friends would otherwise resolve against Object.prototype
 * and read as "known" — which would quietly turn a bogus visual or an
 * inherited key into a spec-shaped value with no `step`, and the grid check
 * would skip it instead of refusing it. */
const knownPreset = (p) => typeof p === "string" && Object.hasOwn(PARAM_SPECS, p);
const knownParam = (p, key) => typeof key === "string" && Object.hasOwn(PARAM_SPECS[p], key);

function checkParamGrid(where, type, relPath, bytes) {
  if (!PARAM_SPECS) return;
  let json;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    fail(`${where}: content "${relPath}" is not valid JSON (${e.message})`);
    return;
  }
  const rows = paramValuesIn(type, json);
  if (rows === null) {
    fail(
      `${where}: content "${relPath}" has no ${type === "look" ? '"preset"' : '"document"'} object — it is not a readable .${TYPE_EXT[type]}`,
    );
    return;
  }
  // Unknown visuals are reported ONCE per file rather than once per value —
  // a preset the snapshot has never heard of would otherwise print the same
  // line for every parameter in it and bury everything else.
  const unknown = new Set();
  for (const row of rows) {
    for (const p of row.presetIds) {
      if (!knownPreset(p)) unknown.add(String(p));
    }
  }
  for (const p of unknown) {
    fail(
      `${where}: content "${relPath}" uses visual "${p}", which schema/param-specs.json does not know — regenerate the snapshot (scripts/gen-param-specs.mjs) if the app has gained it`,
    );
  }

  for (const { label, presetIds, key, value } of rows) {
    const known = presetIds.filter(knownPreset);
    if (known.length === 0) continue;
    const defining = known.filter((p) => knownParam(p, key));
    if (defining.length === 0) {
      fail(
        `${where}: ${label} sets "${key}", which is not a parameter of ${known.join(" or ")} — the value would be carried in the file and do nothing`,
      );
      continue;
    }
    if (!Number.isFinite(value)) {
      fail(`${where}: ${label} sets "${key}" to ${JSON.stringify(value)}, which is not a finite number`);
      continue;
    }
    for (const presetId of defining) {
      const spec = PARAM_SPECS[presetId][key];
      if (!(spec.step > 0)) continue;
      // The same rounding a native range input applies to its own value.
      const steps = (value - spec.min) / spec.step;
      if (Math.abs(steps - Math.round(steps)) < 1e-6) continue;
      const nearest = Number((spec.min + Math.round(steps) * spec.step).toFixed(10));
      fail(
        `${where}: ${label} sets ${presetId}.${key} to ${value}, off its ${spec.step} step grid — the slider snaps to ${nearest}, so the entry changes the first time a user touches that control`,
      );
    }
  }
}

// ---- load ----
const indexPath = join(repoRoot, "index.json");
let root;
try {
  root = JSON.parse(readFileSync(indexPath, "utf8"));
} catch (e) {
  console.error(`index.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// ---- top level ----
if (typeof root !== "object" || root === null || Array.isArray(root)) {
  fail("index.json: top level must be an object");
} else {
  checkKeys("index.json", root, ["schemaVersion", "entries"], ["schemaVersion", "entries"]);
  if (root.schemaVersion !== 1) fail(`index.json: schemaVersion must be 1, got ${JSON.stringify(root.schemaVersion)}`);
  if (!Array.isArray(root.entries)) fail("index.json: entries must be an array");
}

const entries = Array.isArray(root?.entries) ? root.entries : [];
const seenIds = new Set();

for (const [i, entry] of entries.entries()) {
  const where = `entries[${i}]${typeof entry?.id === "string" ? ` (${entry.id})` : ""}`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    fail(`${where}: entry must be an object`);
    continue;
  }
  checkKeys(
    where,
    entry,
    ["id", "type", "name", "description", "author", "license", "contentUrl", "sha256", "sizeBytes", "minAppVersion", "schemaVersion", "preview", "tombstone", "replacedBy"],
    ["id", "type", "name", "description", "author", "license", "contentUrl", "sha256", "sizeBytes", "minAppVersion", "schemaVersion"],
  );

  const id = checkString(where, entry, "id", 64);
  if (id !== null) {
    if (!ID_RE.test(id) || id.length < 3) fail(`${where}: id must be a 3-64 char lowercase slug (a-z, 0-9, single hyphens)`);
    if (seenIds.has(id)) fail(`${where}: duplicate id "${id}" — IDs must be unique and are never reused`);
    seenIds.add(id);
  }

  if (!TYPES.includes(entry.type)) fail(`${where}: type must be one of ${TYPES.join(", ")}`);
  checkString(where, entry, "name", 80);
  checkString(where, entry, "description", 500);

  if (typeof entry.author !== "object" || entry.author === null || Array.isArray(entry.author)) {
    fail(`${where}: author must be an object { name, url? }`);
  } else {
    checkKeys(`${where}.author`, entry.author, ["name", "url"], ["name"]);
    checkString(`${where}.author`, entry.author, "name", 80);
    if ("url" in entry.author && (typeof entry.author.url !== "string" || !entry.author.url.startsWith("https://"))) {
      fail(`${where}: author.url must be an https:// URL`);
    }
  }

  if (!LICENSES.includes(entry.license)) {
    fail(`${where}: license must be one of ${LICENSES.join(", ")} — no other licenses are accepted`);
  }

  if (typeof entry.sha256 !== "string" || !SHA256_RE.test(entry.sha256)) {
    fail(`${where}: sha256 must be 64 lowercase hex characters`);
  }
  if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 1 || entry.sizeBytes > MAX_CONTENT_BYTES) {
    fail(`${where}: sizeBytes must be an integer between 1 and ${MAX_CONTENT_BYTES}`);
  }
  if (typeof entry.minAppVersion !== "string" || !SEMVER_RE.test(entry.minAppVersion)) {
    fail(`${where}: minAppVersion must be a plain semver (e.g. "2.68.1")`);
  }
  if (!Number.isInteger(entry.schemaVersion) || entry.schemaVersion < 1) {
    fail(`${where}: schemaVersion (of the content format) must be a positive integer`);
  }
  if ("tombstone" in entry && typeof entry.tombstone !== "boolean") {
    fail(`${where}: tombstone must be a boolean`);
  }
  if ("replacedBy" in entry && (typeof entry.replacedBy !== "string" || !ID_RE.test(entry.replacedBy))) {
    fail(`${where}: replacedBy must be an entry id slug`);
  }

  // contentUrl: shape, repo pinning, folder/extension consistency with type,
  // filename identity with id, and (when pinned to HEAD) on-disk truth.
  const tombstoned = entry.tombstone === true;
  const urlMatch = typeof entry.contentUrl === "string" ? entry.contentUrl.match(CONTENT_URL_RE) : null;
  if (!urlMatch) {
    if (!tombstoned) {
      fail(`${where}: contentUrl must be a commit-pinned raw.githubusercontent.com/beatform-app/gallery URL into looks/ or themes/`);
    }
  } else {
    const [, pin, relPath, folder, ext] = urlMatch;
    if (TYPES.includes(entry.type)) {
      if (folder !== TYPE_FOLDER[entry.type]) fail(`${where}: type "${entry.type}" content must live under ${TYPE_FOLDER[entry.type]}/, URL points at ${folder}/`);
      if (ext !== TYPE_EXT[entry.type]) fail(`${where}: type "${entry.type}" content must use .${TYPE_EXT[entry.type]}, URL points at .${ext}`);
    }
    const fileBase = relPath.split("/").pop().replace(/\.(bfpreset|bftheme)$/, "");
    if (id !== null && fileBase !== id) {
      fail(`${where}: content filename "${fileBase}" must equal the entry id "${id}"`);
    }
    if (!tombstoned) {
      // Always verify the PINNED bytes (what the app will actually fetch);
      // when the pin is this very commit, additionally check the working
      // tree so uncommitted drift can't slip through a local run.
      const contentBytes = verifyPinnedBlob(where, pin, relPath, entry.sha256, entry.sizeBytes, MAX_CONTENT_BYTES, "content");
      if (pin === headSha) {
        verifyLocalFile(where, relPath, entry.sha256, entry.sizeBytes, MAX_CONTENT_BYTES, "content");
      }
      // Grid-check the PINNED bytes — the ones the app will actually fetch,
      // already proven above to hash to what the index declares.
      if (contentBytes && TYPES.includes(entry.type)) {
        checkParamGrid(where, entry.type, relPath, contentBytes);
      }
    }
  }

  if ("preview" in entry) {
    const p = entry.preview;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      fail(`${where}: preview must be an object { url, sha256 }`);
    } else {
      checkKeys(`${where}.preview`, p, ["url", "sha256"], ["url", "sha256"]);
      if (typeof p.sha256 !== "string" || !SHA256_RE.test(p.sha256)) {
        fail(`${where}: preview.sha256 must be 64 lowercase hex characters`);
      }
      const pm = typeof p.url === "string" ? p.url.match(PREVIEW_URL_RE) : null;
      if (!pm) {
        fail(`${where}: preview.url must be a commit-pinned raw URL into previews/ (png or jpg)`);
      } else {
        const [, pin, relPath] = pm;
        verifyPinnedBlob(where, pin, relPath, p.sha256, undefined, MAX_PREVIEW_BYTES, "preview");
        if (pin === headSha) {
          verifyLocalFile(where, relPath, p.sha256, undefined, MAX_PREVIEW_BYTES, "preview");
        }
      }
    }
  }
}

// replacedBy must point at a real entry.
for (const [i, entry] of entries.entries()) {
  if (entry && typeof entry.replacedBy === "string" && !seenIds.has(entry.replacedBy)) {
    fail(`entries[${i}]: replacedBy "${entry.replacedBy}" does not match any entry id in the index`);
  }
}

if (errors.length > 0) {
  console.error(`index.json validation FAILED with ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`index.json is valid (${entries.length} entries, head ${headSha || "unknown"}).`);
