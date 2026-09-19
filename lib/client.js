/** dsh-plugin-usage-stats 浏览器半（手写 __ModuleLoader__ 工厂，无构建链），v4 分区页形态：
 *  「设置」弹窗**左导航栏**里与 General/Models/Plugins/Agent presets 同级的一条 section 页
 *  （`settings.section` keyed slot，order 30；导航图标由宿主按 id 回落齿轮，插件不自造）。
 *  会话级视图宿主自带（底部计数条 + 会话统计对话框），本包不重复造——v2 的右侧栏 tab 已删。
 *  另挂 `conversation.composer.dock` 全家桶 pill（id family-total，order 1）：主会话输入框下方显示
 *  本会话 + 全部子代理合计（未知/子代理/零用量时不渲染，展开面板走 in-flow）；显隐由设置页开关行
 *  控制（localStorage 持久化，默认开，浏览器侧偏好，不进服务端 config）。
 *
 *  形态规范 = STANDARDS §4.4（同位范本：宿主 PluginInventorySettingsTab 读视图 + SettingsRoot 壳），要点：
 *  - **滚动只归壳**：页根不写 overflow/height/根 padding——宿主 `.options{min-height:0;padding:0 24px 24px;
 *    overflow-y:auto}` 是唯一滚动位（旧版自开 `overflow:auto;height:100%;padding:16px 18px` = 嵌套双滚动 +
 *    滚动条 token 失效 + 左基线错位，v3 违则已纠）；根壳照抄 `flex column / gap / width:100% / max-width:760px`。
 *  - **页面级常开合法、页内必须分节**：明细表各成一个 `<section>` 组，组头是 `<button aria-expanded aria-controls>`
 *    + chevron（`aria-hidden`）+ 计数副行（宿主 `presetOpen ?? true`：默认展开，折叠是能力不是义务）。
 *  - **标题有层级**：页 `<h2>`（18/600）+ 组标题（12/600 大写 tertiary），禁 `<b>`/`<div>` 当标题。
 *  - **读视图三态硬要求**：容器 `aria-busy` + `<p class=status>`；失败 `<p role="alert">` + **重试按钮**；
 *    空态一句文案（旧版只有一条无 role 的红字 = 读屏与自动化都看不见）。
 *  - **浮层走 primitives**：服务商/模型下拉 = 宿主 `Menu`（portal + document pointerdown 外点 + Escape +
 *    `role=menu/menuitem` 真按钮 + 方向键）；日期区间宿主无件 → 月历自绘，但**坐在宿主
 *    `useAnchoredPosition` + `useDismissOnOutsidePointer` 骨架上**（旧版自铺 `position:fixed;inset:0` 全屏 mask
 *    压在左导航与关闭 X 之上，浮层开着时要点两下才能碰宿主 chrome——v3 实锤违则）。
 *  - **可点必是 `<button>`**：日格 `aria-pressed` + 原生 `disabled`（旧版 `<span aria-selected>` AT 不采纳且键盘不可达）。
 *  - **卡壳档位**：`bg-module-platform` 底 + `.5px border-l4` + r12（旧版 `bg-layer-1` 浅色与面板同色隐形、
 *    深色比面板更暗＝凹陷；`border-l2` 在宿主只当分隔线）。读数用 `<dl>/<dt>/<dd>`。
 *
 *  其余不变（与设计文档一致）：
 *  - 形态 = window.__ModuleLoader__.load({id, factory})；只用冻结模块种子表内词（react / react-dom /
 *    dsh-client-ui-primitives，见 §4.3），无 JSX（React.createElement），故无需构建；primitives 缺席时退
 *    原生 `<select>` 与就地弹层两条**最小**兜底路（不是第二套手搓控件体系）。
 *  - ctx.remote 官方装配是 build 期固定能力集，不带 usageStats 命名空间：本包自己 ctx.remote.$mount(CONTRIBUTION)
 *    挂手写 strict descriptor；**属性式 ctx.remote.<ns> 在第三方 fiber 被可见性过滤（"without inject" throw），
 *    必须用名字解析 ctx.get("remote.usageStats")**（真宿主实测）。
 *  - 两端契约：descriptors 与 src/cordis.ts 的 SRC 方法/参数名一一对应（overview/filter），改名/挪行由
 *    dsh-check 的 contractPairSuite（注册位 tests/standard.test.ts）当场抓住。
 *  - 日期区间 = 自绘 RangePicker（单触发器 + 预设行 + 月历两段式 + 底部「清除」），不用原生 <input type=date>
 *    （宿主深色主题下样式失控）。选中配色 = 成熟 range picker 的中性统一语言（用户点名禁 brand 蓝）：
 *    端点/pending = 中性深灰实心胶囊（static bluish-700）+ 白字、区间带同灰 color-mix、今天 = 灰描圈。
 *    ⚠ alias-brand-primary/-invert/brand-text 是「墨」不是蓝（做填充配对 = 黑底黑字，incidents/002）。
 *    ⚠ 日格必须经 dayCell(d) 函数参数建独立绑定——循环体内 var + 闭包共享末值曾让整张日历点不动（v3 实锤）。
 *  - 全走 --dsw-* 真定义令牌（picker.test.ts 末案离线审计），动效自护 prefers-reduced-motion（§4.3）。
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
		/** react-dom 与宿主共享控件同属冻结模块种子表（§4.3）：portal + Menu + 锚定/关闭骨架全复用，
		 *  缺席时退就地弹层与原生 select（兜底不是常路，picker/browser 两件都会点名）。 */
		var ReactDOM = null;
		var UI = null;
		try {
			ReactDOM = require("react-dom") || null;
		} catch (e) {
			ReactDOM = null;
		}
		try {
			UI = require("@deepseek-ai/dsh-client-ui-primitives") || null;
		} catch (e) {
			UI = null;
		}

		/** settings 命名空间（src/settings.ts USAGE_STATS_SETTINGS_NS 的镜像；section id 与 slot key）。 */
		var SETTINGS_NS = "usage-stats";

		/* ---------- Remote contribution（手写 strict 描述符；与 src/cordis.ts 的 SRC 方法一一对应） ---------- */
		var passthrough = {
			parse: function (v) {
				return v === undefined ? {} : v;
			},
		};
		function codec(sym) {
			// 网关 ≥0.1.6 用 create() 物化 schema 再 parse（dsh-api-gateway decode），老网关走 schema.parse——两边都给，双向兼容。
			return {
				mode: "strict",
				typeSymbol: "dsh-plugin-usage-stats#" + sym,
				schema: passthrough,
				create: function () {
					return passthrough;
				},
			};
		}
		function descriptor(method, param, location) {
			return {
				id: SETTINGS_NS + "#usageStats/" + method,
				service: "usageStats",
				namespace: "usageStats",
				method: method,
				invocation: { kind: "direct" },
				// acceptsUndefined：filter 可省略（官方 codegen 对可选边界的显式字段，不塞 codec 兜底）。
				// sourceLocation：契约出处锚点（官方产物恒带）；行号漂移由 contractPairSuite 当场抓住。
				parameters: [{ name: param, wire: param, source: "json", acceptsUndefined: true, codec: codec(method + ":" + param) }],
				result: codec(method + ":result"),
				sourceLocation: location,
			};
		}
		var CONTRIBUTION = {
			package: "dsh-plugin-usage-stats",
			descriptors: [
				descriptor("overview", "filter", { file: "src/cordis.ts", line: 45, column: 9 }),
				descriptor("familyTotal", "filter", { file: "src/cordis.ts", line: 55, column: 9 }),
			],
		};

		/* ---------- 样式（materialize 时注入一次）：值照抄宿主 section 页与 elevation/fields 规范 ----------
		 * 页边距与滚动归宿主 .options（SettingsRoot.module.css:221-226），本包只排版自己那一栏。
		 * token 名以 dsh-client-ui-theme 运行时定义表为准（离线审计在 tests/picker.test.ts 末案）。 */
		var CSS = [
			// 页根 = 宿主 section 根壳（flex column / gap / 760 上限；无 overflow、无根 padding）
			".usg-root{display:flex;flex-direction:column;gap:12px;width:100%;max-width:760px;box-sizing:border-box;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}",
			".usg-head{display:flex;flex-direction:column;gap:2px}",
			".usg-h2{margin:0;font-size:18px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}",
			".usg-intro{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			".usg-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".usg-headEnd{margin-left:auto}",
			// 三态（宿主读视图规范：status 13/20 tertiary、failure 错误色 + .5px border-l3 重试钮）
			".usg-status{margin:0;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}",
			".usg-failure{margin:0;font-size:13px;line-height:1.55;color:var(--dsw-alias-state-error-primary)}",
			".usg-retry{appearance:none;margin-top:6px;padding:4px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:6px;background:none;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}",
			".usg-retry:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
			".usg-retry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			// 分节组（宿主 inventory 形：组间 hairline + 折叠头 + 计数副行）
			".usg-group+.usg-group{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:14px}",
			".usg-groupHead{display:flex;align-items:center;gap:8px}",
			".usg-groupToggle{appearance:none;display:flex;align-items:center;gap:6px;border:0;background:none;padding:0;font:inherit;cursor:pointer;color:var(--dsw-alias-label-tertiary)}",
			".usg-groupToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:6px}",
			".usg-groupChev{transition:transform .16s;transform:rotate(-90deg)}",
			".usg-groupToggle[aria-expanded=true] .usg-groupChev{transform:rotate(0deg)}",
			".usg-groupTitle{font-size:12px;font-weight:600;line-height:1.5;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}",
			".usg-groupSub{margin:2px 0 6px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
			// KPI（读视图档位：bg-module-platform 底 + border-l4 + r12；标签走 <dt>/<dd>）
			".usg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:0}",
			".usg-kpi{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-module-platform)}",
			".usg-kpi dt{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}",
			".usg-kpi dd{margin:0;font-size:17px;font-weight:600;line-height:1.3;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}",
			".usg-kpi dd.usg-kpiSub{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary)}",
			// 表（caption 只给 AT；th 带 scope）
			".usg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}",
			".usg-table{width:100%;border-collapse:collapse;font-size:12px}",
			".usg-table th{text-align:right;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);white-space:nowrap}",
			".usg-table td{text-align:right;padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);white-space:nowrap;font-variant-numeric:tabular-nums}",
			".usg-table th:first-child,.usg-table td:first-child{text-align:left}",
			".usg-muted{color:var(--dsw-alias-label-tertiary)}",
			/* 触发器 = 宿主表单控件质感（官方 input 规范逐参数照抄：34px / r8 / .5px border-l4 / bg-layer-3） */
			".usg-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}",
			".usg-btn:hover{border-color:var(--dsw-alias-border-l3)}",
			".usg-btn:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
			".usg-btn:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
			".usg-btn svg{color:var(--dsw-alias-label-tertiary)}",
			/* 兜底 select（primitives 缺席时；仍走同档控件规格） */
			".usg-select{box-sizing:border-box;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}",
			".usg-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}",
			/* 浮层骨架：anchor 相对定位（兜底路用），面板走 portal + 宿主 useAnchoredPosition 的 fixed 坐标。
			 * 层阶照抄宿主 portal 浮层档位 z-index:1100（Menu.module.css:42-48「portaled lists must layer above
			 * modal overlays (z 1000)」）——自拍 61 会被设置弹窗（modal z 1000）压在页面之下，肉眼像开了个假浮层。
			 * 抬升面官方规范：border:0 + --dsw-elevation-*（0.5px 描边是阴影第一层，stroke-color 可换绑），
			 * 禁 alias-border 真边框与 elevation 并配。禁自铺全屏 mask（宿主 .panel 是层叠上下文，mask 会盖导航与关闭 X）。 */
			".usg-anchor{position:relative;display:inline-flex}",
			".usg-pop{box-sizing:border-box;position:fixed;z-index:1100;border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-panel);border-radius:8px;background:var(--dsw-specific-menu);padding:10px;font-size:13px;line-height:1.5;min-width:230px}",
			".usg-popInline{position:absolute;top:calc(100% + 4px);left:0}",
			".usg-pre{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}",
			".usg-pre>button{all:unset;box-sizing:border-box;cursor:pointer;font-size:14px;line-height:1.5;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:2px 4px}",
			".usg-pre>button:hover{color:var(--dsw-alias-label-primary)}",
			".usg-pre>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".usg-cal-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}",
			".usg-cal-h .usg-calM{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".usg-cal-h>button{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;padding:4px 8px;border-radius:6px;color:var(--dsw-alias-label-secondary)}",
			".usg-cal-h>button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".usg-cal-h>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}",
			".usg-cal-h>button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default;background:none}",
			/* 月历：40px 格、数字 18px **flex 真居中**（line-height 居中在大字号下会浮上去——用户点名过）。
			 * 数字用 proportional-nums（禁 tabular）：日格各自独立成盒，不需要等宽纵列；
			 * tabular 的「1」advance 过宽，细竖线贴左、大空档贴右，"18" 这类组合在 today 圈/选中胶囊里
			 * 第一眼就是偏左（真机实测）。KPI/明细表读数仍走 tabular（跨卡对齐要它）。
			 * 形状统一圆（用户点名：又圆又方不行）：端点深灰实心圆 / 区间带浅色圆 / 今天灰色圆圈——
			 * 状态只靠颜色区分（深=选中两端，白字；浅=中间；圈=今天），形状不再表意。
			 * 配色 = 成熟 range picker 的中性语言：端点/pending 中性深灰实底（static bluish-700）+ 白字、
			 * 区间带同灰 color-mix、hover 在带内加深一档跟手、今天灰圈。
			 * ⚠ 禁 alias-brand-primary/-invert 做填充配对（它们是「墨」，浅主题黑底黑字）。
			 * ⚠ 日格是 <button>（键盘可达 + 原生 disabled），开关态挂 aria-pressed——禁挂 span/li。 */
			".usg-cal{display:grid;grid-template-columns:repeat(7,40px);gap:2px}",
			".usg-wd{display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--dsw-alias-label-secondary);line-height:28px}",
			".usg-pv{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;height:40px;border-radius:10px;cursor:pointer;font-size:18px;font-weight:500;font-variant-numeric:proportional-nums;color:var(--dsw-alias-label-primary)}",
			".usg-pv:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".usg-pv:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".usg-pv:disabled{color:var(--dsw-alias-label-dimmed);font-weight:400;cursor:default;background:none}",
			".usg-pv.usg-today{box-shadow:inset 0 0 0 1.5px var(--dsw-alias-border-l3);border-radius:20px;font-weight:600}",
			".usg-pv.usg-band,.usg-pv.usg-band:hover{background:color-mix(in srgb, var(--dsw-static-neutral-bluish-700) 18%, transparent);border-radius:20px}",
			".usg-pv.usg-band:hover{background:color-mix(in srgb, var(--dsw-static-neutral-bluish-700) 32%, transparent)}",
			".usg-pv.usg-sel,.usg-pv.usg-sel:hover,.usg-pv.usg-hend,.usg-pv.usg-hend:hover{background:var(--dsw-static-neutral-bluish-700);color:var(--dsw-static-neutral-bluish-00);border-radius:20px;font-weight:600}",
			".usg-pop-ft{display:flex;margin-top:8px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:6px}",
			".usg-pop-ft>button{all:unset;box-sizing:border-box;cursor:pointer;font-size:13px;line-height:1.5;padding:2px 6px;margin-left:-6px;border-radius:6px;color:var(--dsw-alias-label-secondary)}",
			".usg-pop-ft>button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".usg-pop-ft>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}",
			".usg-pop-ft>button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default;background:none}",
			/* 全家桶 dock pill（会话输入框下方，与宿主统计 pill 并排；只在主会话渲染，子代理会话内为 null）。
			 * 展开面板走 in-flow（不 portal、不量锚点）：dock 行内直接撑开，无定位与层阶问题。 */
			".usg-fam{display:inline-flex;flex-direction:column;gap:6px;max-width:100%}",
			".usg-famPill{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}",
			".usg-famPill:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}",
			".usg-famPill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".usg-famPanel{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-module-platform);padding:8px 10px;font-size:12px;min-width:240px;max-width:420px}",
			".usg-famTotal{margin:0 0 6px;font-size:13px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
			".usg-famFoot{margin:6px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			/* 设置页开关行（纯行排版，无自开滚动、无根 padding，§4.4） */
			".usg-optRow{display:flex;align-items:center;gap:10px}",
			".usg-optText{display:flex;flex-direction:column;gap:2px}",
			".usg-optLabel{font-size:13px;color:var(--dsw-alias-label-primary)}",
			".usg-optRow input[type=checkbox]{width:16px;height:16px;accent-color:var(--dsw-alias-label-secondary)}",
			// 动效自护（§4.3；宿主 ui-theme 无全局兜底）
			"@media (prefers-reduced-motion: reduce){.usg-groupChev{transition:none;transform:none}.usg-groupToggle[aria-expanded=true] .usg-groupChev{transform:rotate(-90deg)}}",
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
			// 刻度阶梯：具体数 <1K → K(≥1e3, 1 位小数) → M(≥1e6, 2 位) → B(≥100M, 2 位)；尾零去除（10K 不写 10.0K）。
			if (n >= 1e8) return trimZero((n / 1e9).toFixed(2)) + "B";
			if (n >= 1e6) return trimZero((n / 1e6).toFixed(2)) + "M";
			if (n >= 1e3) return trimZero((n / 1e3).toFixed(1)) + "K";
			return String(Math.round(n));
		}
		function trimZero(s) {
			return s.indexOf(".") >= 0 ? s.replace(/0+$/u, "").replace(/\.$/u, "") : s;
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

		/* ---------- 复用件替身（primitives 缺席才走；正常路径由浏览器件断言不走这里） ---------- */
		function chevIcon(cls) {
			if (UI && UI.IconChevronDownOutline14) return h(UI.IconChevronDownOutline14, { className: cls, "aria-hidden": "true" });
			return null;
		}
		function sideIcon(which, cls) {
			var C = which === "left" ? UI && UI.IconChevronLeftOutline14 : UI && UI.IconChevronRightOutline14;
			if (C) return h(C, { className: cls, "aria-hidden": "true" });
			return h("span", { "aria-hidden": "true" }, which === "left" ? "‹" : "›");
		}
		function refreshIcon() {
			if (UI && UI.IconRefreshOutline14) return h(UI.IconRefreshOutline14, { "aria-hidden": "true" });
			return null;
		}

		/* ---------- 分节组（宿主 inventory 形：折叠头 + 计数副行，默认展开） ---------- */
		function Group(props) {
			var id = "usg-g-" + props.id;
			var _o = useState(true),
				open = _o[0],
				setOpen = _o[1];
			return h(
				"section",
				{ className: "usg-group" },
				h(
					"div",
					{ className: "usg-groupHead" },
					h(
						"button",
						{
							type: "button",
							className: "usg-groupToggle",
							"aria-expanded": open,
							"aria-controls": id,
							onClick: function () {
								setOpen(!open);
							},
						},
						chevIcon("usg-groupChev"),
						h("span", { className: "usg-groupTitle" }, props.title),
					),
				),
				h("p", { className: "usg-groupSub" }, props.summary),
				open ? h("div", { id: id }, props.children) : null,
			);
		}

		/* ---------- 浮层骨架（月历宿主无件：portal + 宿主锚定/关闭 hook；两者缺席退就地定位） ---------- */
		function Anchored(props) {
			var rootRef = useRef(null);
			var panelRef = useRef(null);
			var hostPos =
				UI && UI.useAnchoredPosition ? UI.useAnchoredPosition({ open: props.open, anchorRef: rootRef, panelRef: panelRef, gap: 4, margin: 12 }) : null;
			var _f = useState(null),
				fallbackPos = _f[0],
				setFallbackPos = _f[1];
			var close = useCallback(
				function (v) {
					if (v === false && props.onClose) props.onClose();
				},
				[props],
			);
			// 外点即关：优先宿主 hook（与 Menu 同一骨架、同一时机语义）；缺席退本地 pointerdown。
			if (UI && UI.useDismissOnOutsidePointer) {
				UI.useDismissOnOutsidePointer(rootRef, props.open, close, panelRef);
			} else {
				useEffect(
					function () {
						if (!props.open || typeof document === "undefined") return;
						var onDown = function (e) {
							var t = e.target;
							if (rootRef.current && rootRef.current.contains(t)) return;
							if (panelRef.current && panelRef.current.contains(t)) return;
							if (props.onClose) props.onClose();
						};
						document.addEventListener("pointerdown", onDown, true);
						return function () {
							document.removeEventListener("pointerdown", onDown, true);
						};
					},
					[props.open, props.onClose],
				);
			}
			// Escape 只关浮层（宿主面板也监听 Esc 关整窗——不 stop 就是浮层开着按 Esc 把设置窗一起关掉）
			useEffect(
				function () {
					if (!props.open || typeof document === "undefined") return;
					var onKey = function (e) {
						if (e.key === "Escape") {
							e.stopPropagation();
							if (props.onClose) props.onClose();
						}
					};
					document.addEventListener("keydown", onKey, true);
					return function () {
						document.removeEventListener("keydown", onKey, true);
					};
				},
				[props.open, props.onClose],
			);
			// 无宿主 hook 时测一次锚点矩形（够兜底路用；常路 useAnchoredPosition 会跟滚动/缩放重算）
			useEffect(
				function () {
					if (!props.open || (UI && UI.useAnchoredPosition) || !rootRef.current || typeof window === "undefined") return;
					var r = rootRef.current.getBoundingClientRect();
					setFallbackPos({ position: "fixed", left: r.left, top: r.bottom + 4 });
				},
				[props.open],
			);
			var panel = props.open
				? h(
						"div",
						{
							ref: panelRef,
							className: "usg-pop" + (hostPos || fallbackPos ? "" : " usg-popInline"),
							style: hostPos || fallbackPos || undefined,
							role: props.role || "dialog",
							"aria-label": props.label,
						},
						props.children,
					)
				: null;
			return h(
				"span",
				{ className: "usg-anchor", ref: rootRef },
				props.trigger,
				panel && ReactDOM && ReactDOM.createPortal ? ReactDOM.createPortal(panel, document.body) : panel,
			);
		}

		/* ---------- KPI（<dl>/<dt>/<dd>：读数必须带标签，禁裸 <b>+<span>） ---------- */
		function kpi(label, value, sub) {
			return h("div", { className: "usg-kpi" }, h("dt", null, label), h("dd", null, value), sub ? h("dd", { className: "usg-kpiSub" }, sub) : null);
		}
		function table(title, head, rows) {
			return h(
				"table",
				{ className: "usg-table" },
				h("caption", { className: "usg-sr" }, title),
				h(
					"thead",
					null,
					h(
						"tr",
						null,
						head.map(function (x, i) {
							return h("th", { key: i, scope: "col" }, x);
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
			);
		}

		/* ---------- RangePicker：触发器（haspopup+expanded）+ 预设 + 月历两段式 + 清除 ---------- */
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
			});
			var month = _m[0],
				setMonth = _m[1];

			function shift(n) {
				setMonth(function (x) {
					var d = new Date(x.y, x.m + n, 1);
					return { y: d.getFullYear(), m: d.getMonth() };
				});
			}
			function close() {
				setOpen(false);
				setPick(null);
				setHov(null);
			}
			function commit(a, b) {
				var from = a <= b ? a : b;
				var to = a <= b ? b : a;
				props.onChange({ from: from, to: to });
				setPick(null);
				setHov(null);
				setOpen(false);
			}
			function pickDay(d) {
				if (pick === null) setPick(d);
				else commit(pick, d);
			}
			// 预览范围：起点已定 + 当前悬停（拾取中只显示 pending/预览，暂隐已提交区间，避免两套高亮打架）
			var picking = pick !== null;
			var lo = null,
				hi = null;
			if (picking && hov !== null) {
				lo = hov < pick ? hov : pick;
				hi = hov < pick ? pick : hov;
			}
			var today = todayYmd();
			var cells = [];
			var first = new Date(month.y, month.m, 1);
			var lead = (first.getDay() + 6) % 7; // 周一起始偏移
			var days = new Date(month.y, month.m + 1, 0).getDate();
			var WEEK = ["一", "二", "三", "四", "五", "六", "日"];
			/** 单日格 = 真 <button>（键盘可达 + 原生 disabled）。必须走函数参数建独立绑定：曾用循环内 var d
			 *  让闭包共享末值，结果当月所有格点都被「月末日 > today」吞掉、历史月点谁都是选月末（v3 实锤）。 */
			function dayCell(d, num) {
				var disabled = d > today;
				var isEdge = !picking && !!win && (d === win.from || d === win.to);
				var isMid = !picking && !!win && d > win.from && d < win.to;
				var isPending = picking && d === pick;
				var isPrev = picking && lo !== null && d > lo && d < hi;
				var sel = isEdge || isPending;
				// 拾取中鼠标当前格 = tentative 另一端，也画实心端点胶囊（纯视觉，不占 aria-pressed）
				var isHoverEnd = picking && hov !== null && d === hov && d !== pick;
				var cls =
					"usg-pv" +
					(sel ? " usg-sel" : isHoverEnd ? " usg-hend" : isMid || isPrev ? " usg-band" : "") +
					(!sel && !isHoverEnd && d === today ? " usg-today" : "");
				return h(
					"button",
					{
						key: d,
						type: "button",
						className: cls,
						disabled: disabled,
						"aria-pressed": sel ? "true" : undefined,
						"aria-label": d,
						onClick: function () {
							if (!disabled) pickDay(d);
						},
						onMouseEnter: function () {
							if (!disabled) setHov(d);
						},
					},
					String(num),
				);
			}
			var i;
			for (i = 0; i < lead; i++) cells.push(h("span", { key: "b" + i }));
			for (i = 1; i <= days; i++) cells.push(dayCell(month.y + "-" + p2(month.m + 1) + "-" + p2(i), i));
			return h(
				Anchored,
				{
					open: open,
					onClose: close,
					label: "选择日期范围",
					trigger: h(
						"button",
						{
							type: "button",
							className: "usg-btn",
							"aria-haspopup": "dialog",
							"aria-expanded": open,
							onClick: function () {
								setOpen(!open);
							},
						},
						h("span", { className: "usg-muted" }, "区间"),
						winLabel(win),
						chevIcon(""),
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
								type: "button",
								onClick: function () {
									var w = p[1]();
									props.onChange({ from: w[0], to: w[1] });
									setOpen(false);
								},
							},
							p[0],
						);
					}),
				),
				h(
					"div",
					{ className: "usg-cal-h" },
					h(
						"button",
						{
							type: "button",
							onClick: function () {
								shift(-1);
							},
							"aria-label": "上一月",
						},
						sideIcon("left"),
					),
					h("h3", { className: "usg-calM" }, month.y + " 年 " + (month.m + 1) + " 月"),
					h(
						"button",
						{
							type: "button",
							onClick: function () {
								shift(1);
							},
							"aria-label": "下一月",
						},
						sideIcon("right"),
					),
				),
				h(
					"div",
					{ className: "usg-cal", role: "group", "aria-label": month.y + " 年 " + (month.m + 1) + " 月日格" },
					WEEK.map(function (w) {
						return h("span", { key: "w" + w, className: "usg-wd" }, w);
					}),
					cells,
				),
				h(
					"div",
					{ className: "usg-pop-ft" },
					h(
						"button",
						{
							type: "button",
							disabled: !win && pick === null,
							onClick: function () {
								setPick(null);
								setHov(null);
								props.onChange(null);
							},
						},
						"清除",
					),
				),
			);
		}

		/* ---------- DimSelect：服务商/模型过滤（宿主 Menu 常路：portal + 键盘 + role=menu/menuitem） ---------- */
		function DimSelect(props) {
			var _o = useState(false),
				open = _o[0],
				setOpen = _o[1];
			var options = [{ v: "", l: "全部" }].concat(props.items);
			function choose(v) {
				props.onChange(v || null);
				setOpen(false);
			}
			var trigger = h(
				"button",
				{
					type: "button",
					className: "usg-btn",
					"aria-haspopup": "menu",
					"aria-expanded": open,
					"aria-label": props.label,
					onClick: function () {
						setOpen(!open);
					},
				},
				h("span", { className: "usg-muted" }, props.label),
				props.value || "全部",
				chevIcon(""),
			);
			if (UI && UI.Menu) {
				return h(UI.Menu, {
					open: open,
					anchor: trigger,
					portal: true,
					autoFocus: true,
					align: "start",
					className: "usg-menu",
					selectedId: props.value || "",
					items: options.map(function (o) {
						return { id: o.v, label: o.l };
					}),
					onSelect: choose,
					onClose: function () {
						setOpen(false);
					},
				});
			}
			// 兜底（primitives 缺席）：原生 select，语义与键盘由浏览器保证
			return h(
				"label",
				{ className: "usg-anchor" },
				h("span", { className: "usg-sr" }, props.label),
				h(
					"select",
					{
						className: "usg-select",
						value: props.value || "",
						onChange: function (e) {
							choose(e.target.value);
						},
					},
					options.map(function (o) {
						return h("option", { key: o.v, value: o.v }, o.l);
					}),
				),
			);
		}

		/* ---------- Section 页：h2 + 筛选栏 + 三态 + KPI + 分节明细 + 数据截至脚注 ---------- */
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
			var rows = (data && data.byModel) || [];
			var filtered = !!(provider || model);
			var empty = !loading && !err && !!data && rows.length === 0;

			return h(
				"div",
				{ className: "usg-root", "aria-busy": loading },
				h(
					"header",
					{ className: "usg-head" },
					h("h2", { className: "usg-h2" }, "Token 用量"),
					h("p", { className: "usg-intro" }, "全部 workspace 会话的全局用量（本地时区按天；单会话数据请看聊天区自带统计）"),
				),
				h(FamilyOptRow, null),
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
						value: provider,
						items: pool.providers,
						onChange: function (v) {
							setProvider(v);
							setModel(null);
						},
					}),
					h(DimSelect, {
						label: "模型",
						value: model,
						items: pool.models.filter(function (o) {
							return !provider || o.v.slice(0, o.v.indexOf("/")) === provider;
						}),
						onChange: function (v) {
							setModel(v);
						},
					}),
					loading ? h("span", { className: "usg-status usg-headEnd" }, "统计中…") : null,
					h(
						"button",
						{
							type: "button",
							className: "usg-btn",
							disabled: loading,
							onClick: function () {
								setTick(function (x) {
									return x + 1;
								});
							},
						},
						refreshIcon(),
						"刷新",
					),
				),
				err
					? h(
							"div",
							null,
							h("p", { className: "usg-failure", role: "alert" }, "读取失败：" + err),
							h(
								"button",
								{
									type: "button",
									className: "usg-retry",
									onClick: function () {
										setTick(function (x) {
											return x + 1;
										});
									},
								},
								"重试",
							),
						)
					: null,

				data && !err
					? h(
							"dl",
							{ className: "usg-kpis" },
							kpi("会话数", fmt(data.sessionCount), "扫描 " + fmt(data.scannedFiles) + " 个文件"),
							kpi("总 tokens（含缓存）", fmt(t.total), fmt(t.requests || 0) + " 次请求"),
							kpi("输入（未缓存）", fmt(t.input)),
							kpi("输出", fmt(t.output)),
							kpi("缓存读", fmt(t.cacheRead), "命中率 " + fmtPct(data.hitRate)),
							kpi("缓存写", fmt(t.cacheWrite)),
						)
					: null,
				data
					? h(
							Group,
							{
								id: "model",
								title: "按模型" + (filtered ? "（已过滤）" : ""),
								summary: rows.length > 0 ? rows.length + " 行 · 合计 " + fmt(t.total) + " tokens" : "无记录",
							},
							rows.length === 0
								? h("p", { className: "usg-status" }, "该区间内没有用量记录（换区间或清掉维度过滤再看）。")
								: table(
										"按模型用量明细",
										["模型", "请求", "输入", "输出", "缓存读", "命中率"],
										rows.map(function (m) {
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
									),
						)
					: null,
				data && !err ? h("p", { className: "usg-status" }, "数据截至 " + new Date(data.generatedAt).toLocaleTimeString()) : null,
			);
		}

		/** mount/调用失败的原始报错翻译：without inject = 两端契约错位（浏览器半已刷新、host 仍是旧服务端），
		 *  明确告诉用户重启该 profile 的 host；其余错误原样透出（裸 undefined 不算错位特征，别混进来）。 */
		function humanizeError(msg) {
			if (/without inject|no longer mounted|is not a function/.test(msg)) {
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

		/* ---------- 全家桶：dock pill + 设置开关（同模块共享，与设置页同 fiber） ---------- */
		/** 开关是浏览器侧纯展示偏好（localStorage，默认开），不进服务端 config/profile。 */
		var FAMILY_KEY = "dsh-plugin-usage-stats.family-pill";
		function familyEnabledRead() {
			try {
				if (typeof window === "undefined" || !window.localStorage) return true;
				var v = window.localStorage.getItem(FAMILY_KEY);
				return v === null ? true : v !== "0";
			} catch (e) {
				return true;
			}
		}
		var familyEnabledState = familyEnabledRead();
		var familySubs = [];
		function setFamilyEnabled(v) {
			familyEnabledState = !!v;
			try {
				if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(FAMILY_KEY, familyEnabledState ? "1" : "0");
			} catch (e) {}
			for (var i = 0; i < familySubs.length; i++) {
				try {
					familySubs[i](familyEnabledState);
				} catch (e) {}
			}
		}
		function useFamilyEnabled() {
			var _s = useState(familyEnabledState),
				v = _s[0],
				setV = _s[1];
			useEffect(function () {
				familySubs.push(setV);
				return function () {
					var i = familySubs.indexOf(setV);
					if (i >= 0) familySubs.splice(i, 1);
				};
			}, []);
			return [v, setFamilyEnabled];
		}
		/** inject 工厂收到的会话身份归一化（宿主按 scope=session 传 sessionId；未知形态回空串 = 不渲染）。 */
		function normSessionId(v) {
			if (typeof v === "string") return v;
			if (v && typeof v.id === "string") return v.id;
			return "";
		}
		/** 设置页开关行（宿主 Switch 常路，缺席退原生 checkbox；纯行排版，§4.4）。 */
		function FamilyOptRow() {
			var _e = useFamilyEnabled(),
				en = _e[0],
				setEn = _e[1];
			var control =
				UI && UI.Switch
					? h(UI.Switch, { checked: en, onChange: setEn, label: "会话底部全家用量开关" })
					: h("input", {
							type: "checkbox",
							role: "switch",
							"aria-checked": en,
							"aria-label": "会话底部全家用量开关",
							checked: en,
							onChange: function (e) {
								setEn(e.target.checked);
							},
						});
			return h(
				"div",
				{ className: "usg-optRow" },
				h(
					"div",
					{ className: "usg-optText" },
					h("span", { className: "usg-optLabel" }, "会话底部“全家”"),
					h("span", { className: "usg-muted" }, "主会话输入框下方显示本会话 + 全部子代理合计（子代理会话内不显示）"),
				),
				control,
			);
		}
		/** dock 全家桶 pill：关闭/未知/子代理/零用量 → null；展开面板走 in-flow（不 portal）。 */
		function FamilyPill(props) {
			var sessionId = normSessionId(props && props.familySessionId);
			var _e = useFamilyEnabled(),
				en = _e[0];
			var _d = useState(null),
				data = _d[0],
				setData = _d[1];
			var _o = useState(false),
				open = _o[0],
				setOpen = _o[1];
			var alive = useRef(0);
			var load = useCallback(
				async function () {
					if (!sessionId || typeof props.familyTotal !== "function") return;
					var my = ++alive.current;
					try {
						var r = await props.familyTotal({ sessionId: sessionId });
						if (!r.ok) return;
						if (alive.current === my) setData(r.value);
					} catch (e) {
						/* 输入区徽标：失败即保持隐藏，不打扰输入（全量错误面在设置页）。 */
					}
				},
				[props.familyTotal, sessionId],
			);
			useEffect(
				function () {
					if (en && sessionId) load();
					else setData(null);
				},
				[en, sessionId, load],
			);
			if (!en || !data || !data.known || data.isSubagent || !data.totals || !(data.totals.total > 0)) return null;
			var t = data.totals;
			var rows = data.byModel || [];
			return h(
				"span",
				{ className: "usg-fam" },
				h(
					"button",
					{
						type: "button",
						className: "usg-famPill",
						"aria-expanded": open,
						"aria-label": "全家桶用量" + fmt(t.total) + "tok，共" + data.sessionCount + "个会话",
						onClick: function () {
							var next = !open;
							setOpen(next);
							if (next) load();
						},
					},
					"全家 " + fmt(t.total) + " tok",
				),
				open
					? h(
							"div",
							{ className: "usg-famPanel", role: "dialog", "aria-label": "全家桶用量" },
							h("p", { className: "usg-famTotal" }, "共 " + fmt(t.total) + " tok · " + data.sessionCount + " 个会话 · 命中率 " + fmtPct(data.hitRate)),
							table(
								"全家桶按模型",
								["模型", "请求", "输入", "输出", "缓存读", "命中率"],
								rows.map(function (m) {
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
							),
							h("p", { className: "usg-famFoot" }, "数据截至 " + new Date(data.generatedAt).toLocaleTimeString()),
						)
					: null,
			);
		}

		/* ---------- cordis 客户端插件入口 ---------- */
		var inject = ["slots", "remote"];

		function apply(ctx) {
			ensureCss();
			var mounted = ctx.remote.$mount(CONTRIBUTION);
			mounted.then(null, function () {}); // 无人等待时兜底，防未处理 rejection；页内 await 仍会把错误抛给 try/catch
			// 设置弹窗左导航栏的独立 section 页（order 30：general0/models10/plugins15/agent-presets20 之后；
			// 导航图标由宿主按 section id 决定，未知回落齿轮——插件不注入 nav icon）。
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
			// 会话输入框下方的全家桶 pill（order 1：宿主自带统计 order 0 之后；只在主会话渲染）。
			// inject 工厂按 scope=session 收 sessionId，经 normSessionId 后以 familySessionId 下发。
			ctx.effect(function () {
				return ctx.slots.inject("conversation.composer.dock", function () {
					return ctx.slots.register(
						{
							name: "conversation.composer.dock",
							id: "family-total",
							order: 1,
							inject: function (sessionId) {
								return {
									familySessionId: normSessionId(sessionId),
									familyTotal: function (filter) {
										return mounted.then(function () {
											return ctx.get("remote.usageStats").familyTotal(filter);
										});
									},
								};
							},
						},
						FamilyPill,
					);
				});
			}, "usage-stats: family pill");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
