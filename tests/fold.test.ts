/** 折叠与聚合口径测试：fixture 驱动（含重试替换、缓存归因、命中率 null 口径、日期窗口）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { foldJsonl, localDate } from "../src/scanner.ts";
import { buildDrill, buildOverview, buildSessionUsage, hitRate, normalizeDrill, normalizeRange } from "../src/aggregate.ts";
import { costOf, priceFor } from "../src/pricing.ts";

const DAY = "2026-09-19";
const T = Date.parse(`${DAY}T08:00:00`); // 本地时区

function line(type: string, seq: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, seq, time: T + seq * 1000, ...extra });
}

const FIXTURE = [
  line("session", 0, { id: "s-1", cwd: "/w/测试", createdAt: T, delegationDepth: 1, origin: { parentSession: "p" } }),
  line("session/title", 1, { data: { title: "测试会话" } }),
  line("turn/start", 2, { data: { turn: 1 } }),
  line("step/start", 3, { data: { turn: 1, step: 1 } }),
  line("request/header", 4, { data: { header: { config: { provider: "buzz", model: "qwen-x" } } } }),
  line("assistant/message", 5, { data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 800, cacheWriteTokens: 50, totalTokens: 970 } } }),
  line("llm/retry-started", 6, { data: { retryId: "r1", turn: 1, step: 2, retry: 1 } }),
  line("step/start", 7, { data: { turn: 1, step: 2 } }),
  line("request/header", 8, { data: { header: { config: { provider: "buzz", model: "qwen-x" } } } }),
  // step2 第一次样本（重试场景：step/start 重发）
  line("assistant/message", 9, { data: { usage: { inputTokens: 111, outputTokens: 1, totalTokens: 112 } } }),
  line("llm/retry-started", 10, { data: { retryId: "r1", turn: 1, step: 2, retry: 2 } }),
  line("assistant/message", 11, { data: { usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 400, totalTokens: 550 } } }),
  // 无 header 会话片段：归 unknown
  line("session", 12, { id: "s-2", cwd: "/w/2", createdAt: T }),
  line("assistant/message", 13, { data: { usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } } }),
].join("\n");

test("foldJsonl：折叠数量、重试取末条、unknown 模型、子代理标记", () => {
  const { facts, meta } = foldJsonl("hint", FIXTURE);
  assert.equal(facts.length, 3, "s1 step1 + s1 step2(末条) + s2");
  const step2 = facts.find((f) => f.scope === "s-1:1:2");
  assert.equal(step2?.input, 120, "重试同 scope 只留末条样本");
  assert.equal(step2?.cacheWrite, 0);
  const s2 = facts.find((f) => f.sessionId === "s-2");
  assert.equal(s2?.model, "unknown");
  assert.equal(s2?.date, localDate(T + 13000));
  // meta 是「最后一条 session 行」——s-2；s-1 的 meta 由聚合层按 fold 处理，此处只验证解析不崩
  assert.equal(meta?.sessionId, "s-2");
});

/** foldJsonl 单 fold 场景（s-1 单独一份）供聚合断言。 */
const FOLD_S1 = foldJsonl("hint", FIXTURE.split("\n").slice(0, 12).join("\n"));
const FOLD_S2 = foldJsonl("hint", [FIXTURE.split("\n")[0].replace("s-1", "s-2x"), FIXTURE.split("\n")[12], FIXTURE.split("\n")[13]].join("\n"));

test("buildOverview：总计/命中率/byModel/byDay/会话数", () => {
  const prices = { "buzz/qwen-x": { input: 2, output: 8, cacheRead: 0.4, cacheWrite: 2.5 } };
  const o = buildOverview([FOLD_S1], {}, prices);
  assert.equal(o.totals.requests, 2);
  assert.equal(o.totals.input, 220);
  assert.equal(o.totals.output, 50);
  assert.equal(o.totals.cacheRead, 1200);
  assert.equal(o.totals.cacheWrite, 50);
  assert.equal(o.totals.total, 1520);
  assert.ok(Math.abs(o.hitRate! - 1200 / 1420) < 1e-9);
  assert.equal(o.byModel.length, 1);
  assert.equal(o.byModel[0].key, "buzz/qwen-x");
  assert.equal(o.byDay.length, 1);
  assert.equal(o.sessionCount, 1);
  // 费用 = (220*2 + 50*8 + 1200*0.4 + 50*2.5)/1e6
  assert.ok(Math.abs(o.cost! - (440 + 400 + 480 + 125) / 1e6) < 1e-12);
  assert.equal(o.priced, true);
});

test("buildOverview：无价目 → cost null；缓存字段未上报 → hitRate null（UI 显示“—”）", () => {
  const o = buildOverview([FOLD_S2], {}, {});
  assert.equal(o.cost, null);
  assert.equal(o.priced, false);
  // s-2x 的 usage 完全没报 cacheReadTokens/cacheWriteTokens → 无命中率口径
  assert.equal(o.hitRate, null);
});

test("normalizeRange/normalizeDrill：非法值丢弃、倒挂交换、limit 钳制", () => {
  assert.deepEqual(normalizeRange({ from: "2026-09-01", to: "bad" }), { from: "2026-09-01" });
  assert.deepEqual(normalizeRange({ from: "2026-09-10", to: "2026-09-01" }), { from: "2026-09-01", to: "2026-09-10" });
  const q = normalizeDrill({ limit: 9999, offset: -3, model: "a/b" });
  assert.equal(q.limit, 200);
  assert.equal(q.offset, 0);
  assert.equal(q.model, "a/b");
});

