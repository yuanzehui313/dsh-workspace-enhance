window.__ModuleLoader__.load({
	id: "dsh-workspace-enhance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		/** Required services: the slot registry (shell.overlay seat for the cost widget). */
		const inject = ["slots"];
		const FEATURES = [
			"recycle-bin",
			"cross-workspace-drag",
			"ungrouped-sessions",
			"multi-folder-roots",
			"in-app-directory-picker",
			"session-merge",
			"row-icons",
			"file-preview",
			"daily-cost-meter"
		];
		/**
		 * Client half of dsh-workspace-enhance. The deep UI changes ship through
		 * the overlay patch-set (scripts/apply-overlay.mjs replaces the official
		 * dsh-client-ui-workspace / dsh-client-ui-sidebar bundles); this factory
		 * keeps the plugin visible in the DSH plugin inventory, exposes a
		 * `ctx.workspaceEnhance` capability marker, and mounts the daily cost
		 * meter widget into the frame-wide `shell.overlay` seat (top-right chip,
		 * data from GET /cost-meter/daily).
		 */
		function apply(ctx) {
			ctx.provide("workspaceEnhance", {
				version: "1.0.0",
				features: FEATURES
			});
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({ name: "shell.overlay", id: "dsh-cost-meter", order: 100, label: "每日费用" },
					() => react.createElement(CostMeterWidget)
				)
			);
		}

		// ---------- 每日费用小组件（右上角） ----------

		function fmt(n) {
			return Number(n ?? 0).toLocaleString("zh-CN");
		}

		function fmtUsd(n) {
			return Number(n ?? 0).toFixed(2);
		}

		function fmtCny(n) {
			return Number(n ?? 0).toFixed(2);
		}

		const cellRight = { textAlign: "right", padding: "2px 4px" };
		const cellLeft = { textAlign: "left", padding: "2px 4px" };
		const thDim = { opacity: 0.6, textAlign: "right", padding: "2px 4px", fontWeight: 600 };
		const thLeft = { opacity: 0.6, textAlign: "left", padding: "2px 4px", fontWeight: 600 };

		function CostMeterWidget() {
			const [value, setValue] = react.useState(null);
			const [failed, setFailed] = react.useState("");
			const [open, setOpen] = react.useState(false);

			const refresh = react.useCallback(async () => {
				try {
					const res = await fetch("/cost-meter/daily", {
						cache: "no-store",
						headers: { accept: "application/json" }
					});
					if (!res.ok) throw new Error("HTTP " + res.status);
					const payload = await res.json();
					if (!payload || payload.ok !== true) {
						throw new Error(payload?.error?.message ?? "bad envelope");
					}
					setValue(payload.value ?? null);
					setFailed("");
				} catch (err) {
					setFailed(err.message ?? "unknown");
				}
			}, []);

			react.useEffect(() => {
				refresh();
				const timer = setInterval(refresh, 60000);
				return () => clearInterval(timer);
			}, [refresh]);

			const today = value?.today;
			const week = value?.week ?? [];
			const costCny = Number(today?.totals?.costCny ?? 0);
			const costUsd = Number(today?.totals?.costUsd ?? 0);

			const chipLabel = failed
				? "费用 —"
				: today
					? "今日 ¥" + fmtCny(costCny)
					: "费用 …";

			const modelRows = [];
			if (today) {
				for (const entry of Object.entries(today.models ?? {})) {
					const model = entry[0];
					const m = entry[1];
					modelRows.push(
						react.createElement("tr", { key: model },
							react.createElement("td", cellLeft, model),
							react.createElement("td", cellRight, fmt(m.requests)),
							react.createElement("td", cellRight, fmt(m.input)),
							react.createElement("td", cellRight, fmt(m.cacheRead)),
							react.createElement("td", cellRight, fmt(m.output)),
							react.createElement("td", cellRight, "¥" + fmtCny(m.costCny))
						)
					);
				}
			}

			const weekRows = [];
			for (const d of [...week].reverse()) {
				weekRows.push(
					react.createElement("tr", { key: d.date },
						react.createElement("td", cellLeft, d.date),
						react.createElement("td", cellRight, fmt(d.requests)),
						react.createElement("td", cellRight, fmt(d.totals?.tokens ?? 0)),
						react.createElement("td", cellRight, "¥" + fmtCny(d.totals?.costCny ?? 0))
					)
				);
			}

			const panel = react.createElement(
				"div",
				{
					style: {
						display: open ? "block" : "none",
						marginTop: 6,
						width: 440,
						maxWidth: "calc(100vw - 32px)",
						maxHeight: "70vh",
						overflow: "auto",
						background: "var(--dsw-alias-bg-elevated, rgba(20,20,26,.94))",
						color: "var(--dsw-alias-label-primary, #eee)",
						border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
						borderRadius: 12,
						boxShadow: "0 8px 30px rgba(0,0,0,.35)",
						backdropFilter: "blur(12px)"
					}
				},
				react.createElement("div", {
					style: {
						padding: "10px 12px",
						borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
						fontWeight: 600
					}
				},
					"今日费用 ¥" + fmtCny(costCny),
					react.createElement("span", { style: { fontWeight: 400, opacity: 0.75 } },
						"(≈$" + fmtUsd(costUsd) + " · " + fmt(today?.totals?.tokens ?? 0) + " tokens · " + fmt(today?.requests ?? 0) + " 请求)"
					)
				),
				failed
					? react.createElement("div", { style: { padding: "10px 12px" } }, "加载失败：" + failed)
					: react.createElement(
						react.Fragment,
						null,
						react.createElement("div", { style: { padding: "6px 12px", opacity: 0.8 } }, "按模型"),
						react.createElement(
							"table",
							{ style: { width: "100%", borderCollapse: "collapse", fontSize: 11 } },
							react.createElement("thead", null,
								react.createElement("tr", null,
									react.createElement("th", thLeft, "模型"),
									react.createElement("th", thDim, "请求"),
									react.createElement("th", thDim, "输入"),
									react.createElement("th", thDim, "缓存"),
									react.createElement("th", thDim, "输出"),
									react.createElement("th", thDim, "费用")
								)
							),
							react.createElement("tbody", null,
								modelRows.length
									? modelRows
									: react.createElement("tr", null,
										react.createElement("td", { colSpan: 6, style: { padding: "6px 12px", opacity: 0.7 } }, "今日暂无用量")
									)
							)
						),
						react.createElement("div", {
							style: { padding: "6px 12px", opacity: 0.8, borderTop: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2))" }
						}, "近 7 天"),
						react.createElement(
							"table",
							{ style: { width: "100%", borderCollapse: "collapse", fontSize: 11 } },
							react.createElement("thead", null,
								react.createElement("tr", null,
									react.createElement("th", thLeft, "日期"),
									react.createElement("th", thDim, "请求"),
									react.createElement("th", thDim, "Tokens"),
									react.createElement("th", thDim, "费用")
								)
							),
							react.createElement("tbody", null, weekRows)
						),
						react.createElement("div", {
							style: { padding: "6px 12px", opacity: 0.5, fontSize: 10 }
						}, "单价见 ~/.dsh/cost-meter/config.json · 60s 自动刷新")
					)
			);

			const chip = react.createElement(
				"button",
				{
					type: "button",
					title: failed
						? "每日费用统计加载失败"
						: today
							? "今日费用 ¥" + fmtCny(costCny) + " ≈ $" + fmtUsd(costUsd) + "（点击展开明细）"
							: "每日费用统计（点击展开）",
					onClick: () => setOpen(!open),
					style: {
						background: "var(--dsw-alias-interactive-bg-hover-solid, rgba(15,15,20,.82))",
						color: "var(--dsw-alias-label-primary, #eee)",
						border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))",
						borderRadius: 999,
						padding: "4px 12px",
						cursor: "pointer",
						backdropFilter: "blur(8px)",
						boxShadow: "0 2px 10px rgba(0,0,0,.25)",
						whiteSpace: "nowrap",
						font: "12px/1.5 system-ui,-apple-system,sans-serif",
						pointerEvents: "auto"
					}
				},
				chipLabel
			);

			return react.createElement(
				"div",
				{
					"data-dsh-cost-meter": true,
					style: {
						position: "absolute",
						top: 10,
						right: 12,
						display: "flex",
						flexDirection: "column",
						alignItems: "flex-end",
						font: "12px/1.5 system-ui,-apple-system,sans-serif",
						pointerEvents: "auto"
					}
				},
				chip,
				panel
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.FEATURES = FEATURES;
		return module.exports;
	}
});
