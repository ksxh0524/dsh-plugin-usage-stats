/** overview 精确口径锁死（纯 fixture）：分项精确值之和恒等于总数精确值。
 *  页面紧凑显示（B 档 2 位小数 = 10M 粒度）各自舍入后视觉和≠总数是正常的，
 *  精确数挂 hover（fmtFull）供逐项核对——本单测保证 hover 背后的精确账永远自洽。 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildOverview, type Range } from "../src/aggregate.ts";
import type { Fold } from "../src/scanner.ts";

const RANGE: Range = {};

function fold(sessionId: string, facts: Fold["facts"]): Fold {
  return {
    facts,
    meta: {
      sessionId,
      cwd: "/w",
      title: "",
      createdAt: 1,
      delegationDepth: 0,
      subagent: false,
      parentId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
    },
  };
}

test("分项精确值之和恒等于总数（单模型/多模型/墓碑一致）", () => {
  const folds = [
    fold("a", [
      {
        scope: "a:1:1",
        sessionId: "a",
        provider: "p",
        model: "m",
        date: "2026-09-19",
        time: 1,
        input: 12640000,
        output: 1710000,
        cacheRead: 335000000,
        cacheWrite: 0,
        hasCache: true,
      },
      {
        scope: "a:1:2",
        sessionId: "a",
        provider: "p",
        model: "m2",
        date: "2026-09-19",
        time: 2,
        input: 7,
        output: 5,
        cacheRead: 0,
        cacheWrite: 3,
        hasCache: true,
      },
    ]),
  ];
  const tombs = [
    fold("dead", [
      {
        scope: "dead:1:1",
        sessionId: "dead",
        provider: "p",
        model: "m",
        date: "2026-09-19",
        time: 3,
        input: 100,
        output: 200,
        cacheRead: 300,
        cacheWrite: 400,
        hasCache: false,
      },
    ]),
  ];
  const o = buildOverview(folds, RANGE, tombs);
  const t = o.totals;
  assert.equal(t.input + t.output + t.cacheRead + t.cacheWrite, t.total, "总数必须精确等于四项之和");
  for (const m of o.byModel) {
    assert.equal(m.input + m.output + m.cacheRead + m.cacheWrite, m.total, `模型行 ${m.key} 必须精确自洽`);
  }
  assert.equal(
    o.byModel.reduce((s, m) => s + m.total, 0),
    t.total,
    "模型行合计必须精确等于总数",
  );
});
