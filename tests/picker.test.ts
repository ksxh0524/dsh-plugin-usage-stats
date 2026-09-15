/** lib/client.js 浏览器半 RangePicker 行为测试（静态 harness 模式，AGENTS「浏览器半改动=本地 fixture + 自起实例」）。
 *  为什么存在：v3 日格构建在 for 循环里用 `var d` + 闭包读共享末值——当月格全部被「月末日>today」的
 *  disabled 吞掉点击、历史月点谁都提交成月末；三道门全绿也照样上线（纯 Node 测不到浏览器半语义）。
 *  本文件用一个同步 mini React 真渲染组件树、真派发事件，断言逐格独立绑定 + 选中态类名 + 文案规格。
 *  宿主注入对象（ctx/document/$mount/slots）均为桩，按 AGENTS 完成标准 1 允许宽 any；被测的 client 代码是真身。 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

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
    document: { createElement: () => ({ setAttribute() {}, textContent: "" }), head: { appendChild() {} } },
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT, sandbox);
  const exports: any = mod.factory((id: string) => {
    assert.equal(id, "react");
    return rt.react;
  });
  let sectionComp: any = null;
  const ctx: any = {
    effect: (fn: any) => fn(),
    slots: {
      inject: (_slot: string, factory: any) => factory(),
      register: (_meta: any, comp: any) => {
        sectionComp = comp;
      },
    },
    remote: { $mount: () => Promise.resolve() },
    get: () => ({ overview: async () => ({ ok: true, value: null }) }),
  };
  exports.apply(ctx);
  assert.ok(sectionComp, "settings.section 组件未注册");
  rt.mount(sectionComp());
  return rt;
}

const p2 = (n: number) => (n < 10 ? "0" + n : String(n));
const NOW = new Date();
const TODAY = NOW.getFullYear() + "-" + p2(NOW.getMonth() + 1) + "-" + p2(NOW.getDate());
const PREV = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const PREV_YM = PREV.getFullYear() + "-" + p2(PREV.getMonth() + 1);
const CUR_YM = NOW.getFullYear() + "-" + p2(NOW.getMonth() + 1);

const TRIGGER_TITLE = "选择日期范围（本地时区，按天）";
const trigger = (rt: any) => collect(rt, (n) => n.type === "button" && n.props.title === TRIGGER_TITLE)[0];
const cells = (rt: any) => collect(rt, (n) => typeof n.props.className === "string" && n.props.className.indexOf("usg-pv") === 0);
const cellBy = (rt: any, key: string) => cells(rt).find((c) => c.props.key === key);
const selCells = (rt: any) => cells(rt).filter((c) => c.props.className.indexOf("usg-sel") > 0);
const clearBtn = (rt: any) => collect(rt, (n) => n.type === "button" && textOf(n) === "清除")[0];
const navBtn = (rt: any, label: string) => collect(rt, (n) => n.type === "button" && n.props["aria-label"] === label)[0];

test("RangePicker：初始挂载——今天为选中态（brand 药丸），预设行无「全部」，脚注只有「清除」", () => {
  const rt = mountPage();
  assert.equal(textOf(trigger(rt)), "今天");
  fire(trigger(rt), "onClick", rt);
  assert.equal(trigger(rt).props["aria-pressed"], "true", "浮层打开时触发器应有按下态描边");
  assert.ok(cells(rt).length >= 28, "月历未渲染");
  const t = cellBy(rt, TODAY);
  assert.ok(t, "今天格未渲染");
  assert.match(t.props.className, /usg-sel/);
  assert.equal(t.props["aria-selected"], "true");
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
  for (const mid of ["06", "07", "08", "09", "10", "11"]) {
    assert.match(cellBy(rt, PREV_YM + "-" + mid).props.className, /usg-prev/, mid + " 应在预览带内");
  }
  fire(cellBy(rt, d12), "onClick", rt);
  assert.equal(cells(rt).length, 0, "commit 后浮层应关闭");
  assert.equal(textOf(trigger(rt)), d5.slice(5) + " → " + d12.slice(5));
  // 重开：端点=sel 药丸、中间=区间底带、其余无选中类且 aria-selected 撤销
  fire(trigger(rt), "onClick", rt);
  assert.match(cellBy(rt, d5).props.className, /usg-sel/);
  assert.match(cellBy(rt, d12).props.className, /usg-sel/);
  assert.match(cellBy(rt, PREV_YM + "-08").props.className, /usg-mid/);
  assert.match(cellBy(rt, PREV_YM + "-01").props.className, /^usg-pv$/);
  assert.equal(cellBy(rt, d5).props["aria-selected"], "true");
  assert.equal(cellBy(rt, PREV_YM + "-08").props["aria-selected"], undefined);
});

test("RangePicker：「清除」回全部且不关浮层；未来日不可点；单日=同格点两次", () => {
  const rt = mountPage();
  fire(trigger(rt), "onClick", rt);
  fire(navBtn(rt, "上一月"), "onClick", rt);
  fire(clearBtn(rt), "onClick", rt);
  // 未选任何范围时「清除」应置灰（当前 win 是默认今天 → 第一下真的清了）
  assert.equal(textOf(trigger(rt)), "全部");
  assert.ok(cells(rt).length >= 28, "「清除」不应关闭浮层");
  fire(clearBtn(rt), "onClick", rt);
  assert.equal(clearBtn(rt).props["aria-disabled"], "true", "已处「全部」态时应禁用语义");
  // 回到当月：未来日全部 aria-disabled 且点击无效
  fire(navBtn(rt, "下一月"), "onClick", rt);
  const dimmed = cells(rt).filter((c) => c.props["aria-disabled"] === "true");
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
  assert.equal(textOf(trigger(rt)), "今天");
});

test("RangePicker：今天标记与样式规格（32px 大格、13px 等宽数字、选择器不再互相压 specificity）", () => {
  const rt = mountPage();
  fire(trigger(rt), "onClick", rt);
  fire(clearBtn(rt), "onClick", rt); // win=null → 今天格显示 today 标记
  assert.match(cellBy(rt, TODAY).props.className, /usg-today/);
  // 静态规格闸：字体/格径/类名迁移一旦回潮当场红
  assert.match(CLIENT, /\.usg-pv\{height:32px;line-height:32px;[^"]*font-size:13px;font-variant-numeric:tabular-nums/);
  assert.match(CLIENT, /\.usg-wd\{/);
  assert.doesNotMatch(CLIENT, /\.usg-cal>span/);
  assert.doesNotMatch(CLIENT, /usg-(e|in)\b/);
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
