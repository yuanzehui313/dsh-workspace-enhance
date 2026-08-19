import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export const name = "workspaceEnhance";

export const inject = [];

/**
 * Host half of dsh-workspace-enhance — a zero-dependency functional Cordis
 * plugin (no `cordis` import). The functional changes of this plugin are an
 * overlay patch-set applied over the official @deepseek-ai/dsh-* bundles (see
 * scripts/install.ps1) because the touched surfaces (the apiproxy RPC map, the
 * workspace registry, the workspace browser UI) are not extensible from an
 * additive plugin. This entry keeps the package discoverable in the DSH plugin
 * inventory and exposes a `ctx.workspaceEnhance` capability marker other
 * plugins can probe.
 */
export function apply(ctx) {
  ctx.provide("workspaceEnhance", {
    version: pkg.version,
    features: [
      "recycle-bin",
      "cross-workspace-drag",
      "ungrouped-sessions",
      "multi-folder-roots",
      "in-app-directory-picker",
      "session-merge",
      "row-icons",
      "file-preview",
      "cross-session-memory"
    ]
  });
  if (typeof console !== "undefined") {
    console.info(`[dsh-workspace-enhance] ${pkg.version} host half loaded; run scripts/install.ps1 to apply the overlay patch-set`);
  }
}
