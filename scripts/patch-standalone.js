#!/usr/bin/env node
/**
 * Post-build patch for the Next.js standalone output.
 *
 * `serverExternalPackages` (dcmjs-dimse, dicom-parser) are require()-ed at
 * runtime through an eval'd require / webpackIgnore dynamic import escape
 * hatch, which Next's output-file-tracer cannot see statically. They (and
 * their transitive dependencies) are therefore MISSING from
 * .next/standalone/node_modules, and DICOM networking would crash in
 * standalone deployments (Docker image, Windows package) with
 * "dcmjs-dimse could not be loaded in this runtime".
 *
 * This script copies each externalized package plus its full transitive
 * dependency closure from the project's node_modules into the standalone
 * output, preserving nested node_modules layouts. It runs automatically as
 * part of `bun run build` (see package.json) and works under both bun and
 * node, so the Docker builder stage (oven/bun) needs no extra tooling.
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT = path.resolve(__dirname, "..");
const MAIN_NM = path.join(PROJECT, "node_modules");
const STANDALONE_NM = path.join(PROJECT, ".next", "standalone", "node_modules");
const ROOTS = ["dcmjs-dimse", "dicom-parser"];

if (!fs.existsSync(path.join(PROJECT, ".next", "standalone", "server.js"))) {
  console.error("patch-standalone: .next/standalone/server.js not found - run next build first");
  process.exit(1);
}
if (!fs.existsSync(STANDALONE_NM)) fs.mkdirSync(STANDALONE_NM, { recursive: true });

/** Walk up from startDir; return the first dir where <dir>/<name>/package.json exists. */
function resolvePkgDir(name, startDir) {
  let dir = startDir;
  for (;;) {
    const cand = path.join(dir, name);
    if (fs.existsSync(path.join(cand, "package.json"))) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const queue = ROOTS.map((name) => ({ name, start: MAIN_NM }));
const seen = new Set();
let copied = 0;

while (queue.length > 0) {
  const { name, start } = queue.shift();
  const srcDir = resolvePkgDir(name, start);
  if (!srcDir || !srcDir.startsWith(MAIN_NM + path.sep)) continue; // builtin or outside project
  if (seen.has(srcDir)) continue;
  seen.add(srcDir);

  const rel = path.relative(MAIN_NM, srcDir);
  const dest = path.join(STANDALONE_NM, rel);
  fs.cpSync(srcDir, dest, { recursive: true, force: true });
  copied += 1;

  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(srcDir, "package.json"), "utf8"));
  } catch {
    /* unreadable package.json -> nothing to enqueue */
  }
  const deps = Object.keys({
    ...(pkg.dependencies || {}),
    ...(pkg.optionalDependencies || {}),
  });
  for (const dep of deps) queue.push({ name: dep, start: path.dirname(srcDir) });
}

console.log(`patch-standalone: copied ${copied} package dirs into .next/standalone/node_modules`);
