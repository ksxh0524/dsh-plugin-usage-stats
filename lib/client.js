/** dsh-plugin-usage-stats 浏览器半（手写 __ModuleLoader__ 工厂，无构建链），v2 两级形态：
 *  ① 右侧栏「用量」tab = **当前会话**视图（消息数/四路 token/命中率/按模型/费用），
 *     sessionId 直接取 `sidebar.right.pane.tab` slot 的 session-scope 标准 prop（官方 sidebar-files FilesBody 同款）；
 *  ② 「设置 → 插件 → 插件配置」卡 = **全局**报表（时间筛选 + KPI + 按模型 + 价目只读摘要），
 *     注册 key 必须 === settings 命名空间 "usage-stats"（宿主派发 = 已注册命名空间 ∩ 同 key 卡）。
 *
 *  要点（与设计文档一致）：
 *  - 形态 = window.__ModuleLoader__.load({id, factory})，与官方 lib/client.js 同格式；
 *    只用基线模块表（react），无 JSX（React.createElement），故无需构建。
 *  - ctx.remote 官方装配是 build 期固定能力集，不带 usageStats 命名空间：
 *    本包自己 ctx.remote.$mount(CONTRIBUTION) 挂手写 strict descriptor
 *    （参数 codec 的 schema.parse 为透传，服务端 SRC 模式做 JSON-safe 校验；结果客户端不校验）。
 *  - 两端契约：descriptors 与 src/cordis.ts 的 SRC 方法/参数名一一对应，改名须同步。
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
		/** settings 命名空间（src/settings.ts USAGE_STATS_SETTINGS_NS 的镜像；设置卡 slot key）。 */
		var SETTINGS_NS = "usage-stats";

		/* ---------- Remote contribution（手写 strict 描述符；与 src/cordis.ts 的 SRC 方法名一一对应） ---------- */
		var passthrough = {
			parse: function (v) {
				return v === undefined ? {} : v;
			},
		};
		function codec(sym) {
			return { mode: "strict", typeSymbol: "dsh-plugin-usage-stats#" + sym, schema: passthrough };
		}
		function descriptor(method, param) {
			return {
				id: TAB_ID + "#usageStats/" + method,
				service: "usageStats",
				namespace: "usageStats",
				method: method,
				invocation: { kind: "direct" },
				parameters: [{ name: param, wire: param, source: "json", codec: codec(method + ":" + param) }],
				result: codec(method + ":result"),
			};
		}
		var CONTRIBUTION = {
			package: TAB_ID,
			descriptors: [descriptor("overview", "filter"), descriptor("drillSessions", "query"), descriptor("sessionUsage", "query")],
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
			".usg-muted{color:var(--dsw-alias-label-tertiary)}",
			".usg-err{color:var(--dsw-alias-label-red,crimson);padding:8px;border:1px solid currentColor;border-radius:8px}",
			".usg-chip{font-size:12px;padding:0 2px}",
			".usg-btn{all:unset;cursor:pointer;padding:3px 10px;border:1px solid var(--dsw-alias-separator);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".usg-btn:hover{color:var(--dsw-alias-label-primary)}",
			".usg-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-top:2px}",
			".usg-sess-title{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}",
			".usg-head{display:flex;flex-direction:column;gap:2px;min-width:0}",
			".usg-head b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".usg-badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:8px;border:1px solid var(--dsw-alias-separator);color:var(--dsw-alias-label-tertiary);margin-left:6px;vertical-align:2px}",
			".usg-date{background:transparent;color:inherit;border:1px solid var(--dsw-alias-separator);border-radius:6px;padding:2px 6px;font-size:12px;color-scheme:normal}",
			/* 设置页全局卡：宿主「插件配置」列表内自绘轻量卡（不套官方 staged-form 机制） */
			".usg-card{list-style:none;border:1px solid var(--dsw-alias-separator);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:760px;box-sizing:border-box}",
			".usg-card>header b{font-size:14px;font-weight:600}",
			".usg-card>header .usg-muted{display:block;margin-top:2px}",
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
		function fmtPct(r) {
			return r === null || r === undefined ? "—" : (r * 100).toFixed(1) + "%";
		}
		function fmtCost(c) {
			return c === null || c === undefined ? "—" : "¥" + (c >= 100 ? c.toFixed(0) : c >= 1 ? c.toFixed(2) : c.toFixed(4));
		}
		function fmtTime(ms) {
			if (!ms) return "—";
			var d = new Date(ms);
			var p = function (n) {
				return (n < 10 ? "0" : "") + n;
			};
			return d.getMonth() + 1 + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
		}
		function localYmd(d) {
			var p = function (n) {
				return (n < 10 ? "0" : "") + n;
			};
			return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
		}
		function rangeToFilter(range) {
			var now = new Date();
			if (range === "all") return {};
			var days = range === "today" ? 0 : range === "7d" ? 6 : 29;
			var from = new Date(now.getTime() - days * 864e5);
			return { from: localYmd(from), to: localYmd(now) };
		}
		var RANGES = [
			["today", "今天"],
			["7d", "7 天"],
			["30d", "30 天"],
			["all", "全部"],
		];

		function kpi(label, value, sub) {
			return h("div", { className: "usg-kpi" }, h("b", null, value), h("span", null, label), sub ? h("span", { className: "usg-muted" }, sub) : null);
		}
		/** 按模型小表（面板与全局卡共用）。 */
		function modelTable(rows) {
			return h(
				"table",
				{ className: "usg-table" },
				h(
					"thead",
					null,
					h(
						"tr",
						null,
						h("th", null, "模型"),
						h("th", null, "请求"),
						h("th", null, "输入"),
						h("th", null, "输出"),
						h("th", null, "缓存读"),
						h("th", null, "命中率"),
						h("th", null, "费用"),
					),
				),
				h(
					"tbody",
					null,
					rows.map(function (m) {
						return h(
							"tr",
							{ key: m.key },
							h("td", { className: "usg-sess-title", title: m.key }, m.key),
							h("td", null, fmt(m.requests)),
							h("td", null, fmt(m.input)),
							h("td", null, fmt(m.output)),
							h("td", null, fmt(m.cacheRead)),
							h("td", null, fmtPct(m.hitRate)),
							h("td", null, fmtCost(m.cost)),
						);
					}),
				),
			);
		}

		/* ---------- 面板：当前会话（sessionId = slot session-scope 标准 prop，切会话自动重载） ---------- */
		function SessionPanel(props) {
			var ctx = props.ctx;
			var mounted = props.mounted;
			var sessionId = props.sessionId;
			var _d = useState(null),
				data = _d[0],
				setData = _d[1];
			var _e = useState(null),
				err = _e[0],
				setErr = _e[1];
			var _l = useState(false),
				loading = _l[0],
				setLoading = _l[1];
			var _t = useState(0),
				tick = _t[0],
				setTick = _t[1];
			var alive = useRef(0);

			var load = useCallback(
				async function () {
					if (!sessionId) {
						setData(null);
						setErr(null);
						return;
					}
					var my = ++alive.current;
					setLoading(true);
					setErr(null);
					try {
						await mounted;
						var r = await ctx.remote.usageStats.sessionUsage({ sessionId: sessionId });
						if (!r.ok) throw new Error(r.error.message);
						if (alive.current === my) setData(r.value);
					} catch (e) {
						if (alive.current === my) setErr(String((e && e.message) || e));
					} finally {
						if (alive.current === my) setLoading(false);
					}
				},
				[ctx, mounted, sessionId],
			);

			// 切会话即清旧数据，防新会话渲染前闪现上一个的残影。
			useEffect(
				function () {
					setData(null);
					setErr(null);
				},
				[sessionId],
			);
			useEffect(
				function () {
					load();
				},
				[load, tick],
			);

			var short = sessionId ? String(sessionId).slice(0, 13) : "—";
			var head = h(
				"div",
				{ className: "usg-head" },
				h(
					"b",
					null,
					(data && data.title) || short,
					data && data.subagent ? h("span", { className: "usg-badge" }, "子代理" + (data.delegationDepth > 0 ? " · L" + data.delegationDepth : "")) : null,
				),
				h("span", { className: "usg-muted", title: sessionId || "" }, ((data && data.cwd) || "本会话") + (data ? "" : "（未采集到用量）")),
				data && data.firstTime ? h("span", { className: "usg-muted" }, "活跃 " + fmtTime(data.firstTime) + " → " + fmtTime(data.lastTime)) : null,
			);

			var bar = h(
				"div",
				{ className: "usg-bar" },
				h("span", { className: "usg-muted" }, "当前会话"),
				h("span", { style: { flex: 1 } }),
				loading ? h("span", { className: "usg-muted" }, "加载中…") : null,
				h(
					"button",
					{
						className: "usg-btn",
						onClick: function () {
							setTick(function (x) {
								return x + 1;
							});
						},
						disabled: loading,
						title: "重新扫描会话文件",
					},
					"刷新",
				),
			);

			if (err) return h("div", { className: "usg-root" }, bar, head, h("div", { className: "usg-err" }, "读取失败：" + err));
			if (!data) {
				return h(
					"div",
					{ className: "usg-root" },
					bar,
					head,
					!loading ? h("div", { className: "usg-muted" }, "未采集到该会话用量（新会话待落盘后点「刷新」）") : null,
				);
			}
			var t = data.totals;
			var msgs = data.messages || {};
			return h(
				"div",
				{ className: "usg-root" },
				bar,
				head,
				h(
					"div",
					{ className: "usg-kpis" },
					kpi("用户消息", fmt(msgs.user)),
					kpi("Agent 消息", fmt(msgs.assistant)),
					kpi("工具调用", fmt(msgs.toolCalls)),
					kpi("请求步数", fmt(t.requests), t.total ? "总 tokens " + fmt(t.total) : undefined),
				),
				h(
					"div",
					{ className: "usg-kpis" },
					kpi("输入（未缓存）", fmt(t.input)),
					kpi("输出", fmt(t.output)),
					kpi("缓存读", fmt(t.cacheRead), "命中率 " + fmtPct(data.hitRate)),
					kpi("缓存写", fmt(t.cacheWrite)),
					kpi("费用", data.priced ? fmtCost(data.cost) : "—", data.priced ? undefined : "未配价目"),
				),
				data.byModel && data.byModel.length ? h("div", null, h("div", { className: "usg-title" }, "按模型"), modelTable(data.byModel)) : null,
			);
		}

		/* ---------- 设置页：全局报表卡（与会话无关；界面从简） ---------- */
		function GlobalCard(props) {
			var ctx = props.ctx;
			var mounted = props.mounted;
			var _r = useState("30d"),
				range = _r[0],
				setRange = _r[1];
			var _y = useState(""),
				day = _y[0],
				setDay = _y[1];
			var _d = useState(null),
				data = _d[0],
				setData = _d[1];
			var _e = useState(null),
				err = _e[0],
				setErr = _e[1];
			var _l = useState(false),
				loading = _l[0],
				setLoading = _l[1];
			var _t = useState(0),
				tick = _t[0],
				setTick = _t[1];
			var alive = useRef(0);

			var filter = useCallback(
				function () {
					if (day) return { from: day, to: day };
					return rangeToFilter(range);
				},
				[day, range],
			);

			var load = useCallback(
				async function () {
					var my = ++alive.current;
					setLoading(true);
					setErr(null);
					try {
						await mounted;
						var r = await ctx.remote.usageStats.overview(filter());
						if (!r.ok) throw new Error(r.error.message);
						if (alive.current === my) setData(r.value);
					} catch (e) {
						if (alive.current === my) setErr(String((e && e.message) || e));
					} finally {
						if (alive.current === my) setLoading(false);
					}
				},
				[ctx, mounted, filter],
			);

			useEffect(
				function () {
					load();
				},
				[load, tick],
			);

			var t = data && data.totals;
			var msgs = (data && data.messages) || {};
			return h(
				"li",
				{ className: "usg-card" },
				h(
					"header",
					null,
					h("b", null, "用量统计 · 全局报表"),
					h("span", { className: "usg-muted" }, "扫描全部 workspace 的会话文件（只读）。按天筛选为本地时区；消息计数为窗口内有 usage 的会话之和。"),
				),
				h(
					"div",
					{ className: "usg-bar" },
					h(
						"div",
						{ className: "usg-seg" },
						RANGES.map(function (r) {
							return h(
								"button",
								{
									key: r[0],
									"aria-pressed": !day && range === r[0],
									onClick: function () {
										setDay("");
										setRange(r[0]);
									},
								},
								r[1],
							);
						}),
					),
					h("input", {
						className: "usg-date",
						type: "date",
						value: day,
						title: "只看某一天（本地时区）",
						onChange: function (e) {
							setDay(e.target.value || "");
						},
					}),
					h("span", { style: { flex: 1 } }),
					loading ? h("span", { className: "usg-muted" }, "加载中…") : null,
					h(
						"button",
						{
							className: "usg-btn",
							onClick: function () {
								setTick(function (x) {
									return x + 1;
								});
							},
							disabled: loading,
						},
						"刷新",
					),
				),
				err ? h("div", { className: "usg-err" }, "读取失败：" + err) : null,
				data
					? h(
							"div",
							{ className: "usg-kpis" },
							kpi("会话数", fmt(data.sessionCount), "扫描 " + data.scannedFiles + " 个文件"),
							kpi("消息数", "用 " + fmt(msgs.user) + " · 答 " + fmt(msgs.assistant) + " · 工 " + fmt(msgs.toolCalls)),
							kpi("总 tokens（含缓存）", fmt(t.total), t.requests + " 次请求"),
							kpi("输入（未缓存）", fmt(t.input)),
							kpi("输出", fmt(t.output)),
							kpi("缓存读", fmt(t.cacheRead), "命中率 " + fmtPct(data.hitRate)),
							kpi("缓存写", fmt(t.cacheWrite)),
							kpi("费用合计", data.priced ? fmtCost(data.cost) : "—", data.priced ? undefined : "未配价目"),
						)
					: null,
				data && data.byModel && data.byModel.length ? h("div", null, h("div", { className: "usg-title" }, "按模型"), modelTable(data.byModel)) : null,
				data
					? h(
							"div",
							{ className: "usg-muted" },
							data.configuredPrices > 0 ? data.configuredPrices + " 个模型已配价" : "尚未配置价目",
							" · 编辑请用设置文档（settings.yaml → usage-stats.prices） · 数据截至 " + new Date(data.generatedAt).toLocaleTimeString(),
						)
					: null,
			);
		}

		function TabTitle() {
			return h("span", { className: "usg-chip" }, "用量");
		}

		/* ---------- cordis 客户端插件入口 ---------- */
		var inject = ["slots", "sidebarRightTabs", "remote"];

		function apply(ctx) {
			ensureCss();
			var mounted = ctx.remote.$mount(CONTRIBUTION);
			mounted.then(null, function () {}); // 无人等待时兜底，防未处理 rejection；面板内 await 仍会把错误抛给 try/catch
			ctx.effect(function () {
				return ctx.sidebarRightTabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					title: function () {
						return "用量";
					},
					guide: [
						{
							order: 40,
							title: function () {
								return "用量统计";
							},
							description: function () {
								return "当前会话的 token 用量与命中率（全局报表在设置→插件）";
							},
						},
					],
				});
			}, "usage-stats: tab type");
			ctx.effect(function () {
				return ctx.slots.inject("sidebar.right.pane.tab", function () {
					return ctx.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, function (props) {
						// sessionId 是 slot 的 session-scope 标准 prop（sidebar-files FilesBody 同款取法）
						return h(SessionPanel, { ctx: ctx, mounted: mounted, sessionId: props && props.sessionId });
					});
				});
			}, "usage-stats: tab body");
			ctx.effect(function () {
				return ctx.slots.inject("sidebar.right.pane.tab.title", function () {
					return ctx.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, TabTitle);
				});
			}, "usage-stats: tab title");
			// 设置→插件→插件配置 卡：key 必须 === settings 命名空间（v1 已注册该命名空间，缺卡时它隐身）。
			ctx.effect(function () {
				return ctx.slots.inject("settings.plugin.item", function () {
					return ctx.slots.register({ name: "settings.plugin.item", key: SETTINGS_NS }, function () {
						return h(GlobalCard, { ctx: ctx, mounted: mounted });
					});
				});
			}, "usage-stats: settings card");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
