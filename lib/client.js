/** dsh-plugin-usage-stats 浏览器半（手写 __ModuleLoader__ 工厂，无构建链）：
 *  右侧栏「用量」tab —— 全局模型 token 用量与费用面板。
 *
 *  要点（与设计文档一致）：
 *  - 形态 = window.__ModuleLoader__.load({id, factory})，与官方 lib/client.js 同格式；
 *    只用基线模块表（react 等），无 JSX（React.createElement），故无需构建。
 *  - ctx.remote 官方装配是 build 期固定能力集，不会带 usageStats 命名空间：
 *    本包自己 ctx.remote.$mount(CONTRIBUTION) 挂手写 strict descriptor
 *    （参数 codec 的 schema.parse 为透传，服务端 SRC 模式做 JSON-safe 校验；结果客户端不校验）。
 *  - 入口：注册 sidebarRightTabs 页面型 tab（kind=usage，无 patterns，guide 胶囊打开）。
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-usage-stats",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var h = React.createElement;
		var useState = React.useState;
		var useEffect = React.useEffect;
		var useCallback = React.useCallback;
		var useRef = React.useRef;

		var TAB_ID = "dsh-plugin-usage-stats";
		var TAB_KIND = "usage";

		/* ---------- Remote contribution（手写 strict 描述符；与 src/cordis.ts 的 SRC 方法名一一对应） ---------- */
		var passthrough = { parse: function (v) { return v === undefined ? {} : v; } };
		function codec(sym) { return { mode: "strict", typeSymbol: "dsh-plugin-usage-stats#" + sym, schema: passthrough }; }
		function descriptor(method, param) {
			return {
				id: TAB_ID + "#usageStats/" + method,
				service: "usageStats",
				namespace: "usageStats",
				method: method,
				invocation: { kind: "direct" },
				parameters: [{ name: param, wire: param, source: "json", codec: codec(method + ":" + param) }],
				result: codec(method + ":result")
			};
		}
		var CONTRIBUTION = {
			package: TAB_ID,
			descriptors: [descriptor("overview", "filter"), descriptor("drillSessions", "query")]
		};

		/* ---------- 样式（materialize 时注入一次） ---------- */
		var CSS = [
			".usg-root{display:flex;flex-direction:column;gap:12px;padding:12px;overflow:auto;height:100%;box-sizing:border-box;font-size:13px;color:var(--dsw-alias-label-primary)}",
			".usg-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
			".usg-seg{display:inline-flex;border:1px solid var(--dsw-alias-separator);border-radius:6px;overflow:hidden}",
			".usg-seg>button{all:unset;cursor:pointer;padding:3px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".usg-seg>button[aria-pressed=true]{background:var(--dsw-alias-fill-quinary);color:var(--dsw-alias-label-primary)}",
			".usg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}",
			".usg-kpi{border:1px solid var(--dsw-alias-separator);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}",
			".usg-kpi b{font-size:17px;font-weight:600}",
			".usg-kpi span{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			".usg-table{width:100%;border-collapse:collapse;font-size:12px}",
			".usg-table th{text-align:right;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:4px 6px;border-bottom:1px solid var(--dsw-alias-separator);white-space:nowrap}",
			".usg-table td{text-align:right;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-separator);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".usg-table th:first-child,.usg-table td:first-child{text-align:left}",
			".usg-table tr[role=button]{cursor:pointer}",
			".usg-table tr[role=button]:hover td{background:var(--dsw-alias-fill-quinary)}",
			".usg-table tr.usg-on td{background:var(--dsw-alias-fill-quaternary)}",
			".usg-muted{color:var(--dsw-alias-label-tertiary)}",
			".usg-err{color:var(--dsw-alias-label-red,crimson);padding:8px;border:1px solid currentColor;border-radius:8px}",
			".usg-chart{display:flex;align-items:flex-end;gap:2px;height:90px;padding:4px 0}",
			".usg-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;min-width:6px}",
			".usg-colbar{border-radius:2px 2px 0 0;background:var(--dsw-alias-fill-quaternary)}",
			".usg-chip{font-size:12px;padding:0 2px}",
			".usg-btn{all:unset;cursor:pointer;padding:3px 10px;border:1px solid var(--dsw-alias-separator);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".usg-btn:hover{color:var(--dsw-alias-label-primary)}",
			".usg-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-top:2px}",
			".usg-sess-title{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}"
		].join("\n");
		var cssDone = false;
		function ensureCss() {
			if (cssDone || typeof document === "undefined") return;
			cssDone = true;
			var el = document.createElement("style");
			el.setAttribute("data-plugin", TAB_ID);
			el.textContent = CSS;
			document.head.appendChild(el);
		}

		/* ---------- 格式化 ---------- */
		function fmt(n) {
			if (typeof n !== "number" || !isFinite(n)) return "—";
			if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
			if (n >= 1e4) return (n / 1e3).toFixed(0) + "k";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
			return String(Math.round(n));
		}
		function fmtPct(r) { return r === null || r === undefined ? "—" : (r * 100).toFixed(1) + "%"; }
		function fmtCost(c) { return c === null || c === undefined ? "—" : "¥" + (c >= 100 ? c.toFixed(0) : c >= 1 ? c.toFixed(2) : c.toFixed(4)); }
		function fmtTime(ms) {
			if (!ms) return "—";
			var d = new Date(ms);
			var p = function (n) { return (n < 10 ? "0" : "") + n; };
			return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
		}
		function localYmd(d) {
			var p = function (n) { return (n < 10 ? "0" : "") + n; };
			return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
		}
		function rangeToFilter(range) {
			var now = new Date();
			if (range === "all") return {};
			var days = range === "today" ? 0 : range === "7d" ? 6 : 29;
			var from = new Date(now.getTime() - days * 864e5);
			return { from: localYmd(from), to: localYmd(now) };
		}
		var RANGES = [["today", "今天"], ["7d", "7 天"], ["30d", "30 天"], ["all", "全部"]];

		/* ---------- 面板 ---------- */
		function UsagePanel(props) {
			var ctx = props.ctx;
			var mounted = props.mounted;
			var _r = useState("30d"), range = _r[0], setRange = _r[1];
			var _d = useState(null), data = _d[0], setData = _d[1];
			var _e = useState(null), err = _e[0], setErr = _e[1];
			var _l = useState(false), loading = _l[0], setLoading = _l[1];
			var _m = useState(null), modelFilter = _m[0], setModelFilter = _m[1];
			var _s = useState(null), drill = _s[0], setDrill = _s[1];
			var _t = useState(0), tick = _t[0], setTick = _t[1];
			var alive = useRef(0);

			var load = useCallback(async function () {
				var my = ++alive.current;
				setLoading(true);
				setErr(null);
				try {
					await mounted;
					var f = rangeToFilter(range);
					var ov = await ctx.remote.usageStats.overview(f);
					if (!ov.ok) throw new Error(ov.error.message);
					if (alive.current !== my) return;
					setData(ov.value);
					var dq = Object.assign({}, f, { limit: 15, offset: 0 });
					if (modelFilter) dq.model = modelFilter;
					var dr = await ctx.remote.usageStats.drillSessions(dq);
					if (!dr.ok) throw new Error(dr.error.message);
					if (alive.current !== my) return;
					setDrill(dr.value);
				} catch (e) {
					if (alive.current === my) setErr(String((e && e.message) || e));
				} finally {
					if (alive.current === my) setLoading(false);
				}
			}, [ctx, mounted, range, modelFilter]);

			useEffect(function () { load(); }, [load, tick]);

			var kpi = function (label, value, sub) {
				return h("div", { className: "usg-kpi" }, h("b", null, value), h("span", null, label), sub ? h("span", { className: "usg-muted" }, sub) : null);
			};

			var t = data && data.totals;
			var maxDay = data && data.byDay && data.byDay.length ? Math.max.apply(null, data.byDay.map(function (d) { return d.total; })) : 0;

			var chart = data && data.byDay && data.byDay.length
				? h("div", { className: "usg-chart" }, data.byDay.slice(-30).map(function (d) {
					var pct = maxDay > 0 ? Math.max(2, Math.round((d.total / maxDay) * 100)) : 2;
					return h("div", {
						className: "usg-col", key: d.date, title: d.date + "｜tokens " + fmt(d.total) + "｜" + d.requests + " req" + (d.cost !== null && d.cost !== undefined ? "｜" + fmtCost(d.cost) : "")
					}, h("div", { className: "usg-colbar", style: { height: pct + "%" } }));
				}))
				: null;

			return h("div", { className: "usg-root" },
				h("div", { className: "usg-bar" },
					h("div", { className: "usg-seg" }, RANGES.map(function (r) {
						return h("button", { key: r[0], "aria-pressed": range === r[0], onClick: function () { setRange(r[0]); } }, r[1]);
					})),
					h("span", { style: { flex: 1 } }),
					loading ? h("span", { className: "usg-muted" }, "加载中…") : null,
					h("button", { className: "usg-btn", onClick: function () { setTick(function (x) { return x + 1; }); }, disabled: loading }, "刷新")
				),
				err ? h("div", { className: "usg-err" }, "读取失败：" + err) : null,
				data ? h("div", { className: "usg-kpis" },
					kpi("总 tokens（含缓存）", fmt(data.totals.total), data.totals.requests + " 次请求 · " + data.sessionCount + " 会话"),
					kpi("输入（未缓存）", fmt(t.input)),
					kpi("输出", fmt(t.output)),
					kpi("缓存读", fmt(t.cacheRead), "命中率 " + fmtPct(data.hitRate)),
					kpi("预估费用", data.priced ? fmtCost(data.cost) : "未配置价目", data.priced ? "" : "在 profile patch 配 prices")
				) : null,
				chart ? h("div", null, h("div", { className: "usg-title" }, "按天用量（近 30 天）"), chart) : null,
				data ? h("div", null,
					h("div", { className: "usg-title" }, "按模型" + (modelFilter ? "（已筛选 " + modelFilter + "，点同模型取消）" : "（点行筛选下钻）")),
					h("table", { className: "usg-table" },
						h("thead", null, h("tr", null, h("th", null, "模型"), h("th", null, "请求"), h("th", null, "输入"), h("th", null, "输出"), h("th", null, "缓存读"), h("th", null, "命中率"), h("th", null, "费用"))),
						h("tbody", null, data.byModel.map(function (m) {
							return h("tr", {
								key: m.key, role: "button",
								className: modelFilter === m.key ? "usg-on" : "",
								onClick: function () { setModelFilter(modelFilter === m.key ? null : m.key); }
							},
								h("td", null, m.key), h("td", null, fmt(m.requests)), h("td", null, fmt(m.input)),
								h("td", null, fmt(m.output)), h("td", null, fmt(m.cacheRead)), h("td", null, fmtPct(m.hitRate)), h("td", null, fmtCost(m.cost)));
						}))
					)
				) : null,
				drill ? h("div", null,
					h("div", { className: "usg-title" }, "会话下钻（" + drill.rows.length + " / " + drill.total + "）"),
					h("table", { className: "usg-table" },
						h("thead", null, h("tr", null, h("th", null, "会话"), h("th", null, "tokens"), h("th", null, "请求"), h("th", null, "命中率"), h("th", null, "费用"), h("th", null, "最近"))),
						h("tbody", null, drill.rows.map(function (r) {
							return h("tr", { key: r.sessionId, title: (r.cwd || "") + "\n" + r.sessionId },
								h("td", { className: "usg-sess-title" }, (r.subagent ? "⤷ " : "") + (r.title || r.sessionId.slice(0, 13))),
								h("td", null, fmt(r.total)), h("td", null, fmt(r.requests)), h("td", null, fmtPct(r.hitRate)), h("td", null, fmtCost(r.cost)), h("td", { className: "usg-muted" }, fmtTime(r.lastTime)));
						}))
					),
					drill.rows.length < drill.total
						? h("div", { style: { marginTop: 6 } }, h("button", {
							className: "usg-btn",
							onClick: function () {
								var next = drill.rows.length;
								ctx.remote.usageStats.drillSessions(Object.assign({}, rangeToFilter(range), {
									model: modelFilter || undefined, limit: 15, offset: next
								})).then(function (more) {
									if (more.ok) setDrill({ rows: drill.rows.concat(more.value.rows), total: drill.total });
								});
							}
						}, "加载更多"))
						: null
				) : null,
				data ? h("div", { className: "usg-muted" }, "扫描 " + data.scannedFiles + " 个会话文件 · 数据截至 " + new Date(data.generatedAt).toLocaleTimeString()) : null
			);
		}

		function TabTitle() { return h("span", { className: "usg-chip" }, "用量"); }

		/* ---------- cordis 客户端插件入口 ---------- */
		var inject = ["slots", "sidebarRightTabs", "remote"];

		function apply(ctx) {
			ensureCss();
			var mounted = ctx.remote.$mount(CONTRIBUTION).then(function (dispose) {
				return dispose;
			}, function (e) {
				// 挂载失败让面板报错，而不是炸整页
				return Promise.reject(e);
			});
			ctx.effect(function () { return ctx.sidebarRightTabs.register({
				id: TAB_ID,
				kind: TAB_KIND,
				title: function () { return "用量"; },
				guide: [{ order: 40, title: function () { return "用量统计"; }, description: function () { return "全局模型 token 用量与命中率" } }]
			}); }, "usage-stats: tab type");
			ctx.effect(function () { return ctx.slots.inject("sidebar.right.pane.tab", function () {
				return ctx.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, function () {
					return h(UsagePanel, { ctx: ctx, mounted: mounted });
				});
			}); }, "usage-stats: tab body");
			ctx.effect(function () { return ctx.slots.inject("sidebar.right.pane.tab.title", function () {
				return ctx.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, TabTitle);
			}); }, "usage-stats: tab title");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
