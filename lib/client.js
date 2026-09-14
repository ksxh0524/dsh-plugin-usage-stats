/** dsh-plugin-usage-stats 浏览器半（手写 __ModuleLoader__ 工厂，无构建链），v3 单页形态：
 *  「设置 → Token 用量」独立 section 页（宿主 General 分区左列表的新条目，settings.section keyed slot）。
 *  会话级视图宿主自带（底部计数条 + 会话统计对话框），本包不重复造——v2 的右侧栏 tab 已删。
 *
 *  要点（与设计文档一致）：
 *  - 形态 = window.__ModuleLoader__.load({id, factory})，与官方 lib/client.js 同格式；
 *    只用基线模块表（react），无 JSX（React.createElement），故无需构建。
 *  - ctx.remote 官方装配是 build 期固定能力集，不带 usageStats 命名空间：
 *    本包自己 ctx.remote.$mount(CONTRIBUTION) 挂手写 strict descriptor
 *    （参数 codec 的 schema.parse 为透传，服务端 SRC 模式做 JSON-safe 校验；结果客户端不校验）。
 *    实测（真宿主）：$mount resolve 后服务与 accessor 都注册了，但**属性式 ctx.remote.<ns>
 *    在第三方 fiber 被可见性过滤（"without inject" throw），必须用名字解析 ctx.get("remote.usageStats")**。
 *  - 两端契约：descriptors 与 src/cordis.ts 的 SRC 方法/参数名一一对应（overview/filter），改名须同步。
 *  - 日期区间 = 自绘 RangePicker（单触发器 + 预设 + 月历），不用原生 <input type=date>（宿主深色主题下样式失控）；
 *    交互对标 agent-token-stats 的时间选择（预设即选即得 + 日历两段式范围），全走 --dsw-* 设计令牌。
 *  - label 用 () => 字符串直出中文（宿主 locale 命名空间是官方包机制，三方插件不自带词典）。
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

		/** settings 命名空间（src/settings.ts USAGE_STATS_SETTINGS_NS 的镜像；section id 与 slot key）。 */
		var SETTINGS_NS = "usage-stats";

		/* ---------- Remote contribution（手写 strict 描述符；与 src/cordis.ts 的 SRC 方法一一对应） ---------- */
		var passthrough = {
			parse: function (v) {
				return v === undefined ? {} : v;
			},
		};
		function codec(sym) {
			return { mode: "strict", typeSymbol: "dsh-plugin-usage-stats#" + sym, schema: passthrough };
		}
		function descriptor(method, param, location) {
			return {
				id: SETTINGS_NS + "#usageStats/" + method,
				service: "usageStats",
				namespace: "usageStats",
				method: method,
				invocation: { kind: "direct" },
				// acceptsUndefined：filter 可省略（官方 codegen 对可选边界的显式字段，不塞 codec 兜底）。
				// sourceLocation：契约出处锚点（官方产物恒带）；行号漂移由 contract-pair 测试当场抓住。
				parameters: [{ name: param, wire: param, source: "json", acceptsUndefined: true, codec: codec(method + ":" + param) }],
				result: codec(method + ":result"),
				sourceLocation: location,
			};
		}
		var CONTRIBUTION = {
			package: "dsh-plugin-usage-stats",
			descriptors: [descriptor("overview", "filter", { file: "src/cordis.ts", line: 61, column: 9 })],
		};

		/* ---------- 样式（materialize 时注入一次） ----------
		 * 1:1 对齐宿主官方设置页规范（verbatim 来源：dsh-client-ui-settings-plugins 注入的
		 * fields.module.css）：表单控件 = 高 34px、圆角 8px、.5px 细边 border-l4、底 bg-layer-3、
		 * 13px/1.5 文字、focus 时 border 变 brand-primary；字段分隔线 .5px border-l2；
		 * 报错 = 无边框 label-error 12px 文字；文本按钮 = 无边框 label-secondary hover 提亮。
		 * token 名以 dsh-client-ui-theme 运行时定义表为准（harness 的 __TOKEN_AUDIT__ 兜底，
		 * 曾因引用 --dsw-alias-separator/fill-quinary 等未定义名导致真页浮层全黑）。 */
		var CSS = [
			".usg-root{display:flex;flex-direction:column;gap:14px;padding:16px 18px;overflow:auto;height:100%;box-sizing:border-box;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);max-width:980px}",
			".usg-head{display:flex;flex-direction:column;gap:2px}",
			".usg-head b{font-size:16px;font-weight:600}",
			".usg-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".usg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}",
			".usg-kpi{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-layer-1)}",
			".usg-kpi b{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}",
			".usg-kpi span{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			".usg-table{width:100%;border-collapse:collapse;font-size:12px}",
			".usg-table th{text-align:right;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);white-space:nowrap}",
			".usg-table td{text-align:right;padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".usg-table th:first-child,.usg-table td:first-child{text-align:left}",
			".usg-muted{color:var(--dsw-alias-label-tertiary)}",
			".usg-err{color:var(--dsw-alias-label-error);font-size:12px}",
			/* 触发器 = 宿主表单控件质感（官方 input 规范逐参数照抄） */
			".usg-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}",
			".usg-btn:hover{border-color:var(--dsw-alias-border-l3)}",
			".usg-btn:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
			".usg-btn[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}",
			".usg-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);margin-bottom:4px}",
			/* 浮层（RangePicker / DimSelect 共用）：透明 mask 兜外点关闭，panel 用宿主菜单底+阴影+同规格圆角 */
			".usg-anchor{position:relative}",
			".usg-mask{position:fixed;inset:0;z-index:60}",
			/* 抬升面官方规范（docs/web-styling.md + ui-theme elevation spec）：border:0 +
			 * --dsw-elevation-*，0.5px 描边是阴影第一层（stroke-color 可换绑），
			 * 禁止 alias-border 真边框与 elevation/lv 阴影并配。 */
			".usg-pop{position:absolute;top:calc(100% + 4px);left:0;z-index:61;border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-panel);border-radius:8px;background:var(--dsw-specific-menu);padding:10px;font-size:12px;min-width:230px}",
			/* 预设 = 官方文本按钮（reset 规范：无边框无底色，secondary hover 提亮） */
			".usg-pre{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}",
			".usg-pre>button{all:unset;cursor:pointer;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}",
			".usg-pre>button:hover{color:var(--dsw-alias-label-primary)}",
			".usg-cal-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}",
			".usg-cal-h b{font-size:12px}",
			".usg-cal-h>button{all:unset;cursor:pointer;padding:0 8px;color:var(--dsw-alias-label-secondary)}",
			".usg-cal-h>button:hover{color:var(--dsw-alias-label-primary)}",
			".usg-cal{display:grid;grid-template-columns:repeat(7,28px);gap:1px}",
			".usg-cal>span{text-align:center;font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:20px}",
			".usg-pv{text-align:center;line-height:26px;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-primary)}",
			".usg-pv[aria-disabled=true]{color:var(--dsw-alias-label-dimmed);cursor:default}",
			".usg-pv:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".usg-pv.usg-in{background:var(--dsw-alias-bg-layer-2);border-radius:0}",
			".usg-pv.usg-e{background:var(--dsw-alias-button-ghost-active-fill);border-radius:0}",
			".usg-pv.usg-e.usg-in{border-radius:0}",
			".usg-pop .usg-pv[aria-selected=true]{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}",
			".usg-pop-ft{display:flex;justify-content:space-between;margin-top:8px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px}",
			".usg-list{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto;min-width:180px}",
			".usg-list>li{padding:3px 8px;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-secondary)}",
			".usg-list>li:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".usg-list>li[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}",
		].join("\n");
		var cssDone = false;
		function ensureCss() {
			if (cssDone || typeof document === "undefined") return;
			cssDone = true;
			var el = document.createElement("style");
			el.setAttribute("data-plugin", SETTINGS_NS);
			el.textContent = CSS;
			document.head.appendChild(el);
		}

		/* ---------- 格式化与本地日期工具 ---------- */
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
		function p2(n) {
			return (n < 10 ? "0" : "") + n;
		}
		function localYmd(d) {
			return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
		}
		function ymdDate(ymd) {
			var a = ymd.split("-");
			return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
		}
		function addDays(ymd, n) {
			var d = ymdDate(ymd);
			d.setDate(d.getDate() + n);
			return localYmd(d);
		}
		function todayYmd() {
			return localYmd(new Date());
		}
		/** 预设窗口（win=null 表示全部）。 */
		var PRESETS = [
			[
				"今天",
				function () {
					var t = todayYmd();
					return [t, t];
				},
			],
			[
				"近3天",
				function () {
					return [addDays(todayYmd(), -2), todayYmd()];
				},
			],
			[
				"近7天",
				function () {
					return [addDays(todayYmd(), -6), todayYmd()];
				},
			],
			[
				"近30天",
				function () {
					return [addDays(todayYmd(), -29), todayYmd()];
				},
			],
		];
		function winLabel(win) {
			if (!win) return "全部";
			if (win.from === win.to) return win.from === todayYmd() ? "今天" : win.from;
			for (var i = 0; i < PRESETS.length; i++) {
				var w = PRESETS[i][1]();
				if (w[0] === win.from && w[1] === win.to) return PRESETS[i][0];
			}
			return win.from.slice(5) + " → " + win.to.slice(5);
		}

		function kpi(label, value, sub) {
			return h("div", { className: "usg-kpi" }, h("b", null, value), h("span", null, label), sub ? h("span", { className: "usg-muted" }, sub) : null);
		}
		function table(title, head, rows) {
			return h(
				"div",
				null,
				h("div", { className: "usg-title" }, title),
				h(
					"table",
					{ className: "usg-table" },
					h(
						"thead",
						null,
						h(
							"tr",
							null,
							head.map(function (x, i) {
								return h("th", { key: i }, x);
							}),
						),
					),
					h(
						"tbody",
						null,
						rows.map(function (r, i) {
							return h(
								"tr",
								{ key: r.key || i },
								r.cells.map(function (c, j) {
									return h("td", { key: j, title: c.t }, c.v);
								}),
							);
						}),
					),
				),
			);
		}

		/* ---------- 浮层原语：anchor + 全屏 mask（点外即关）+ panel ---------- */
		/** 弹层基元：trigger 永远渲染（关=只收 mask+panel）。曾经 !open 时 return null
		 *  连触发器一起删掉——静态 harness 第一轮抓到这个 v3 bug。 */
		function Popover(props) {
			return h(
				"span",
				{ className: "usg-anchor" },
				props.trigger,
				props.open
					? h(
							React.Fragment,
							null,
							h("div", { className: "usg-mask", onMouseDown: props.onClose }),
							h(
								"div",
								{
									className: "usg-pop",
									onMouseDown: function (e) {
										e.stopPropagation();
									},
								},
								props.children,
							),
						)
					: null,
			);
		}

		/* ---------- RangePicker：单触发器 + 预设 + 月历范围选择（默认今天；两段式：点起点→点终点） ---------- */
		function RangePicker(props) {
			var win = props.value;
			var _o = useState(false),
				open = _o[0],
				setOpen = _o[1];
			var _p = useState(null),
				pick = _p[0],
				setPick = _p[1]; // 起点暂存（等终点）
			var _h = useState(null),
				hov = _h[0],
				setHov = _h[1];
			var _m = useState(function () {
					var base = win ? ymdDate(win.to) : new Date();
					return { y: base.getFullYear(), m: base.getMonth() };
				}),
				month = _m[0],
				setMonth = _m[1];

			function shift(n) {
				setMonth(function (x) {
					var d = new Date(x.y, x.m + n, 1);
					return { y: d.getFullYear(), m: d.getMonth() };
				});
			}
			function commit(a, b) {
				var from = a <= b ? a : b;
				var to = a <= b ? b : a;
				props.onChange({ from: from, to: to });
				setPick(null);
				setOpen(false);
			}
			function pickDay(d) {
				if (pick === null) setPick(d);
				else commit(pick, d);
			}
			// 预览范围：已选起点 + hover 中
			var lo = null,
				hi = null;
			if (pick !== null) {
				lo = hov !== null && hov < pick ? hov : pick;
				hi = hov !== null && hov < pick ? pick : hov;
			}
			var today = todayYmd();
			var cells = [];
			var first = new Date(month.y, month.m, 1);
			var lead = (first.getDay() + 6) % 7; // 周一起始偏移
			var days = new Date(month.y, month.m + 1, 0).getDate();
			var WEEK = ["一", "二", "三", "四", "五", "六", "日"];
			var i;
			for (i = 0; i < lead; i++) cells.push(h("span", { key: "b" + i }));
			for (i = 1; i <= days; i++) {
				var d = month.y + "-" + p2(month.m + 1) + "-" + p2(i);
				var disabled = d > today;
				var isSel = win && d >= win.from && d <= win.to;
				var isEdge = win && (d === win.from || d === win.to);
				var isMid = lo !== null && hi !== null && d >= lo && d <= hi;
				cells.push(
					h(
						"span",
						{
							key: d,
							className: "usg-pv" + (isEdge ? " usg-e" : isSel && !isEdge ? " usg-in" : isMid ? " usg-e" : ""),
							"aria-disabled": disabled ? "true" : undefined,
							onClick: function () {
								if (!disabled) pickDay(d);
							},
							onMouseEnter: function () {
								setHov(d);
							},
						},
						String(i),
					),
				);
			}
			return h(
				Popover,
				{
					open: open,
					onClose: function () {
						setOpen(false);
						setPick(null);
					},
					trigger: h(
						"button",
						{
							className: "usg-btn",
							title: "选择日期范围（本地时区，按天）",
							onClick: function () {
								setOpen(!open);
							},
						},
						winLabel(win),
					),
				},
				h(
					"div",
					{ className: "usg-pre" },
					PRESETS.map(function (p) {
						return h(
							"button",
							{
								key: p[0],
								onClick: function () {
									var w = p[1]();
									props.onChange({ from: w[0], to: w[1] });
									setOpen(false);
								},
							},
							p[0],
						);
					}),
					h(
						"button",
						{
							onClick: function () {
								props.onChange(null);
								setOpen(false);
							},
						},
						"全部",
					),
				),
				h(
					"div",
					{ className: "usg-cal-h" },
					h(
						"button",
						{
							onClick: function () {
								shift(-1);
							},
							"aria-label": "上一月",
						},
						"‹",
					),
					h("b", null, month.y + " 年 " + (month.m + 1) + " 月"),
					h(
						"button",
						{
							onClick: function () {
								shift(1);
							},
							"aria-label": "下一月",
						},
						"›",
					),
				),
				h(
					"div",
					{ className: "usg-cal" },
					WEEK.map(function (w) {
						return h("span", { key: "w" + w }, w);
					}),
					cells,
				),
				h(
					"div",
					{ className: "usg-pop-ft" },
					h(
						"button",
						{
							className: "usg-muted",
							style: { cursor: "pointer" },
							onClick: function () {
								setPick(null);
								props.onChange(null);
								setOpen(false);
							},
						},
						"清除（全部）",
					),
					h("span", { className: "usg-muted" }, pick === null ? "点选起止日" : "已选起点，再点终点"),
				),
			);
		}

		/* ---------- DimSelect：服务商/模型下拉（含「全部」项） ---------- */
		function DimSelect(props) {
			var _o = useState(false),
				open = _o[0],
				setOpen = _o[1];
			var items = props.items;
			return h(
				Popover,
				{
					open: open,
					onClose: function () {
						setOpen(false);
					},
					trigger: h(
						"button",
						{
							className: "usg-btn",
							title: props.title,
							onClick: function () {
								setOpen(!open);
							},
						},
						props.label + "：" + (props.value || "全部") + " ▾",
					),
				},
				h(
					"ul",
					{ className: "usg-list" },
					[{ v: "", l: "全部" }].concat(items).map(function (o) {
						return h(
							"li",
							{
								key: o.v,
								"aria-selected": (props.value || "") === o.v ? "true" : undefined,
								title: o.v,
								onClick: function () {
									props.onChange(o.v || null);
									setOpen(false);
								},
							},
							o.l,
						);
					}),
				),
			);
		}

		/* ---------- Section 页：筛选栏 + KPI + 按模型 + 按天 + 价目脚注 ---------- */
		function UsageStatsSection(props) {
			var ctx = props.ctx;
			var mounted = props.mounted;
			var _w = useState(function () {
					var t = todayYmd();
					return { from: t, to: t };
				}),
				win = _w[0],
				setWin = _w[1];
			var _pr = useState(null),
				provider = _pr[0],
				setProvider = _pr[1];
			var _md = useState(null),
				model = _md[0],
				setModel = _md[1];
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
			/** 下拉选项池：只在无维度过滤的查询后刷新（过滤结果里选项会枯竭）。 */
			var _pl = useState({ providers: [], models: [] }),
				pool = _pl[0],
				setPool = _pl[1];

			var load = useCallback(
				async function () {
					var my = ++alive.current;
					setLoading(true);
					setErr(null);
					try {
						await mounted;
						var f = {};
						if (win) {
							f.from = win.from;
							f.to = win.to;
						}
						if (provider) f.provider = provider;
						if (model) f.model = model;
						var r = await ctx.get("remote.usageStats").overview(f);
						if (!r.ok) throw new Error(r.error.message);
						if (alive.current === my) {
							setData(r.value);
							if (!provider && !model && r.value && r.value.byModel) setPool(derivePool(r.value.byModel));
						}
					} catch (e) {
						if (alive.current === my) setErr(humanizeError(String((e && e.message) || e)));
					} finally {
						if (alive.current === my) setLoading(false);
					}
				},
				[ctx, mounted, win, provider, model],
			);
			useEffect(
				function () {
					load();
				},
				[load, tick],
			);

			var t = (data && data.totals) || {};
			var filtered = !!(provider || model);

			return h(
				"div",
				{ className: "usg-root" },
				h(
					"div",
					{ className: "usg-head" },
					h("b", null, "Token 用量"),
					h("span", { className: "usg-muted" }, "全部 workspace 会话的全局用量（本地时区按天；单会话数据请看聊天区自带统计）"),
				),
				h(
					"div",
					{ className: "usg-bar" },
					h(RangePicker, {
						value: win,
						onChange: function (w) {
							setWin(w);
						},
					}),
					h(DimSelect, {
						label: "服务商",
						title: "按服务商过滤",
						value: provider,
						items: pool.providers,
						onChange: function (v) {
							setProvider(v);
							setModel(null);
						},
					}),
					h(DimSelect, {
						label: "模型",
						title: "按模型过滤",
						value: model,
						items: pool.models.filter(function (o) {
							return !provider || o.v.slice(0, o.v.indexOf("/")) === provider;
						}),
						onChange: function (v) {
							setModel(v);
						},
					}),
					h("span", { style: { flex: 1 } }),
					loading ? h("span", { className: "usg-muted" }, "统计中…") : null,
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
							kpi("总 tokens（含缓存）", fmt(t.total), (t.requests || 0) + " 次请求"),
							kpi("输入（未缓存）", fmt(t.input)),
							kpi("输出", fmt(t.output)),
							kpi("缓存读", fmt(t.cacheRead), "命中率 " + fmtPct(data.hitRate)),
							kpi("缓存写", fmt(t.cacheWrite)),
						)
					: null,
				data && data.byModel && data.byModel.length
					? table(
							"按模型" + (filtered ? "（已过滤）" : ""),
							["模型", "请求", "输入", "输出", "缓存读", "命中率"],
							data.byModel.map(function (m) {
								return {
									key: m.key,
									cells: [
										{ v: m.key, t: m.key },
										{ v: fmt(m.requests) },
										{ v: fmt(m.input) },
										{ v: fmt(m.output) },
										{ v: fmt(m.cacheRead) },
										{ v: fmtPct(m.hitRate) },
									],
								};
							}),
						)
					: null,
				data ? h("div", { className: "usg-muted" }, "数据截至 " + new Date(data.generatedAt).toLocaleTimeString()) : null,
			);
		}
		/** mount/调用失败的原始报错翻译：without inject = 两端契约错位（浏览器半已刷新、host 仍是旧服务端），
		 *  明确告诉用户重启该 profile 的 host；其余错误原样透出。 */
		function humanizeError(msg) {
			if (/without inject|no longer mounted|is not a function|undefined/.test(msg)) {
				return (
					"读取用量服务失败：浏览器半调用的是 $mount 注册到本插件 fiber 的 usageStats 服务。" +
					"若 host 仍在运行旧版服务端（未含 v3 overview），需由你重启当前 profile 的 host 后刷新本页（服务端改动必须重启生效）。原始错误：" +
					msg
				);
			}
			return msg;
		}
		/** 从 byModel 行派生两个维度的选项池（保序去重）。 */
		function derivePool(byModel) {
			var seenP = {},
				seenM = {},
				providers = [],
				models = [];
			(byModel || []).forEach(function (m) {
				if (!seenP[m.provider]) {
					seenP[m.provider] = 1;
					providers.push({ v: m.provider, l: m.provider });
				}
				if (!seenM[m.key]) {
					seenM[m.key] = 1;
					models.push({ v: m.key, l: m.key });
				}
			});
			return { providers: providers, models: models };
		}

		/* ---------- cordis 客户端插件入口 ---------- */
		var inject = ["slots", "remote"];

		function apply(ctx) {
			ensureCss();
			var mounted = ctx.remote.$mount(CONTRIBUTION);
			mounted.then(null, function () {}); // 无人等待时兜底，防未处理 rejection；页内 await 仍会把错误抛给 try/catch
			// 宿主 General 分区左列表的独立 section 页（order 30：general0/models10/plugins15/agent-presets20 之后）。
			ctx.effect(function () {
				return ctx.slots.inject("settings.section", function () {
					return ctx.slots.register(
						{
							name: "settings.section",
							id: SETTINGS_NS,
							order: 30,
							label: function () {
								return "Token 用量";
							},
						},
						function () {
							return h(UsageStatsSection, { ctx: ctx, mounted: mounted });
						},
					);
				});
			}, "usage-stats: settings section");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
