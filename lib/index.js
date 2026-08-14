import { Service } from "cordis";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export const name = "workspaceEnhance";

export const inject = [];

/**
 * Host half of dsh-workspace-enhance.
 *
 * The functional changes of this plugin are an overlay patch-set applied over
 * the official @deepseek-ai/dsh-* bundles (see scripts/install.ps1) because the
 * touched surfaces (the apiproxy RPC map, the workspace registry, the workspace
 * browser UI) are not extensible from an additive plugin. This service is a
 * standard Cordis entry point: it keeps the package discoverable in the DSH
 * plugin inventory and reports the installed overlay state.
 */
class WorkspaceEnhanceService extends Service {
  constructor(ctx) {
    super(ctx, name, false);
  }

  async [Service.init]() {
    this.ctx.provide("workspaceEnhance", {
      version: pkg.version,
      features: [
        "recycle-bin",
        "cross-workspace-drag",
        "ungrouped-sessions",
        "multi-folder-roots",
        "in-app-directory-picker",
        "session-merge",
        "row-icons",
        "file-preview"
      ]
    });
    if (typeof console !== "undefined") {
      console.info(`[dsh-workspace-enhance] ${pkg.version} host half loaded; run scripts/install.ps1 to apply the overlay patch-set`);
    }
  }
}

export default WorkspaceEnhanceService;
