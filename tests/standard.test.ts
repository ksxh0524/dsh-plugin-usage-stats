/** standard.test.ts —— 插件标准门（dsh-check）：cordis 形态/零依赖铁律/双语 README/工具链 + 两端契约配对。
 *  断言逻辑全在 dsh-check；本文件只做注册，门规则漂移在共享包统一升级。 */
import { contractPairSuite, pluginStandardSuite } from "dsh-check";
import { UsageStatsService } from "../src/cordis.ts";

pluginStandardSuite({
  metaUrl: import.meta.url,
  // 用户拍板（见 README「交互约定」）：两开关全是可逆布尔、无文本输入，拨动即写、
  // 无草稿/保存/丢弃——偏离宿主 card-form 默认，门按即时写三件查（直写点唯一/失败重试/只读禁写）。
  pluginsItemInstantSave: "用户拍板：两开关全是可逆布尔、无文本草稿，拨动即经 setConfig 直写（见 README「交互约定」）",
});
contractPairSuite({
  service: UsageStatsService,
  namespace: "usageStats",
  idPrefix: "usage-stats",
  metaUrl: import.meta.url,
  optionalParams: true,
});
