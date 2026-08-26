import { createRequire } from "node:module";
import { applyOverlay } from "../scripts/apply-overlay.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export const name = "workspaceEnhance";

export const inject = [];

/**
 * Host half of dsh-workspace-enhance — a zero-dependency functional Cordis
 * plugin (no `cordis` import). The functional changes of this plugin are an
 * overlay patch-set applied over the official @deepseek-ai/dsh-* bundles (see
 * scripts/apply-overlay.mjs) because the touched surfaces (the apiproxy RPC
 * map, the workspace registry, the workspace browser UI, the conversation
 * paste pipeline) are not extensible from an additive plugin.
 *
 * On load the overlay is applied automatically (idempotent, version-guarded,
 * with backups) so that a plain package install — npm postinstall or a manual
 * link — leaves the features live on every known DSH bundle tree. If this is
 * the very first load after patching, one DSH restart is required for the new
 * bundle code to be imported.
 */
export function apply(ctx) {
  let summary;
  try {
    summary = applyOverlay({ quiet: true });
  } catch (err) {
    summary = { error: err.message };
  }
  console.info(
    `[dsh-workspace-enhance] ${pkg.version} overlay auto-apply: ${JSON.stringify(summary)}` +
      (summary.error ? "" : " — 若功能未生效，请重启 DSH 服务后 Ctrl+Shift+R 强刷页面"),
  );
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
      "unrestricted-attachments",
      "paste-images-md-files",
      "cross-session-memory"
    ]
  });
}
