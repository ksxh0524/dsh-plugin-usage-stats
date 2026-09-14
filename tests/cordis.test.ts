/** 服务入口契约测试（不起真宿主）：
 *  ① 原型 SRC 标记形态 = typert-protocol mark() 产物（version:1 + direct invocation），
 *     且 remoteMethods() 跨实现可读物化出 overview/drillSessions；
 *  ② applyCordis 经 ctx.reflect.provide 注册 usageStats 服务，typertRemote 绑定形态过 validateBinding；
 *  ③ overview/drillSessions 在真实会话目录上出非零数据（多帧解码 + 价目折算全链路）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// W1 官方插件形（default = {name, inject, apply} 对象）：函数本体走命名导入。
import { applyCordis, UsageStatsService } from "../src/cordis.ts";

const MARKER_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";
const ROOT = join(homedir(), ".dsh", "sessions");

test("SRC 标记与 typertRemote 绑定形态符合 gateway 读取契约", () => {
  const marker = Object.getOwnPropertyDescriptor(UsageStatsService.prototype, MARKER_KEY);
  assert.ok(marker, "原型必须挂字符串键 remote-methods 标记（跨副本可读）");
  assert.equal(marker.value.version, 1);
  assert.deepEqual(marker.value.methods.map((m) => m.method), ["overview", "drillSessions", "sessionUsage"]);
  assert.deepEqual(marker.value.methods.map((m) => m.invocation.kind), ["direct", "direct", "direct"]);
  // SRC 参数形态：单一无默认值标识符（gateway 按源码文本解析）
  for (const m of ["overview", "drillSessions", "sessionUsage"]) {
    const src = String(UsageStatsService.prototype[m]);
    assert.match(src, new RegExp(`^async ${m}\\((\\w+)\\)`), `${m} 参数必须是单一标识符`);
  }
});

test("applyCordis：provide 注册 + 绑定可被 validateBinding 语义接受", () => {
  const provided = {};
  const logs = [];
  const ctx = {
    reflect: { provide: (name, value) => { provided[name] = value; return () => delete provided[name]; } },
    inject: () => {},
    logger: { info: (msg) => logs.push(msg) },
  };
  const svc = applyCordis(ctx, { prices: { "a/b": { input: 1 } } });
  assert.equal(provided.usageStats, svc);
  const b = svc.typertRemote;
  assert.equal(b.service, svc, "binding.service 必须 === receiver 本体（validateBinding 比对）");
  assert.equal(b.serviceKey, "usageStats");
  assert.equal(b.namespace, "usageStats");
});

test("真实链路：overview 出数 + 价目折算 + drillSessions 分页", { skip: existsSync(ROOT) ? false : "无会话目录" }, async () => {
  const provided = {};
  const ctx = { reflect: { provide: (n, v) => { provided[n] = v; } }, logger: undefined };
  const svc = applyCordis(ctx, { prices: { "opencode-go/glm-5.3-flash": { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 } } });
  const o = await svc.overview({});
  assert.ok(o.totals.requests > 0);
  assert.ok(o.cost === null || o.cost > 0, "有价目模型时 cost 应折算");
  assert.equal(typeof o.hitRate, "number", "真实数据缓存字段有上报");
  const d1 = await svc.drillSessions({ limit: 5, offset: 0 });
  assert.ok(d1.rows.length <= 5 && d1.total >= d1.rows.length);
  const d2 = await svc.drillSessions({ limit: 5, offset: 5 });
  if (d1.total > 5) assert.notEqual(d1.rows[0].sessionId, d2.rows[0]?.sessionId ?? d1.rows[0].sessionId, "分页不得重复");
  // v2：当前会话用量——取真实 drill 行头的 sessionId 应命中；坏 id 返回 null
  const head = d1.rows[0];
  const su = await svc.sessionUsage({ sessionId: head.sessionId });
  assert.ok(su && su.sessionId === head.sessionId, "sessionUsage 应命中真实会话");
  assert.ok(su.totals.requests > 0 && su.byModel.length > 0);
  assert.ok(su.messages.user + su.messages.assistant + su.messages.toolCalls >= 0, "三计数存在（真实会话至少非负）");
  assert.equal(await svc.sessionUsage({ sessionId: "no-such-session-xyz" }), null, "缺会话必须返回 null");
  // 缓存生效：第二次 overview 不重新解码（reloaded 为 0 由 scanFolds 内部保证，此处验证不抛且更快）
  const t0 = Date.now();
  await svc.overview({});
  assert.ok(Date.now() - t0 < 500, "热缓存 overview 应亚秒返回");
});
