/** lib/client.js 浏览器半 RangePicker 行为测试（静态 harness 模式，AGENTS「浏览器半改动=本地 fixture + 自起实例」）。
 *  为什么存在：v3 日格构建在 for 循环里用 `var d` + 闭包读共享末值——当月格全部被「月末日>today」的
 *  disabled 吞掉点击、历史月点谁都提交成月末；三道门全绿也照样上线（纯 Node 测不到浏览器半语义）。
 *  本文件用一个同步 mini React 真渲染组件树、真派发事件，断言逐格独立绑定 + 选中态类名 + 文案规格。
 *  宿主注入对象（ctx/document/$mount/slots）均为桩，按 AGENTS 完成标准 1 允许宽 any；被测的 client 代码是真身。 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { collectMotionGuardViolations, collectSectionPageStructureViolations } from "dsh-check";

const CLIENT = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/* ---------- mini React：整树同步重渲，无 reconciler 需求；桩，宽类型有注释豁免 ---------- */
const FRAG = "$$harness-fragment";

function makeRuntime() {
  const instances = new Map<string, { hooks: any[]; idx: number }>();
  let cur: { hooks: any[]; idx: number } | null = null;
  let dirty = true;
  let tree: any = null;
  let rootVnode: any = null;

  function createElement(type: any, props: any, ...children: any[]) {
    const p = { ...(props || {}) };
    if (children.length === 1) p.children = children[0];
    else if (children.length > 1) p.children = children;
    return { type, props: p };
  }
  function slot<T = any>(): { inst: any; i: number; v: T } {
    const inst = cur as any;
    assert.ok(inst, "hook called outside component render");
    const i = inst.idx++;
    return { inst, i, v: undefined as unknown as T };
  }
  function useState(init: any) {
    const { inst, i } = slot();
    if (!(i in inst.hooks)) inst.hooks[i] = typeof init === "function" ? init() : init;
    const set = (v: any) => {
      inst.hooks[i] = typeof v === "function" ? v(inst.hooks[i]) : v;
      dirty = true;
    };
    return [inst.hooks[i], set];
  }
  function useRef(v: any) {
    const { inst, i } = slot();
    if (!(i in inst.hooks)) inst.hooks[i] = { current: v };
    return inst.hooks[i];
  }
  function useCallback(fn: any) {
    slot();
    return fn;
  }
  function useEffect() {
    slot(); // harness 不跑副作用：load 发起的 remote 请求与本测试无关
  }
  function build(el: any, path: string): any {
    if (el === null || el === undefined || el === false || el === true) return null;
    if (typeof el === "string" || typeof el === "number") return { text: String(el) };
    if (Array.isArray(el)) {
      const flat = el.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true);
      return { type: FRAG, children: flat.map((c, i) => build(c, path + "/~" + i)).filter(Boolean) };
    }
    if (typeof el.type === "function") {
      const name = el.type.name || "Anon";
      const cpath = path + "@" + name;
      let inst = instances.get(cpath);
      if (!inst) {
        inst = { hooks: [], idx: 0 };
        instances.set(cpath, inst);
      }
      const prev = cur;
      cur = inst;
      inst.idx = 0;
      let out: any;
      try {
        out = el.type(el.props);
      } finally {
        cur = prev;
      }
      return build(out, cpath);
    }
    const kids = el.props.children;
    const list: any[] = kids === null || kids === undefined ? [] : Array.isArray(kids) ? kids : [kids];
    return { type: el.type, props: el.props, children: list.map((c, i) => build(c, path + "/" + i)).filter(Boolean) };
  }
  function flush() {
    let guard = 0;
    for (;;) {
      if (!dirty) break;
      if (++guard > 60) throw new Error("mini-react: rerender loop");
      dirty = false;
      tree = build(rootVnode, "r");
    }
    return tree;
  }
  return {
    react: { createElement, Fragment: FRAG, useState, useRef, useCallback, useEffect },
    mount(vnode: any) {
      instances.clear();
      rootVnode = vnode;
      dirty = true;
      return flush();
    },
    flush,
    get tree() {
      return tree;
    },
  };
}

