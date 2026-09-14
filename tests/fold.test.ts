/** 折叠与聚合口径测试：fixture 驱动（含重试替换、缓存归因、命中率 null 口径、日期窗口）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { foldJsonl, localDate } from "../src/scanner.ts";
import { buildOverview, hitRate, normalizeRange } from "../src/aggregate.ts";
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

test("normalizeRange：非法值丢弃、倒挂交换、model/provider 只收非空字符串", () => {
  assert.deepEqual(normalizeRange({ from: "2026-09-01", to: "bad" }), { from: "2026-09-01" });
  assert.deepEqual(normalizeRange({ from: "2026-09-10", to: "2026-09-01" }), { from: "2026-09-01", to: "2026-09-10" });
  assert.deepEqual(normalizeRange({ model: "a/b", provider: " ", n: 3 }), { model: "a/b" });
});

test("buildOverview：model/provider 过滤在 fact 层生效；维度过滤下 messages=null（无归属口径）", () => {
  const full = buildOverview([FOLD_S1, FOLD_COUNTS], {}, {});
  assert.equal(full.totals.requests, 3);
  assert.deepEqual(full.messages, { user: 2, assistant: 5, toolCalls: 2 }, "无维度过滤时消息计数按会话求和（s-1 三条 assistant + s-9 两条）");
  const byModel = buildOverview([FOLD_S1, FOLD_COUNTS], { model: "buzz/qwen-x" }, {});
  assert.equal(byModel.totals.requests, 3, "全键匹配 s-1 两条 + s-9 一条");
  assert.equal(byModel.byModel.length, 1);
  assert.equal(byModel.messages, null, "维度过滤后消息计数无口径 → null");
  assert.equal(byModel.sessionCount, 2);
  const bare = buildOverview([FOLD_S1, FOLD_S2], { model: "qwen-x" }, {});
  assert.equal(bare.totals.requests, 2, "裸 model 兜底匹配");
  const prov = buildOverview([FOLD_S1, FOLD_S2], { provider: "unknown" }, {});
  assert.equal(prov.totals.requests, 1, "provider 段精确匹配 s-2x");
  assert.equal(prov.byModel[0].key, "unknown/unknown");
});

test("pricing：provider/model 精确优先，裸 model 兜底，缺价 null", () => {
  const prices = { "buzz/m": { input: 1 }, m: { input: 9, output: 9 } };
  assert.equal(priceFor(prices, "buzz", "m")!.input, 1);
  assert.equal(priceFor(prices, "other", "m")!.input, 9);
  assert.equal(priceFor(prices, "x", "nope"), null);
  assert.equal(costOf({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, { input: 3, output: 0, cacheRead: 0, cacheWrite: 0 }), 3);
  assert.equal(hitRate({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, reportsCache: false }), null);
});

/* ---------------- 会话级计数（overview.messages 数据源） ---------------- */

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
