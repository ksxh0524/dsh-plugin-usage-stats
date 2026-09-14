/** Cordis 入口：注册 `usageStats` 服务（Typert Gateway 只读 Remote：overview / drillSessions）。
 *
 * 设计约束（勿改成 import 官方包）：
 * - 本包运行在宿主 node 进程里，但被 pnpm 链接在文件目录下，若 import
 *   `@deepseek-ai/dsh-typert-protocol` / `@deepseek-ai/cordis` 会解析出与宿主不同的第二副本，
 *   Service 原型链与 instanceof 判定跨副本失效（与 plugin-iteration / plugin-auto-cut 同规则：零依赖）。
 * - 因此这里按协议文档的形态手工落两件套：
 *   ① 实例字段 `typertRemote = { service, serviceKey, namespace }`（gateway validateBinding 读它）；
 *   ② 原型字符串键 `"@deepseek-ai/dsh-typert-protocol/remote-methods"`（remoteMethods() 跨副本可读，
 *     version 1 校验通过即可被 collectSrcClaims 认领 SRC endpoint）。
 * - 服务注册走 `ctx.reflect.provide(name, instance)`，与 Service 基类构造函数所做的事等价，
 *   fiber 卸载时自动注销。
 * - SRC 模式参数约束：方法参数必须是不带默认值/解构/rest 的单一标识符（gateway 按源码文本解析参数名，
 *   客户端 contribution descriptor 的 wire 名与之一一对应）。
 */
import { buildDrill, buildOverview, normalizeDrill, normalizeRange, scanFolds, type FileCacheEntry } from "./aggregate.ts";
import { sessionsRoot } from "./scanner.ts";
import { assertPricesShape, USAGE_STATS_SETTINGS_NS, UsageStatsSettingsSchema } from "./settings.ts";
import type { Prices } from "./pricing.ts";

export type CordisConfig = {
  /** 会话根目录覆盖（默认 $DSH_HOME/sessions 或 ~/.dsh/sessions）。 */
  sessionsHome?: string;
  /** 价目表部署 base：键 "provider/model" 或 "model"，值 {input,output,cacheRead,cacheWrite}，元/百万 token。
   *  settings provider 在场时作为 base 层，GUI「设置→插件」用户层覆盖其上。 */
  prices?: Prices;
};

const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";

class UsageStatsService {
  ctx: any;
  config: CordisConfig;
  cache: Map<string, FileCacheEntry> = new Map();
  typertRemote: { service: UsageStatsService; serviceKey: string; namespace: string };
  /** 生效价目来源：默认 patch config；settings 注册后被替换为 scope.get()（含用户层）。 */
  priceSource: () => { prices?: Prices } = () => ({ prices: this.config.prices || {} });

  constructor(ctx: any, config: CordisConfig) {
    this.ctx = ctx;
    this.config = config || {};
    this.typertRemote = Object.freeze({ service: this, serviceKey: "usageStats", namespace: "usageStats" });
  }

  /** 当前生效价目表（settings 用户层 > patch base；异常回退 patch）。 */
  effectivePrices(): Prices {
    try {
      const src = this.priceSource();
      return (src && src.prices) || {};
    } catch {
      return this.config.prices || {};
    }
  }

  /** 汇总视图：`{ from?, to? }`（YYYY-MM-DD，本地时区），缺省全部时间。 */
  async overview(filter) {
    const root = sessionsRoot(this.config.sessionsHome);
    const { folds } = await scanFolds(root, this.cache);
    return buildOverview(folds, normalizeRange(filter), this.effectivePrices());
  }

  /** 会话级下钻：`{ from?, to?, model?, limit?, offset? }`，按最近活跃排序。 */
  async drillSessions(query) {
    const root = sessionsRoot(this.config.sessionsHome);
    const { folds } = await scanFolds(root, this.cache);
    return buildDrill(folds, normalizeDrill(query), this.effectivePrices());
  }
}

/** 手写 SRC Remote 标记（形态 = typert-protocol mark() 产物：{version:1, methods:[...]}）。 */
Object.defineProperty(UsageStatsService.prototype, REMOTE_METHODS_KEY, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: "overview", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "drillSessions", invocation: Object.freeze({ kind: "direct" }) }),
    ]),
  }),
});

export const name = "usage-stats";
export const inject: string[] = [];

export function applyCordis(ctx: any, config?: CordisConfig) {
  const service = new UsageStatsService(ctx, config || {});
  ctx.reflect.provide("usageStats", service);
  // 延迟注入：settings provider 在场才注册命名空间（GUI「设置→插件」可编辑价目）；
  // 不在场则 priceSource 保持 patch config，插件照常出 token 统计（不报钱）。
  if (typeof ctx.inject === "function") {
    ctx.inject(["settings"], (settingsCtx: any) => {
      settingsCtx.settings.installSection(
        ctx,
        USAGE_STATS_SETTINGS_NS,
        UsageStatsSettingsSchema,
        { prices: config?.prices || {} },
        {
          setSource: (source: () => { prices?: Prices }) => {
            service.priceSource = source;
          },
          validate: (value: { prices?: Prices }) => {
            assertPricesShape(value?.prices);
          },
          onChange: () => {},
        }
      );
    });
  }
  ctx.logger?.info?.(`[plugin-usage-stats] usageStats remote online (patch prices: ${Object.keys(config?.prices || {}).length})`);
  return service;
}

export default { name, inject, apply: applyCordis };
export { UsageStatsService };
