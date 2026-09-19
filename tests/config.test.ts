/** config.ts 纯函数单测：缺省全开、归一化补缺省、patch 合并、形状预检。 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyConfigPatch, defaultConfig, normalizeConfig, validateConfigPatch } from "../src/config.ts";

test("缺省全开；profile patch 行可预置关闭", () => {
  assert.deepEqual(defaultConfig(), { familyEnabled: true, dockVisible: true });
  assert.deepEqual(defaultConfig({ familyEnabled: false }), { familyEnabled: false, dockVisible: true });
  assert.deepEqual(defaultConfig({ dockVisible: false }), { familyEnabled: true, dockVisible: false });
});

test("归一化：缺键补缺省，非布尔回缺省", () => {
  assert.deepEqual(normalizeConfig(undefined), { familyEnabled: true, dockVisible: true });
  assert.deepEqual(normalizeConfig({ familyEnabled: false }), { familyEnabled: false, dockVisible: true });
  assert.deepEqual(normalizeConfig({ familyEnabled: "yes" }), { familyEnabled: true, dockVisible: true });
  assert.deepEqual(normalizeConfig({ dockVisible: 0 }, { dockVisible: false }), { familyEnabled: true, dockVisible: false });
});

test("patch 合并：undefined 保留现值，非严格布尔不吞", () => {
  const cur = { familyEnabled: true, dockVisible: true };
  assert.deepEqual(applyConfigPatch(cur, { dockVisible: false }), { familyEnabled: true, dockVisible: false });
  assert.deepEqual(applyConfigPatch(cur, {}), cur);
  assert.deepEqual(applyConfigPatch(cur, { familyEnabled: 1 }), { familyEnabled: false, dockVisible: true });
});

test("形状预检：非对象/未知键/非布尔各自报错", () => {
  assert.deepEqual(validateConfigPatch(null), ["patch 必须是对象"]);
  assert.deepEqual(validateConfigPatch([]), ["patch 必须是对象"]);
  assert.deepEqual(validateConfigPatch({ nope: true }), ["未知字段「nope」（可用：familyEnabled、dockVisible）"]);
  assert.deepEqual(validateConfigPatch({ familyEnabled: "true" }), ["familyEnabled 必须是布尔"]);
  assert.deepEqual(validateConfigPatch({ familyEnabled: false, dockVisible: true }), []);
});
