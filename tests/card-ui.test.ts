/** card-ui.test.ts —— 插件卡（plugins.item）的离线检测件（research 同款门）：
 *  席位配对（id === settings 命名空间）+ view 双态 + 即时保存（拨动直写 setConfig，无草稿/保存/丢弃）；
 *  卡与页内分组常开不折叠（用户拍板，偏离宿主 card-form/折叠默认，见 README「交互约定」）；
 *  总开关连 Tab（摘挂 settings.section 注册）。
 *  开关已搬进插件卡——浏览器侧 localStorage 偏好与设置页开关行不得回潮。
 *  真机链路（常开/即写回读/Tab 显隐）由 tests/browser/card.ui.test.ts 守。 */
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

test("即时保存：拨动直写 setConfig，无草稿/保存/丢弃；失败回滚 + 重试 + 只读 + 真 label", () => {
  assert.doesNotMatch(CLIENT, /setDraft|dirtyTag|dirty|未保存/, "草稿态回潮——本卡拨动即写，不许暂存（用户拍板）");
  assert.doesNotMatch(CLIENT, /usg-discard|usg-save[^B]|"丢弃"|收起/, "保存/丢弃/折叠头回潮——卡常开，footer 只有失败时才出现重试");
  const writes = [...CLIENT.matchAll(/\.setConfig\(/g)];
  assert.equal(writes.length, 1, `setConfig 调用点必须唯一（拨动即写唯一写点），实有 ${writes.length} 个`);
  assert.match(CLIENT, /setPending\(null\);\s*setFailed\(obj\)/, "写失败必须清在途并留失败对象（自动回滚到确认值 + 可重试），不许卡死在 pending");
  assert.match(CLIENT, /writable|只读/, "无只读态处理——宿主文档只读时要禁用控件并给提示");
  assert.match(CLIENT, /UI\.Switch/, "开关必须走宿主 Switch 常路");
  assert.match(CLIENT, /htmlFor/, "字段 label 必须真关联（htmlFor），裸 span 读屏无名");
});

test("常开不折叠：卡静态头 + 组静态 h3，无折叠标记", () => {
  assert.match(CLIENT, /usg-cardStatic/, "卡头必须是静态展示（点进详情内容直接可见，不许再套折叠）");
  assert.doesNotMatch(CLIENT, /usg-groupToggle|usg-groupChev/, "组折叠头回潮——页内分组常开，标题走静态 h3");
  assert.match(CLIENT, /h\("h3", \{ className: "usg-groupTitle" \}/, "组标题必须是 <h3>（禁 <b>/<div> 充当标题）");
});

test("总开关连 Tab：摘挂 settings.section 注册，异地写有订阅兜底", () => {
  assert.match(CLIENT, /var disposeSection = null/, "section 注册必须可摘（总开关关闭连 Tab 一起隐藏）");
  assert.match(CLIENT, /sectionCtl\.setVisible = setVisible/, "卡写成功后必须直调 Tab 显隐（不等推送）");
  assert.match(CLIENT, /settings\/document-updated/, "缺 document-updated 订阅——别处改的总开关要能同步 Tab，不许只靠本卡直调");
  assert.match(CLIENT, /fail-open/, "配置读不到必须 fail-open（Tab 留着），不许把页摘掉");
});

test("开关搬家回潮闸：localStorage 偏好与设置页开关行不得复生", () => {
  assert.doesNotMatch(CLIENT, /localStorage/, "浏览器侧偏好存储回潮——开关已搬进插件卡（服务端 settings.yaml）");
  assert.doesNotMatch(CLIENT, /FamilyOptRow/, "设置页开关行回潮——开关只住插件卡");
  assert.doesNotMatch(CLIENT, /usg-optRow/, "开关行样式回潮");
});
