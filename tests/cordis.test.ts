/** 服务入口契约测试（不起真宿主）：
 *  ① 原型 SRC 标记形态 = typert-protocol mark() 产物（version:1 + direct invocation，overview + familyTotal 双方法）；
 *  ② applyCordis 经 ctx.reflect.provide 注册 usageStats 服务，typertRemote 绑定形态过 validateBinding；
 *  ③ overview（含 model/provider 过滤）在真实会话目录上出非零数据（增量解码 + 价目折算全链路）。
 *  ④ familyTotal 在真实会话目录上对任一已知会话出数（未知 id 回 known:false）。 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// W1 官方插件形（default = {name, inject, apply} 对象）：函数本体走命名导入。
import { applyCordis, UsageStatsService } from "../src/cordis.ts";

const MARKER_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";
const ROOT = join(homedir(), ".dsh", "sessions");

/** 原型标记的运行时形态（跨副本可读，测试侧本地声明，避免 import 宿主协议包）。 */
interface RemoteMethodsMarker {
  version: number;
  methods: Array<{ method: string; invocation: { kind: string } }>;
}
/** 桩宿主 ctx：真实形态由宿主决定，测试只关心被断言的子集，故宽类型为 any。 */
type StubCtx = any;

test("SRC 标记与 typertRemote 绑定形态符合 gateway 读取契约", () => {
  const marker = Object.getOwnPropertyDescriptor(UsageStatsService.prototype, MARKER_KEY) as { value: RemoteMethodsMarker } | undefined;
  assert.ok(marker, "原型必须挂字符串键 remote-methods 标记（跨副本可读）");
  assert.equal(marker.value.version, 1);
  assert.deepEqual(
    marker.value.methods.map((m) => m.method),
    ["overview", "familyTotal"],
    "Remote 收口为 overview + familyTotal（会话视图宿主自带，不预留死接口）",
  );
  assert.deepEqual(
    marker.value.methods.map((m) => m.invocation.kind),
    ["direct", "direct"],
  );
  // SRC 参数形态：复刻网关 methodParameterNames 的解析（Node type-strip 会把 `: unknown` 注解替换为等长空白，
  // 网关按「逗号切分 + trim + 纯标识符且唯一」校验；默认值/解构/rest 会被拒绝）。
  const srcParamNames = (fn: Function): string[] => {
    const source = Function.prototype.toString.call(fn);
    const open = source.indexOf("(");
    const close = source.indexOf(")", open + 1);
    const body = source.slice(open + 1, close).trim();
    return body.length === 0 ? [] : body.split(",").map((p) => p.trim());
  };
  const proto = UsageStatsService.prototype as any;
  const names = srcParamNames(proto.overview);
  assert.equal(names.length, 1, "overview 必须是单一业务参数");
  assert.match(names[0], /^[$A-Z_a-z][$\w]*$/u, "参数必须是纯标识符（无默认值/解构/rest/注解残留逗号）");
  assert.deepEqual(names, ["filter"], "wire 参数名 = 客户端 descriptor 的 name（隐式契约）");
  const familyNames = srcParamNames(proto.familyTotal);
  assert.deepEqual(familyNames, ["filter"], "familyTotal 同样是单一 filter 参数（内含 sessionId）");
});

test("applyCordis：provide 注册 + 绑定可被 validateBinding 语义接受", () => {
  const provided: Record<string, unknown> = {};
  const logs: string[] = [];
  const ctx: StubCtx = {
    reflect: {
      provide: (name: string, value: unknown) => {
        provided[name] = value;
        return () => delete provided[name];
      },
    },
    inject: () => {},
    logger: { info: (msg: string) => logs.push(msg) },
  };
  const svc = applyCordis(ctx, {});
  assert.equal(provided.usageStats, svc);
  const b = svc.typertRemote;
  assert.equal(b.service, svc, "binding.service 必须 === receiver 本体（validateBinding 比对）");
  assert.equal(b.serviceKey, "usageStats");
  assert.equal(b.namespace, "usageStats");
});

test("真实链路：overview 出数 + 维度过滤 + 热缓存", { skip: existsSync(ROOT) ? false : "无会话目录" }, async () => {
  const ctx: StubCtx = { reflect: { provide: () => () => {} }, logger: undefined };
  const svc = applyCordis(ctx, {});
  const o = await svc.overview({});
  assert.ok(o.totals.requests > 0);
  assert.equal(typeof o.hitRate, "number", "真实数据缓存字段有上报");
  assert.ok(o.byModel.length > 0);
  assert.equal("cost" in o, false, "v4 起 Overview 不再携带费用/按天/消息口径");
  // 维度过滤：不存在的模型 → 空视图；存在的首行模型 → 非空且只含该键
  const empty = await svc.overview({ model: "no/such-model-xyz" });
  assert.equal(empty.totals.requests, 0);
  assert.equal(empty.byModel.length, 0);
  const first = o.byModel[0]!;
  const one = await svc.overview({ model: first.key });
  assert.equal(one.byModel.length, 1);
  assert.equal(one.byModel[0]!.key, first.key, "全键过滤应命中该模型行");
  assert.ok(one.totals.requests >= first.requests, "真实链路活数据：两次读之间新请求落盘只增不减（provider 断言同口径）");
  const prov = await svc.overview({ provider: first.provider });
  assert.ok(prov.totals.requests >= first.requests, "provider 过滤是其模型并集");
  // 热缓存：第二次 overview 不重新解码
  const t0 = Date.now();
  await svc.overview({});
  assert.ok(Date.now() - t0 < 500, "热缓存 overview 应亚秒返回");
});

test("真实链路：familyTotal 未知 id 回 known:false（口径不断言活数据血缘）", { skip: existsSync(ROOT) ? false : "无会话目录" }, async () => {
  const ctx: StubCtx = { reflect: { provide: () => () => {} }, logger: undefined };
  const svc = applyCordis(ctx, {});
  const r = await svc.familyTotal({ sessionId: "no/such-session-xyz" });
  assert.equal(r.known, false);
  assert.equal(r.sessionCount, 0);
  assert.equal(r.byModel.length, 0);
});
