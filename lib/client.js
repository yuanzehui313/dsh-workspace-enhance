window.__ModuleLoader__.load({
	id: "dsh-workspace-enhance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const inject = [];
		const FEATURES = [
			"recycle-bin",
			"cross-workspace-drag",
			"ungrouped-sessions",
			"multi-folder-roots",
			"in-app-directory-picker",
			"session-merge",
			"row-icons"
		];
		/**
		 * Client half of dsh-workspace-enhance. The deep UI changes ship through
		 * the overlay patch-set (scripts/install.ps1 replaces the official
		 * dsh-client-ui-workspace / dsh-client-ui-sidebar bundles); this factory
		 * keeps the plugin visible in the DSH plugin inventory and exposes a
		 * `ctx.workspaceEnhance` capability marker other plugins can probe.
		 */
		function apply(ctx) {
			ctx.provide("workspaceEnhance", {
				version: "1.0.0",
				features: FEATURES
			});
			if (typeof console !== "undefined") console.info("[dsh-workspace-enhance] client plugin loaded");
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.FEATURES = FEATURES;
		return module.exports;
	}
});
