/** 全部合计聚合单测（纯 fixture，不碰真实会话目录）：
 *  ① session 行的 parentSession 落进 meta.parentId，主会话为 null；
 *  ② buildFamilyTotal 只收父 + 递归后代（孙代在内、无关会话在外），未知 id 回 known:false；
 *  ③ 被查是子代理 → isSubagent:true；墓碑子会话计入；活文件与墓碑同 session 去重；
 *  ④ 环形血缘不死循环；多模型按 provider/model 拆行。 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildFamilyTotal } from "../src/aggregate.ts";
import { foldJsonl, type Fold, type UsageFact } from "../src/scanner.ts";

const line = (o: unknown): string => JSON.stringify(o) + "\n";

function sessionFile(
  sessionId: string,
  extra: Record<string, unknown>,
  usages: Array<{ turn: number; step: number; provider: string; model: string; input: number; output: number }>,
): string {
  let s = line({ type: "session", id: sessionId, cwd: "/w", createdAt: 1_700_000_000_000, ...extra });
  for (const u of usages) {
    s += line({ type: "request/header", data: { header: { config: { provider: u.provider, model: u.model } } } });
    s += line({ type: "turn/start", data: { turn: u.turn } });
    s += line({ type: "step/start", data: { turn: u.turn, step: u.step } });
    s += line({
      type: "assistant/message",
      time: 1_700_000_000_000 + u.turn * 1000,
      data: { usage: { inputTokens: u.input, outputTokens: u.output } },
    });
  }
  return s;
}

function fact(sessionId: string, provider: string, model: string, input: number, output: number): UsageFact {
  return { scope: `${sessionId}:1:1`, sessionId, provider, model, date: "2026-09-19", time: 1, input, output, cacheRead: 0, cacheWrite: 0, hasCache: false };
}

function fold(sessionId: string, parentId: string | null, subagent: boolean, facts: UsageFact[]): Fold {
  return {
    facts,
    meta: {
      sessionId,
      cwd: "/w",
      title: "",
      createdAt: 1,
      delegationDepth: parentId ? 1 : 0,
      subagent,
      parentId,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
    },
  };
}

test("session 行 parentSession 落 meta.parentId，主会话为 null", () => {
  const child = foldJsonl("child", sessionFile("child", { parentSession: "parent", origin: "subagent", delegationDepth: 1 }, []));
  assert.equal(child.meta?.parentId, "parent");
  assert.equal(child.meta?.subagent, true);
  const main = foldJsonl("main", sessionFile("main", {}, []));
  assert.equal(main.meta?.parentId, null);
  assert.equal(main.meta?.subagent, false);
});

test("全部 = 父 + 递归后代，无关与未知排除", () => {
  const folds = [
    fold("parent", null, false, [fact("parent", "deepseek", "chat", 100, 50)]),
    fold("child-a", "parent", true, [fact("child-a", "deepseek", "chat", 200, 60)]),
    fold("grand", "child-a", true, [fact("grand", "openai", "gpt", 300, 70)]),
    fold("other", null, false, [fact("other", "deepseek", "chat", 9999, 9999)]),
  ];
  const r = buildFamilyTotal(folds, "parent");
  assert.equal(r.known, true);
  assert.equal(r.isSubagent, false);
  assert.equal(r.sessionCount, 3);
  assert.equal(r.totals.input, 600);
  assert.equal(r.totals.output, 180);
  assert.equal(r.byModel.length, 2, "deepseek/chat 与 openai/gpt 按模型拆行");
  assert.equal(r.byModel[0]!.key, "deepseek/chat");
  const unknown = buildFamilyTotal(folds, "nope");
  assert.equal(unknown.known, false);
  assert.equal(unknown.sessionCount, 0);
  assert.equal(unknown.totals.total, 0);
});

test("被查是子代理 → isSubagent:true（调用方不渲染）", () => {
  const folds = [
    fold("parent", null, false, [fact("parent", "deepseek", "chat", 10, 5)]),
    fold("child-a", "parent", true, [fact("child-a", "deepseek", "chat", 20, 5)]),
  ];
  const r = buildFamilyTotal(folds, "child-a");
  assert.equal(r.known, true);
  assert.equal(r.isSubagent, true);
  assert.equal(r.sessionCount, 1, "查子代理只含自己，不含父兄");
});

test("墓碑子会话计入；活墓碑同 session 去重；环形血缘不死循环", () => {
  const live = [fold("parent", null, false, [fact("parent", "deepseek", "chat", 100, 10)])];
  const tombs = [
    fold("dead-child", "parent", true, [fact("dead-child", "deepseek", "chat", 40, 4)]),
    // 同 session 活墓碑并存：只算活的一份
    fold("parent", null, false, [fact("parent", "deepseek", "chat", 100, 10)]),
  ];
  const r = buildFamilyTotal(live, "parent", tombs);
  assert.equal(r.sessionCount, 2);
  assert.equal(r.totals.input, 140);
  const loop = [fold("a", "b", true, [fact("a", "deepseek", "chat", 1, 1)]), fold("b", "a", true, [fact("b", "deepseek", "chat", 2, 2)])];
  const lr = buildFamilyTotal(loop, "a");
  assert.equal(lr.sessionCount, 2);
  assert.equal(lr.totals.input, 3);
});
