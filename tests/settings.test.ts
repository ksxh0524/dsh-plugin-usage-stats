/** 设置层测试：schema 约束 + installSection 接线后生效价目跟随用户层（模拟 dsh-settings 语义）。 */
import assert from "node:assert/strict";
import test from "node:test";

import { applyCordis } from "../src/cordis.ts";
import { assertPricesShape, USAGE_STATS_SETTINGS_NS, UsageStatsSettingsSchema } from "../src/settings.ts";

/** 运行时 schema 拒绝非法值是本用例的意图，输入对象对类型系统宽断言（any 桩）。 */
const asInput = (v: unknown) => v as Parameters<typeof UsageStatsSettingsSchema>[0];

test("schema：cast 填默认、拒负数、动态键", () => {
  assert.deepEqual(UsageStatsSettingsSchema({}), { prices: {} });
  const r = UsageStatsSettingsSchema(asInput({ prices: { "opencode-go/glm": { input: 2 } } }));
  assert.deepEqual(r.prices["opencode-go/glm"], { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.throws(() => UsageStatsSettingsSchema(asInput({ prices: { "a/b": { output: -1 } } })), /number >= 0/);
  assert.throws(() => UsageStatsSettingsSchema(asInput({ prices: { "a/b": { input: "x" } } })), /a\/b|price|number/);
});

test("assertPricesShape：空键拒绝，其余放行", () => {
  assert.throws(() => assertPricesShape({ "": { input: 1 } }), /不得为空/);
  assertPricesShape(undefined);
  assertPricesShape({ a: {}, "b/c": { input: 1, output: 2 } });
});

/** 模拟 dsh-settings 的 installSection 语义：resolved = schema(merge(base, user))，setSource 给 getter。
 *  这是对宿主接口的桩（宿主真实签名不在本包类型域内），入参/闭包统一宽类型 any。 */
function harness(): { settings: any; captured: Record<string, any> } {
  const captured: Record<string, any> = {};
  const watchers = new Set<() => void>();
  let resolved: any;
  const merge = (a: any, b: any) => ({ ...a, ...b });
  const settings = {
    installSection(_owner: unknown, ns: string, schema: any, entry: any, hooks: any) {
      captured.ns = ns;
      captured.entry = entry;
      resolved = schema(merge(entry, {}));
      hooks.setSource(() => resolved);
      captured.fail = (value: unknown) => {
        schema(value);
        hooks.validate(value);
      };
      captured.commit = (user: any) => {
        const next = schema(merge(entry, user));
        hooks.validate(next);
        resolved = next;
        for (const cb of watchers) cb();
      };
      return {
        get: () => resolved,
        watch: (cb: () => void) => {
          watchers.add(cb);
          return () => watchers.delete(cb);
        },
      };
    },
  };
  return { settings, captured };
}

test("applyCordis：settings 在场则注册命名空间，生效价目 = 用户层覆盖 base", () => {
  const { settings, captured } = harness();
  const ctx: any = {
    reflect: { provide: (_n: string, _svc: unknown) => () => {} },
    inject: (deps: string[], cb: (d: { settings: unknown }) => void) => {
      if (deps.includes("settings")) cb({ settings });
    },
    logger: { info: () => {} },
  };
  const svc = applyCordis(ctx, { sessionsHome: "", prices: { "a/b": { input: 5 } } });
  assert.equal(captured.ns, USAGE_STATS_SETTINGS_NS);
  assert.deepEqual(svc.effectivePrices(), { "a/b": { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 } }, "未编辑时生效 base（含 schema 默认填充）");
  captured.commit({ prices: { "a/b": { input: 5 }, "new/model": { output: 9 } } });
  const eff = svc.effectivePrices();
  assert.equal(eff["new/model"].output, 9, "settings 用户层新增立即生效（无需重启）");
  assert.equal(eff["a/b"].input, 5);
  assert.throws(() => captured.commit({ prices: { "x/y": { input: -3 } } }), /number >= 0/, "非法写入被 schema 拒绝");
  assert.throws(() => captured.commit({ prices: { " ": { input: 1 } } }), /不得为空/, "空键被 validate 钩子拒绝");
});

test("applyCordis：无 settings provider 回退 patch config", () => {
  const ctx: any = {
    reflect: { provide: () => () => {} },
    inject: () => {}, // provider 永不到场
    logger: { info: () => {} },
  };
  const svc = applyCordis(ctx, { prices: { "z/z": { cacheRead: 1 } } });
  assert.deepEqual(svc.effectivePrices(), { "z/z": { cacheRead: 1 } });
  svc.priceSource = () => {
    throw new Error("boom");
  };
  assert.deepEqual(svc.effectivePrices(), { "z/z": { cacheRead: 1 } }, "source 异常回退 patch，不炸查询");
});
