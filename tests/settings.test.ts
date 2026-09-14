/** 设置层测试：schema 约束 + installSection 接线后生效价目跟随用户层（模拟 dsh-settings 语义）。 */
import assert from "node:assert/strict";
import test from "node:test";

import { applyCordis } from "../src/cordis.ts";
import { assertPricesShape, USAGE_STATS_SETTINGS_NS, UsageStatsSettingsSchema } from "../src/settings.ts";

test("schema：cast 填默认、拒负数、动态键", () => {
  assert.deepEqual(UsageStatsSettingsSchema({}), { prices: {} });
  const r = UsageStatsSettingsSchema({ prices: { "opencode-go/glm": { input: 2 } } });
  assert.deepEqual(r.prices["opencode-go/glm"], { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.throws(() => UsageStatsSettingsSchema({ prices: { "a/b": { output: -1 } } }), /number >= 0/);
  assert.throws(() => UsageStatsSettingsSchema({ prices: { "a/b": { input: "x" } } }), /a\/b|price|number/);
});

test("assertPricesShape：空键拒绝，其余放行", () => {
  assert.throws(() => assertPricesShape({ "": { input: 1 } }), /不得为空/);
  assertPricesShape(undefined);
  assertPricesShape({ "a": {}, "b/c": { input: 1, output: 2 } });
});

/** 模拟 dsh-settings 的 installSection 语义：resolved = schema(merge(base, user))，setSource 给 getter。 */
function harness(baseEntry) {
  const captured = {};
  const watchers = new Set();
  let resolved;
  const merge = (a, b) => ({ ...a, ...b });
  const settings = {
    installSection(owner, ns, schema, entry, hooks) {
      captured.ns = ns;
      captured.entry = entry;
      resolved = schema(merge(entry, {}));
      hooks.setSource(() => resolved);
      captured.fail = (value) => { schema(value); hooks.validate(value); };
      captured.commit = (user) => {
        const next = schema(merge(entry, user));
        hooks.validate(next);
        resolved = next;
        for (const cb of watchers) cb();
      };
      return { get: () => resolved, watch: (cb) => { watchers.add(cb); return () => watchers.delete(cb); } };
    },
  };
  return { settings, captured };
}

test("applyCordis：settings 在场则注册命名空间，生效价目 = 用户层覆盖 base", () => {
  const { settings, captured } = harness();
  const calls = [];
  const ctx = {
    reflect: { provide: (_n, svc) => { calls.push(svc); return () => {}; } },
    inject: (deps, cb) => { if (deps.includes("settings")) cb({ settings }); },
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
  const ctx = {
    reflect: { provide: () => () => {} },
    inject: () => {}, // provider 永不到场
    logger: { info: () => {} },
  };
  const svc = applyCordis(ctx, { prices: { "z/z": { cacheRead: 1 } } });
  assert.deepEqual(svc.effectivePrices(), { "z/z": { cacheRead: 1 } });
  svc.priceSource = () => { throw new Error("boom"); };
  assert.deepEqual(svc.effectivePrices(), { "z/z": { cacheRead: 1 } }, "source 异常回退 patch，不炸查询");
});
