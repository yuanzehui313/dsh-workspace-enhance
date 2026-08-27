#!/usr/bin/env node
/**
 * dsh-workspace-enhance overlay auto-applier (canonical, zero-dependency).
 *
 * Why: the functional changes of this plugin are an overlay patch-set over the
 * official @deepseek-ai/dsh-* bundles (the touched surfaces — apiproxy RPC map,
 * workspace registry, workspace browser UI, conversation paste pipeline — are
 * not extensible from an additive plugin). Installing the package alone does
 * NOT activate them; this script (and the lib/index.js startup hook) applies
 * the overlay across every known DSH bundle tree so a plain `npm install`
 * leaves the features live.
 *
 * Behavior:
 *  - Discovers candidate @deepseek-ai bundle trees: DSH profile roots (incl.
 *    per-profile dirs like web), global install layout (execPath sibling),
 *    npx cache, DSH Desktop unpacked, dsh-pinned.
 *  - Version guard: only patches packages whose package.json version matches
 *    the overlay target (0.1.0-rc.6); anything else is skipped with a warning
 *    (overwriting a different DSH version would break it).
 *  - Idempotent: files that already match the overlay are left untouched.
 *  - Backup: every replaced file is copied to <pkg>/backup/<ts>/<rel> first
 *    (same layout scripts/install.ps1 and scripts/uninstall.ps1 use).
 *
 * Usage:
 *   node scripts/apply-overlay.mjs [--dry-run] [--quiet] [--tree <path> ...]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const overlayRoot = join(pkgRoot, "overlay");
export const EXPECTED_DSH_VERSION = "0.1.0-rc.6";

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Recursively list files under root, relative paths with "/" separators. */
function walkFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

/** Every known location that can host the official @deepseek-ai bundle tree. */
export function candidateTrees() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || "", ".dsh");
  const local = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local");
  const trees = [];
  const push = (p) => {
    if (p && existsSync(p) && !trees.includes(p)) trees.push(p);
  };

  push(join(home, "profiles", "node_modules", "@deepseek-ai"));
  const profiles = join(home, "profiles");
  if (existsSync(profiles)) {
    for (const d of readdirSync(profiles, { withFileTypes: true })) {
      if (d.isDirectory()) push(join(profiles, d.name, "node_modules", "@deepseek-ai"));
    }
  }
  push(join(home, "dsh-pinned", "node_modules", "@deepseek-ai"));

  const execRoot = dirname(process.execPath);
  push(join(execRoot, "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai"));
  push(join(execRoot, "node_modules", "@deepseek-ai"));

  const npxRoot = join(local, "npm-cache", "_npx");
  if (existsSync(npxRoot)) {
    for (const d of readdirSync(npxRoot, { withFileTypes: true })) {
      if (d.isDirectory()) push(join(npxRoot, d.name, "node_modules", "@deepseek-ai"));
    }
  }

  push(join(local, "Programs", "DSH Desktop", "resources", "app.asar.unpacked", "node_modules", "@deepseek-ai"));
  return trees;
}

const versionCache = new Map();

/** package.json version of the bundle owning `rel`, or null when unknown. */
function packageVersion(tree, rel) {
  const pkgName = rel.split("/")[0];
  const key = `${tree}\u0000${pkgName}`;
  if (versionCache.has(key)) return versionCache.get(key);
  const pkgJson = join(tree, pkgName, "package.json");
  let version = null;
  if (existsSync(pkgJson)) {
    try {
      version = JSON.parse(readFileSync(pkgJson, "utf8").replace(/^\uFEFF/, "")).version ?? null;
    } catch {
      version = null;
    }
  }
  versionCache.set(key, version);
  return version;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Apply the overlay patch-set. Idempotent and version-guarded.
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] - report only, change nothing.
 * @param {boolean} [opts.quiet] - suppress per-file chatter.
 * @param {string[]} [opts.trees] - override the candidate tree list.
 * @returns {{trees:number, changed:number, intact:number, skippedMissing:number, skippedVersion:number, backupDir:string}}
 */