/* ---------- 树查询与事件派发 ---------- */
function walk(node: any, fn: (n: any) => void) {
  if (!node) return;
  fn(node);
  (node.children || []).forEach((c: any) => walk(c, fn));
}
function collect(rt: any, pred: (n: any) => boolean) {
  const acc: any[] = [];
  walk(rt.tree, (n) => {
    if (n.props && pred(n)) acc.push(n);
  });
  return acc;
}
function textOf(node: any): string {
  if (!node) return "";
  if (node.text !== undefined) return node.text;
  return (node.children || []).map(textOf).join("");
}
function fire(node: any, prop: "onClick" | "onMouseEnter" | "onMouseDown", rt: any) {
  assert.ok(node, "target node missing (can't fire " + prop + ")");
  const fn = node.props[prop];
  assert.equal(typeof fn, "function", prop + " handler missing");
  fn({ stopPropagation() {} });
  rt.flush();
}

/* ---------- 挂载整页（apply(ctx) → 注册的 section 组件） ---------- */
function mountPage() {
  const rt = makeRuntime();
  let mod: any;
  const sandbox: any = {
    window: {
      __ModuleLoader__: {
        load: (m: any) => {
          mod = m;
        },
      },
    },
    document: { createElement: () => ({ setAttribute() {}, textContent: "" }), head: { appendChild() {} }, body: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT, sandbox);
  /* 浏览器半 require 的 id 必须全在宿主冻结模块种子表里（STANDARDS §4.3），本桩只给这三家：
   * react = mini React；react-dom 的 createPortal 就地返回节点（否则测不到浮层子树）；
   * primitives = 真形 hook/Menu/图标——桩走**常路**（宿主 Menu + 宿主锚定/关闭 hook），
   * 兜底路（原生 select / 就地弹层）由源码闸点名，不在这儿测。 */
  const createElement = rt.react.createElement;
  const fakeMenu = function HarnessMenu(props: any) {
    return createElement(
      "span",
      null,
      props.anchor,
      props.open
        ? createElement(
            "div",
            { className: "harness-menu-list " + (props.className || ""), role: "menu" },
            (props.items || []).map((it: any) =>
              createElement(
                "button",
                {
                  key: it.id,
                  type: "button",
                  role: "menuitem",
                  "aria-selected": props.selectedId === it.id ? "true" : undefined,
                  onClick: () => props.onSelect(it.id),
                },
                it.label,
              ),
            ),
          )
        : null,
    );
  };
  const stubModules: Record<string, any> = {
    react: rt.react,
    "react-dom": { createPortal: (node: any) => node },
    "@deepseek-ai/dsh-client-ui-primitives": {
      Menu: fakeMenu,
      useAnchoredPosition: () => ({ left: 0, top: 0 }),
      useDismissOnOutsidePointer: () => {},
      IconChevronDownOutline14: (p: any) => createElement("svg", { ...p, "data-icon": "chevron-down" }),
      IconChevronLeftOutline14: (p: any) => createElement("svg", { ...p, "data-icon": "chevron-left" }),
      IconChevronRightOutline14: (p: any) => createElement("svg", { ...p, "data-icon": "chevron-right" }),
      IconRefreshOutline14: (p: any) => createElement("svg", { ...p, "data-icon": "refresh" }),
    },
  };
  const exports: any = mod.factory((id: string) => {
    if (!(id in stubModules)) throw new Error("浏览器半 require 了种子表外的模块：" + id);
    return stubModules[id];
  });
  let sectionComp: any = null;
  const regs: any[] = [];
  const ctx: any = {
    effect: (fn: any) => fn(),
    slots: {
      inject: (_slot: string, factory: any) => factory(),
      // 本包注册两个槽位（settings.section + composer.dock 合计 pill）：设置页断言只采前者。
      register: (meta: any, comp: any) => {
        regs.push({ meta, comp });
        if (meta && meta.name === "settings.section") sectionComp = comp;
      },
    },
    remote: { $mount: () => Promise.resolve() },
    get: () => ({ overview: async () => ({ ok: true, value: null }) }),
  };
  exports.apply(ctx);
  assert.ok(sectionComp, "settings.section 组件未注册");
  rt.mount(sectionComp());
  (rt as any).regs = regs;
  return rt;
}

const p2 = (n: number) => (n < 10 ? "0" + n : String(n));
const NOW = new Date();
const TODAY = NOW.getFullYear() + "-" + p2(NOW.getMonth() + 1) + "-" + p2(NOW.getDate());
const PREV = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const PREV_YM = PREV.getFullYear() + "-" + p2(PREV.getMonth() + 1);
const CUR_YM = NOW.getFullYear() + "-" + p2(NOW.getMonth() + 1);

/** 触发器按 haspopup 语义定位（§4.4：禁 title 当唯一说明、禁 aria-pressed 当弹层态）。 */
const trigger = (rt: any) => collect(rt, (n) => n.type === "button" && n.props["aria-haspopup"] === "dialog")[0];
/** 触发器文案 = 「区间」标签 + 当前窗口值（winLabel），断言只认后半截。 */
const triggerWin = (rt: any) => textOf(trigger(rt)).replace(/^区间/, "");
const cells = (rt: any) => collect(rt, (n) => typeof n.props.className === "string" && n.props.className.indexOf("usg-pv") === 0);
const cellBy = (rt: any, key: string) => cells(rt).find((c) => c.props.key === key);
const selCells = (rt: any) => cells(rt).filter((c) => c.props.className.indexOf("usg-sel") > 0);
const clearBtn = (rt: any) => collect(rt, (n) => n.type === "button" && textOf(n) === "清除")[0];
const navBtn = (rt: any, label: string) => collect(rt, (n) => n.type === "button" && n.props["aria-label"] === label)[0];

test("RangePicker：初始挂载——今天为选中态（brand 药丸），预设行无「全部」，脚注只有「清除」", () => {
  const rt = mountPage();
  assert.equal(triggerWin(rt), "今天");
  assert.equal(trigger(rt).props["aria-expanded"], false, "初始应折叠");
  fire(trigger(rt), "onClick", rt);
  assert.equal(trigger(rt).props["aria-expanded"], true, "弹层触发器用 aria-expanded 报开合（非 aria-pressed）");
  assert.ok(cells(rt).length >= 28, "月历未渲染");
  const t = cellBy(rt, TODAY);
  assert.ok(t, "今天格未渲染");
  assert.match(t.props.className, /usg-sel/);
  assert.equal(t.type, "button", "日格必须是真按钮（键盘可达）");
  assert.equal(t.props["aria-pressed"], "true");
  assert.ok(selCells(rt).length === 1, "初始应只有今天被高亮");
  // 预设行：只剩窗口快捷键，「全部」由底部「清除」唯一承担
  const preRow = collect(rt, (n) => n.props.className === "usg-pre")[0];
  const preLabels: string[] = [];
  walk(preRow, (n) => {
    if (n.type === "button") preLabels.push(textOf(n));
  });
  assert.deepEqual(preLabels, ["今天", "近3天", "近7天", "近30天"]);
  // 脚注文案规格：无「点选起止日」类说明文，只有 2 字「清除」
  assert.ok(clearBtn(rt), "缺少「清除」按钮");
  const popText: string[] = [];
  walk(rt.tree, (n) => {
    if (n.text !== undefined) popText.push(n.text);
  });
  assert.ok(!popText.some((s) => /点选起止日|已选起点|清除（/.test(s)), "残留旧交互提示文案");
});

test("RangePicker：跨月两段式选取——逐格独立绑定（闭包共享末值 bug 的回归闸）", () => {
  const rt = mountPage();
  fire(trigger(rt), "onClick", rt);
  fire(navBtn(rt, "上一月"), "onClick", rt);
  const d5 = PREV_YM + "-05";
  const d12 = PREV_YM + "-12";
  fire(cellBy(rt, d5), "onClick", rt);
  // 起点只可能落在被点的那一格：曾经这里全部读成月末或干脆点不动
  const sel = selCells(rt);
  assert.equal(sel.length, 1, "拾取中应只有一个 pending 高亮");
  assert.equal(sel[0].props.key, d5);
  fire(cellBy(rt, d12), "onMouseEnter", rt);
  // 鼠标当前格 = tentative 端点：必须画成实心端点胶囊（用户点名「选到哪、哪高亮」），但非 committed 不占 aria-pressed
  assert.match(cellBy(rt, d12).props.className, /usg-hend/);
  assert.equal(cellBy(rt, d12).props["aria-pressed"], undefined);
  for (const mid of ["06", "07", "08", "09", "10", "11"]) {
    assert.match(cellBy(rt, PREV_YM + "-" + mid).props.className, /usg-band/, mid + " 应在预览带内");
  }
  fire(cellBy(rt, d12), "onClick", rt);
  assert.equal(cells(rt).length, 0, "commit 后浮层应关闭");
  assert.equal(triggerWin(rt), d5.slice(5) + " → " + d12.slice(5));
  // 重开：端点=sel 药丸、中间=区间底带、其余无选中类且 aria-pressed 撤销
  fire(trigger(rt), "onClick", rt);
  assert.match(cellBy(rt, d5).props.className, /usg-sel/);
  assert.match(cellBy(rt, d12).props.className, /usg-sel/);
  assert.match(cellBy(rt, PREV_YM + "-08").props.className, /usg-band/);
  assert.match(cellBy(rt, PREV_YM + "-01").props.className, /^usg-pv$/);
  assert.equal(cellBy(rt, d5).props["aria-pressed"], "true");
  assert.equal(cellBy(rt, PREV_YM + "-08").props["aria-pressed"], undefined);
});

test("RangePicker：「清除」回全部且不关浮层；未来日不可点；单日=同格点两次", () => {
  const rt = mountPage();
  fire(trigger(rt), "onClick", rt);
  fire(navBtn(rt, "上一月"), "onClick", rt);
  fire(clearBtn(rt), "onClick", rt);
  // 未选任何范围时「清除」应置灰（当前 win 是默认今天 → 第一下真的清了）
  assert.equal(triggerWin(rt), "全部");
  assert.ok(cells(rt).length >= 28, "「清除」不应关闭浮层");
  fire(clearBtn(rt), "onClick", rt);
  assert.equal(clearBtn(rt).props.disabled, true, "已处「全部」态时应真 disabled（原生禁点，不靠 aria 装饰）");
  // 回到当月：未来日全部原生 disabled 且点击无效
  fire(navBtn(rt, "下一月"), "onClick", rt);
  const dimmed = cells(rt).filter((c) => c.props.disabled === true);
  const lastDay = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate();
  if (lastDay > NOW.getDate()) {
    assert.ok(dimmed.length > 0, "当月应有未来日禁格");
    const before = selCells(rt).length;
    fire(dimmed[0], "onClick", rt);
    assert.equal(selCells(rt).length, before, "禁格点击不得进入拾取");
  }
  // 今天单日：点一次 pending、再点同格 commit
  const t = cellBy(rt, TODAY);
  fire(t, "onClick", rt);
  assert.match(cellBy(rt, TODAY).props.className, /usg-sel/);
  fire(cellBy(rt, TODAY), "onClick", rt);
  assert.equal(cells(rt).length, 0);
  assert.equal(triggerWin(rt), "今天");
});

test("RangePicker：今天标记与样式规格（40px 大格、18px/500 数字 flex 真居中、选中中性灰非蓝、选择器不互压）", () => {
  const rt = mountPage();
  fire(trigger(rt), "onClick", rt);
  fire(clearBtn(rt), "onClick", rt); // win=null → 今天格显示 today 标记
  assert.match(cellBy(rt, TODAY).props.className, /usg-today/);
  // 静态规格闸：字体/格径/类名/选中色迁移一旦回潮当场红
  // 居中铁律：flex 三件套（line-height 居中在大字号下会浮到格子上部——用户点名「字占上1/3」）
  // 数字用 proportional（日格独立成盒不用等宽；tabular 的「1」advance 过宽致 today 圈里偏左——用户点名）
  assert.match(
    CLIENT,
    /\.usg-pv\{(all:unset;box-sizing:border-box;)?display:flex;align-items:center;justify-content:center;height:40px;[^"]*font-size:18px;font-weight:500;font-variant-numeric:proportional-nums/,
    "日格必须 flex 真居中（line-height 居中在大字号下浮上去）",
  );
  assert.match(CLIENT, /\.usg-pv:disabled\{[^}]*cursor:default/, "未来日要真禁点：disabled 样式必须存在（不再是 aria-disabled 装饰）");
  // 全屏 mask 禁回潮（头注释里那段「旧版违则」记述文字不算产物，故只扫 CSS 块）
  const cssBlock = CLIENT.slice(CLIENT.indexOf("var CSS"), CLIENT.indexOf("var cssDone"));
  assert.doesNotMatch(CLIENT, /usg-mask/, "旧版全屏 mask 类名不得回潮");
  assert.doesNotMatch(cssBlock, /inset\s*:\s*0/, "禁自铺 inset:0 全屏遮罩（压在宿主左导航与关闭 X 之上）");
  // 端点 = 中性深灰 bluish-700 实底 + 白字（用户禁 brand 蓝；alias-brand-primary 是墨色 token 更不可当填充——
  // 浅色主题黑底黑字选中即隐形，v3.1 真机踩实，两向都禁止回潮）
  assert.match(CLIENT, /\.usg-pv\.usg-sel[^{]*\{background:var\(--dsw-static-neutral-bluish-700\);color:var\(--dsw-static-neutral-bluish-00\)/);
  assert.doesNotMatch(CLIENT, /\.usg-pv[^{]*\{[^}]*background:var\(--dsw-(static-deepseek-\d+|alias-brand-primary)\)/);
  // 形状统一圆（用户点名：端点圆 + 区间方块混用不行）：区间带与 today 圈都必须是 20px 正圆，
  // 状态只靠颜色区分（深实心=选中两端，浅=中间，圈=今天）
  assert.match(CLIENT, /\.usg-pv\.usg-band[^{]*\{[^}]*border-radius:20px/, "区间带须与端点同形（正圆），方块回潮即红");
  assert.match(CLIENT, /\.usg-pv\.usg-today\{[^}]*border-radius:20px/, "today 圈须与端点同形（正圆），方块回潮即红");
  assert.match(CLIENT, /\.usg-wd\{/);
  assert.doesNotMatch(CLIENT, /\.usg-cal>span/);
  assert.doesNotMatch(CLIENT, /usg-(e|in)\b|usg-(mid|prev)\b/);
  assert.doesNotMatch(CLIENT, /点选起止日|清除（全部）|已选起点/);
  assert.doesNotMatch(CLIENT, /--dsw-alias-label-error|--dsw-alias-button-ghost-active-fill/);
});

test("浏览器半 CSS 的 --dsw-* token 全部由宿主主题真定义（离线版 __TOKEN_AUDIT__）", (t) => {
  const home = process.env.HOME || "";
  const THEME =
    process.env.DSH_THEME_CLIENT_JS || home + "/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js";
  if (!home || !existsSync(THEME)) {
    t.skip("宿主主题包不在本机（CI 环境），真机 token 审计由 __TOKEN_AUDIT__ harness 兜底");
    return;
  }
  const defined = new Set([...readFileSync(THEME, "utf8").matchAll(/--dsw-[a-z0-9-]+(?=\s*:)/g)].map((m) => m[0]));
  const cssBlock = CLIENT.slice(CLIENT.indexOf("var CSS"), CLIENT.indexOf("var cssDone"));
  const referenced = [...new Set([...cssBlock.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((m) => m[1]))];
  assert.ok(referenced.length >= 15, "token 提取异常（CSS 块定位失败？）");
  const undef = referenced.filter((x) => !defined.has(x));
  assert.deepEqual(undef, [], "引用了宿主未定义的 token");
});

test("§4.4 常路：维度下拉走宿主 Menu（portal + role=menu/menuitem + 键盘由宿主给），且现稿过工作区结构门", () => {
  const rt = mountPage();
  /** mini React 每次 flush 造新 vnode，断言前必须重查（拿旧节点会读到过期 props）。 */
  const dimTrigger = () => collect(rt, (n) => n.type === "button" && n.props["aria-haspopup"] === "menu")[0];
  assert.ok(dimTrigger(), "服务商/模型过滤触发器缺失（aria-haspopup=menu）");
  assert.equal(dimTrigger().props["aria-pressed"], undefined, "弹层触发器禁 aria-pressed（开合走 aria-expanded）");
  assert.equal(dimTrigger().props["aria-expanded"], false);
  fire(dimTrigger(), "onClick", rt);
  assert.equal(dimTrigger().props["aria-expanded"], true, "宿主 Menu 的开合态挂在触发器 aria-expanded 上");
  const menuItems = collect(rt, (n) => n.props.role === "menuitem");
  assert.ok(menuItems.length >= 1, "宿主 Menu 未渲染 role=menuitem 项（常路没走到 primitives？）");
  assert.equal(textOf(menuItems[0]), "全部");
  // 真定义令牌审计 + 结构门：现稿必须零违则（门在 dsh-check，规则与 STANDARDS §4.4 同源）
  assert.deepEqual(collectSectionPageStructureViolations(CLIENT), [], "STANDARDS §4.4 分区页结构门");
  assert.deepEqual(collectMotionGuardViolations(CLIENT), [], "STANDARDS §4.3 动效自护门");
  assert.match(CLIENT, /create: function \(\)/, "网关 ≥0.1.6 硬门：strict codec 必须带 create() 工厂");
  const requires = [...CLIENT.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(requires, ["@deepseek-ai/dsh-client-ui-primitives", "react", "react-dom"], "浏览器半 require 必须全在宿主冻结模块种子表内（§4.3）");
});

test("合计接线：dock 注册与 settings.section 并存，inject 透传 sessionId", () => {
  const rt = mountPage();
  const regs = (rt as any).regs as any[];
  const names = regs.map((r) => r.meta && r.meta.name).sort();
  assert.deepEqual(names, ["conversation.composer.dock", "plugins.item", "settings.section"], "三个槽位都要注册，互不得冲掉");
  const dock = regs.find((r) => r.meta && r.meta.name === "conversation.composer.dock");
  assert.equal(dock.meta.id, "family-total");
  assert.equal(dock.meta.order, 1, "宿主自带统计 order 0 之后");
  assert.equal(typeof dock.meta.inject, "function", "dock 项必须带 inject 工厂透传 sessionId");
  const wired = dock.meta.inject("sess-1");
  assert.equal(wired.familySessionId, "sess-1", "字符串 sessionId 原样透传");
  assert.equal(typeof wired.familyTotal, "function", "familyTotal 调用口随 inject 下发");
  assert.equal(dock.meta.inject({ id: "sess-2" }).familySessionId, "sess-2", "对象形态取 .id");
  assert.equal(dock.meta.inject(undefined).familySessionId, "", "未知形态回空串（组件不渲染）");
});

test("精确数挂 hover：KPI 与模型行须带 fmtFull 精确 title（紧凑舍入视觉差可核）", () => {
  assert.match(CLIENT, /kpi\("总 tokens（含缓存）", fmt\(t\.total\), .*fmtFull\(t\.total\)\)/, "总数 KPI 必须挂精确 title");
  assert.match(CLIENT, /\{ v: fmt\(m\.input\), t: fmtFull\(m\.input\) \}/, "模型行输入格必须挂精确 title");
  assert.match(CLIENT, /\{ v: fmt\(m\.cacheRead\), t: fmtFull\(m\.cacheRead\) \}/, "模型行缓存读格必须挂精确 title");
  assert.match(CLIENT, /title: fmtFull\(m\.total\) \+ " tok"/, "合计面板模型行必须挂精确 title");
});

test("命中率与宿主同算法：整数档 + 近满保真（防退回 naive 四舍五入）", () => {
  assert.match(CLIENT, /function roundedHitUnits\(read, denom\)/, "命中率必须走宿主整数档算法");
  assert.match(CLIENT, /fmtHit\(t\.cacheRead, t\.input \+ t\.cacheRead \+ t\.cacheWrite\)/, "分母须含缓存写（宿主 billedInput 口径）");
});

test("合计面板定位与宿主同值：side top + gap 8 + 首帧隐藏测量", () => {
  assert.match(CLIENT, /side: "top",\s*\n?\s*gap: 8,/, "合计面板必须朝上开（gap 8），朝下会盖住底部输入区");
  assert.match(CLIENT, /side: props\.side \|\| "bottom"/, "Anchored 须透传 side（月历保持默认朝下）");
  assert.match(CLIENT, /visibility: "hidden", left: 0, top: 0/, "首帧隐藏占位供测量（宿主 MEASURE_STYLE 同形，不闪错位）");
});

test("合计 pill 自动刷新：有标准席位走活路订阅后代计数，无席位退旧路（两路无数据都为 null 不炸）", () => {
  const rt = mountPage();
  const regs = (rt as any).regs as any[];
  const dock = regs.find((r) => r.meta && r.meta.name === "conversation.composer.dock");
  const h = (rt as any).react.createElement;
  // 活路：订阅函数在渲染期被调用，返回的后代计数只认血缘（孙代在内、无关/环形在外）
  const sessionsState = { byId: { main: { id: "main" }, child: { id: "child", parentId: "main" }, gc: { id: "gc", parentId: "child" } } };
  let selFn: any = null;
  let projKey: any = null;
  const liveProps = {
    familySessionId: "main",
    familyTotal: async () => ({ ok: true, value: null }),
    useSessions: (sel: any) => {
      selFn = sel;
      return sel(sessionsState);
    },
    useProjection: (key: any) => {
      projKey = key;
      return undefined;
    },
  };
  assert.strictEqual(rt.mount(h(dock.comp, liveProps)), null, "无数据时 pill 应为 null（不占位）");
  assert.equal(typeof selFn, "function", "活路必须订阅 useSessions（后代计数触发器）");
  assert.equal(selFn(sessionsState), 2, "子代理后代计数不对（子 + 孙应为 2）");
  assert.equal(selFn({ byId: {} }), 0, "空会话表应计 0");
  assert.equal(selFn({ byId: { other: { id: "other" } } }), 0, "无关会话不得计入");
  assert.equal(selFn({ byId: { a: { parentId: "b" }, b: { parentId: "a" } } }), 0, "环形血缘必须截断（不死循环、不误计数）");
  assert.equal(projKey, "tokenUsage", "活路必须订阅本会话 tokenUsage 投影（主会话落步即跟）");
  // 旧路：无标准席位（旧宿主/直挂）不断言订阅，只不断不炸
  assert.strictEqual(rt.mount(h(dock.comp, { familySessionId: "main", familyTotal: async () => ({ ok: true, value: null }) })), null, "旧路无数据也应为 null");
});

test("合计 pill 自动刷新接线门：三路触发 + 在途守卫 + 等值去抖 + 开面板重拉（防退回一次性旧逻辑）", () => {
  assert.match(CLIENT, /function FamilyPillLive\(props\)/, "自动刷新活路丢失（退回一次性旧逻辑：子代理开出来要手动刷新页）");
  assert.match(CLIENT, /function FamilyPillOnce\(props\)/, "一次性旧路丢失（旧宿主/直挂无退路）");
  assert.match(CLIENT, /function FamPillView\(props\)/, "视图未抽出共用（两路数据各渲一套必分叉）");
  assert.match(CLIENT, /props\.useSessions\(function \(s\)/, "未订阅宿主会话表——子代理开出来 pill 不会自动出现");
  assert.match(CLIENT, /props\.useProjection\("tokenUsage"\)/, "未订阅本会话 token 投影——主会话落步后数字不跟");
  assert.match(CLIENT, /setInterval\(function \(\)/, "缺轮询兜底——子代理侧涨的 token 本会话收不到推送，只能轮询");
  assert.match(CLIENT, /document\.hidden/, "轮询不避后台页签——hidden 时应跳过，不打扰后台");
  assert.match(CLIENT, /busy\.current/, "缺在途守卫——轮询/抖动会叠请求");
  assert.match(CLIENT, /famSig\(r\.value\)/, "缺值签名去抖——等值轮询结果会空转重渲染");
  assert.match(CLIENT, /onRefresh: load/, "开面板重拉丢失——点开面板应刷新");
});