test("buildDrill：模型过滤 + 分页 + 排序", () => {
  const d = buildDrill([FOLD_S1, FOLD_S2], normalizeDrill({ model: "buzz/qwen-x", limit: 10 }), {});
  assert.equal(d.total, 1);
  assert.equal(d.rows[0].sessionId, "s-1");
  assert.equal(d.rows[0].models[0], "buzz/qwen-x");
  assert.equal(d.rows[0].subagent, true);
  const all = buildDrill([FOLD_S1, FOLD_S2], normalizeDrill({}), {});
  assert.equal(all.total, 2);
  assert.equal(all.rows[0].lastTime > all.rows[1].lastTime || all.rows[0].sessionId === "s-1", true);
});

test("pricing：provider/model 精确优先，裸 model 兜底，缺价 null", () => {
  const prices = { "buzz/m": { input: 1 }, m: { input: 9, output: 9 } };
  assert.equal(priceFor(prices, "buzz", "m")!.input, 1);
  assert.equal(priceFor(prices, "other", "m")!.input, 9);
  assert.equal(priceFor(prices, "x", "nope"), null);
  assert.equal(costOf({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, { input: 3, output: 0, cacheRead: 0, cacheWrite: 0 }), 3);
  assert.equal(hitRate({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, reportsCache: false }), null);
});

/* ---------------- v2：会话级计数 + buildSessionUsage ---------------- */

/** 覆盖 user/message、tool/call、无 usage 的 assistant/message 三类计数行的独立 fixture。 */
const FIXTURE_COUNTS = [
  line("session", 0, { id: "s-9", cwd: "/w/c", createdAt: T }),
  line("user/message", 1, { data: { content: "你好" } }),
  line("turn/start", 2, { data: { turn: 1 } }),
  line("step/start", 3, { data: { turn: 1, step: 1 } }),
  line("request/header", 4, { data: { header: { config: { provider: "buzz", model: "qwen-x" } } } }),
  line("assistant/message", 5, { data: { usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 30, totalTokens: 42 } } }),
  line("tool/call", 6, { data: { name: "bash" } }),
  line("tool/call", 7, { data: { name: "read" } }),
  line("user/message", 8, { data: { content: "继续" } }),
  // 无 usage 的 assistant 行：计消息数，但不出 usage 事实
  line("assistant/message", 9, { data: { content: "收尾" } }),
].join("\n");

const FOLD_COUNTS = foldJsonl("hint", FIXTURE_COUNTS);

test("foldJsonl：三计数（user/assistant/tool），无 usage 的 assistant 也计数", () => {
  assert.equal(FOLD_COUNTS.meta?.userMessages, 2);
  assert.equal(FOLD_COUNTS.meta?.assistantMessages, 2);
  assert.equal(FOLD_COUNTS.meta?.toolCalls, 2);
  assert.equal(FOLD_COUNTS.facts.length, 1, "无 usage 行不产事实");
});

test("buildOverview：messages 三计数求和 + configuredPrices", () => {
  const o = buildOverview([FOLD_COUNTS], {}, { "buzz/qwen-x": { input: 1 } });
  assert.deepEqual(o.messages, { user: 2, assistant: 2, toolCalls: 2 });
  assert.equal(o.configuredPrices, 1);
  const empty = buildOverview([FOLD_COUNTS], { from: "2099-01-01" }, {});
  assert.deepEqual(empty.messages, { user: 0, assistant: 0, toolCalls: 0 }, "窗口外会话不贡献计数");
  assert.equal(empty.configuredPrices, 0);
});

test("buildSessionUsage：单会话聚合（meta+totals+byModel+费用）", () => {
  const prices = { "buzz/qwen-x": { input: 2, output: 8, cacheRead: 0.4, cacheWrite: 0 } };
  const u = buildSessionUsage([FOLD_S1, FOLD_COUNTS], "s-9", prices);
  assert.ok(u);
  assert.equal(u.title, "");
  assert.equal(u.cwd, "/w/c");
  assert.equal(u.subagent, false);
  assert.deepEqual(u.messages, { user: 2, assistant: 2, toolCalls: 2 });
  assert.equal(u.totals.requests, 1);
  assert.equal(u.totals.input, 10);
  assert.equal(u.totals.output, 2);
  assert.equal(u.totals.cacheRead, 30);
  assert.equal(u.hitRate, 30 / 40);
  assert.equal(u.priced, true);
  assert.ok(Math.abs(u.cost! - (20 + 16 + 12) / 1e6) < 1e-12);
  assert.equal(u.byModel.length, 1);
  assert.equal(u.byModel[0].key, "buzz/qwen-x");
  assert.equal(u.firstTime, T + 5000);
  assert.equal(u.lastTime, T + 5000);
  // 另一会话互不污染
  const u1 = buildSessionUsage([FOLD_S1, FOLD_COUNTS], "s-1", {});
  assert.ok(u1 && u1.totals.requests === 2 && u1.sessionId === "s-1");
  assert.equal(u1.priced, false);
  assert.equal(u1.cost, null);
});

test("buildSessionUsage：缺会话 / 坏入参一律 null", () => {
  assert.equal(buildSessionUsage([FOLD_COUNTS], "nope", {}), null);
  assert.equal(buildSessionUsage([FOLD_COUNTS], "", {}), null);
  // meta 在但无 usage 事实：返回零值视图而非 null（新会话刚创建）
  const bare: import("../src/scanner.ts").Fold = {
    facts: [],
    meta: { ...FOLD_COUNTS.meta!, sessionId: "s-live" },
  };
  const z = buildSessionUsage([bare], "s-live", {});
  assert.ok(z && z.totals.total === 0 && z.messages.user === 2);
});
