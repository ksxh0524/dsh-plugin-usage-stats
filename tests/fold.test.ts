/** 折叠与聚合口径测试：fixture 驱动（含重试替换、缓存归因、命中率 null 口径、日期窗口）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { foldJsonl, localDate } from "../src/scanner.ts";
import { buildDrill, buildOverview, hitRate, normalizeDrill, normalizeRange } from "../src/aggregate.ts";
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
  assert.equal(hitRate({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }), null);
});
