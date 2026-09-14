/** 真实数据集成测试：全局扫描本机 DSH 会话目录（增量多帧解码），断言事实非空 + 存量持久化生效。
 *  无会话目录时跳过；本测试与 fold.test.ts 的 fixture 测试互补（golden 口径在 fixture，链路在真数据）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { sessionsRoot } from "../src/scanner.ts";
import { scanFolds, buildOverview } from "../src/aggregate.ts";
import { FoldStore } from "../src/store.ts";

const root = sessionsRoot();
test("真实会话：多帧解码出非零事实，二次扫描 0 重载且 cache 落盘", { skip: existsSync(root) ? false : "无 DSH 会话目录" }, async () => {
  const store = new FoldStore(root);
  const t0 = Date.now();
  const first = await scanFolds(root, store);
  assert.ok(first.files > 0, "至少应发现一个会话文件");
  const o = buildOverview(first.folds, {});
  assert.ok(o.totals.requests > 0, "真实数据应折叠出非零 usage 事实（多帧解码生效）");
  assert.ok(o.totals.input + o.totals.output > 0);
  assert.equal("cost" in o, false, "v4 契约：真实链路输出同样不含费用字段");
  assert.ok(Date.now() - t0 < 60_000, "首扫应远小于 60s 挂起阈值");
  // 落盘路径断言在 scan.test.ts（tmp 目录，可控）；此处不重复——真实 home 可能处于只读沙箱。
  const second = await scanFolds(root, store);
  assert.ok(second.reloaded <= 5, `未变文件应全复用（实况写入导致的推进 ${second.reloaded} 个，容忍 ≤5）`);
});
