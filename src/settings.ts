/** 设置层：把价目表暴露为 Host settings 命名空间 `usage-stats`，
 *  使 GUI「设置 → 插件 → 插件配置」可运行时编辑（持久化到 settings.yaml），无需改 cordis.patch.yml。
 *
 *  层级（dsh-settings）：patch 行的 config.prices 作为 base，用户设置层在其上覆盖；
 *  读取拿 scope.get() 的 resolved 快照。本模块只做 schema + 形态校验，不碰 cordis ctx。
 *  依赖：@deepseek-ai/schemastery（已在 package.json dependencies，pnpm hoisted 下与宿主同版本）。 */
import z from "@deepseek-ai/schemastery";

/** settings 命名空间（同时是 GUI 卡片 slot key）。 */
export const USAGE_STATS_SETTINGS_NS = "usage-stats";

/** 单模型四路价格：元 / 百万 token（schema 为可调用对象，S(value) 即 cast+校验；.min(0) 挡负数）。 */
export const PriceEntrySchema = z.object({
  input: z.number().min(0).default(0),
  output: z.number().min(0).default(0),
  cacheRead: z.number().min(0).default(0),
  cacheWrite: z.number().min(0).default(0),
});

/** usage-stats 命名空间 schema：{ prices: { "provider/model" | "model": PriceEntry } }。 */
export const UsageStatsSettingsSchema = z.object({
  prices: z.dict(PriceEntrySchema).default({}),
});

/** 附加校验（schema 之外的业务约束）：键非空。schema 的 .ge(0) 已挡负数。
 *  @throws Error 供 installSection 的 validate 钩子拒绝写入。 */
export function assertPricesShape(prices: unknown): void {
  if (prices === undefined || prices === null) return;
  if (typeof prices !== "object" || Array.isArray(prices)) {
    throw new Error("prices 必须是「模型键 → 价格」对象");
  }
  for (const key of Object.keys(prices as object)) {
    if (!key.trim()) throw new Error("prices 模型键不得为空");
  }
}