export function applyOverlay({ dryRun = false, quiet = false, trees } = {}) {
  const log = quiet ? () => {} : (msg) => console.log(msg);
  const treeList = trees ?? candidateTrees();
  if (!existsSync(overlayRoot)) {
    log(`[apply-overlay] overlay not found at ${overlayRoot} — nothing to do`);
    return {
      trees: treeList.filter(existsSync).length,
      changed: 0,
      intact: 0,
      skippedMissing: 0,
      skippedVersion: 0,
      backupDir: "",
    };
  }
  const overlayFiles = walkFiles(overlayRoot);
  const backupDir = dryRun ? "" : join(pkgRoot, "backup", timestamp());
  let changed = 0;
  let intact = 0;
  let missing = 0;
  let versionSkipped = 0;
  let activeTrees = 0;
  const detail = [];

  for (const tree of treeList) {
    if (!existsSync(tree)) continue;
    activeTrees += 1;
    let treeChanged = 0;
    for (const rel of overlayFiles) {
      const parts = rel.split("/");
      const source = join(overlayRoot, ...parts);
      const target = join(tree, ...parts);
      if (!existsSync(target)) {
        missing += 1;
        continue;
      }
      const ver = packageVersion(tree, rel);
      if (ver !== EXPECTED_DSH_VERSION) {
        versionSkipped += 1;
        detail.push(`SKIP(version ${ver ?? "unknown"} != ${EXPECTED_DSH_VERSION}) ${rel}`);
        continue;
      }
      if (sha256(target) === sha256(source)) {
        intact += 1;
        continue;
      }
      changed += 1;
      treeChanged += 1;
      if (!dryRun) {
        mkdirSync(join(backupDir, dirname(rel)), { recursive: true });
        writeFileSync(join(backupDir, rel), readFileSync(target));
        writeFileSync(target, readFileSync(source));
      }
    }
    if (treeChanged > 0) log(`patched ${treeChanged} bundle(s) in ${tree}`);
  }

  const summary = {
    trees: activeTrees,
    changed,
    intact,
    skippedMissing: missing,
    skippedVersion: versionSkipped,
    backupDir: dryRun || changed === 0 ? "" : backupDir,
  };
  log(`[apply-overlay] done: ${JSON.stringify(summary)}${dryRun ? " (dry-run)" : ""}`);
  if (!quiet && detail.length > 0) {
    for (const line of detail.slice(0, 20)) log(`  ${line}`);
    if (detail.length > 20) log(`  … and ${detail.length - 20} more`);
  }
  if (versionSkipped > 0) {
    log(
      `[apply-overlay] WARNING: overlay targets @deepseek-ai/dsh ${EXPECTED_DSH_VERSION}; ` +
        "skipped incompatible trees — upgrade the overlay or install the matching DSH version.",
    );
  }
  return summary;
}

// ---- CLI ----
// 仅当本文件是进程主模块时才执行命令行解析。作为模块被 lib/index.js
// import 时（applyOverlay 的正规用法）跳过：宿主进程的 argv（如
// `dsh web` 的 "web"）不是本脚本的参数，解析它会误杀宿主。
const invokedAsCliMain = process.argv[1] !== void 0 && process.argv[1] !== null
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCliMain) {

  const args = process.argv.slice(2);
  const treeArgs = [];
  let dryRun = false;
  let quiet = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--tree") {
      i += 1;
      treeArgs.push(args[i]);
    }
    else {
      console.error(`[apply-overlay] unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  try {
    applyOverlay({ dryRun, quiet, trees: treeArgs.length > 0 ? treeArgs : undefined });
  } catch (err) {
    console.error(`[apply-overlay] failed: ${err.message}`);
    process.exit(1);
  }

}
