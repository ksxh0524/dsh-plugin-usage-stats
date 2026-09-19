/** card-ui.test.ts —— 插件卡（plugins.item）的离线检测件（research 同款门）：
 *  席位配对（id === settings 命名空间）+ view 双态 + 暂存五件（dirty/丢弃/保存唯一写点/只读/真 label）；
 *  开关已搬进插件卡——浏览器侧 localStorage 偏好与设置页开关行不得回潮。
 *  真机折叠/存盘链路由 tests/browser/card.ui.test.ts 守。 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CLIENT = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
const CORDIS = readFileSync(fileURLToPath(new URL("../src/cordis.ts", import.meta.url)), "utf8");

test("席位：plugins.item 注册 + view 双态 + 旧槽零字面量", () => {
  assert.doesNotMatch(CLIENT, /settings\.plugin\.item/, "上一代 keyed 槽已下线，字面量出现即错位——卡会静默隐身");
  assert.match(CLIENT, /ctx\.slots\.inject\("plugins\.item"/, "未注册进 plugins.item（插件管理页不派发）");
  assert.match(
    CLIENT,
    /\{\s*name:\s*"plugins\.item",\s*id:\s*SETTINGS_NS,\s*order:\s*CARD_ORDER,\s*label:\s*CARD_TITLE\s*\}/,
    "entry 必须带 id/order/label（id 须 === settings 命名空间，靠它与服务端配对）",
  );
  assert.match(CLIENT, /var SETTINGS_NS = "usage-stats"/, "entry id 源头必须是 usage-stats（与 installSection 同名）");
  assert.match(CORDIS, /installSection\?\.\(\s*ctx\s*,\s*USAGE_STATS_SETTINGS_NAMESPACE/, "服务端必须 installSection 同名段，否则卡对不上即隐身");
  assert.match(CLIENT, /props\.view === "summary"/, "组件未按 {view} 分流（summary 一句话 / page 表单）");
  assert.match(CLIENT, /return CARD_DESC;/, "summary 视图必须回一句话简介");
});

test("暂存五件：dirty 标记 + 丢弃 + 保存唯一写点 + 只读 + 真 label", () => {
  assert.match(CLIENT, /dirty|未保存/, "无 dirty/未保存态——卡头必须挂未保存标记");
  assert.match(CLIENT, /discard|丢弃/, "缺「丢弃」入口——草稿要能丢（保存/丢弃成对）");
  const writes = [...CLIENT.matchAll(/\.setConfig\(/g)];
  assert.equal(writes.length, 1, `setConfig 调用点必须唯一（保存唯一写点），实有 ${writes.length} 个`);
  assert.match(CLIENT, /writable|只读/, "无只读态处理——宿主文档只读时要禁用控件并给提示");
  assert.match(CLIENT, /UI\.Switch/, "开关必须走宿主 Switch 常路");
  assert.match(CLIENT, /htmlFor/, "字段 label 必须真关联（htmlFor），裸 span 读屏无名");
});

test("开关搬家回潮闸：localStorage 偏好与设置页开关行不得复生", () => {
  assert.doesNotMatch(CLIENT, /localStorage/, "浏览器侧偏好存储回潮——开关已搬进插件卡（服务端 settings.yaml）");
  assert.doesNotMatch(CLIENT, /FamilyOptRow/, "设置页开关行回潮——开关只住插件卡");
  assert.doesNotMatch(CLIENT, /usg-optRow/, "开关行样式回潮");
});
