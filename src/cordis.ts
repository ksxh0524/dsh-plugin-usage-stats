/** Cordis 入口：注册 `usageStats` 服务（Typert Gateway 只读 Remote：overview 单方法）。
 *  会话级视图宿主自带（底部计数条 + 会话统计对话框），本包只做全局汇总——不预留下钻接口。
 *
 * 设计约束（勿改成 import 官方包）：
 * - 本包运行在宿主 node 进程里，但被 pnpm 链接在文件目录下，若 import
 *   `@deepseek-ai/dsh-typert-protocol` / `@deepseek-ai/cordis` 会解析出与宿主不同的第二副本，
 *   Service 原型链与 instanceof 判定跨副本失效（零依赖铁律）。
 * - 因此这里按协议文档的形态手工落两件套：
 *   ① 实例字段 `typertRemote = { service, serviceKey, namespace }`（gateway validateBinding 读它）；
 *   ② 原型字符串键 `"@deepseek-ai/dsh-typert-protocol/remote-methods"`（remoteMethods() 跨副本可读，
 *     version 1 校验通过即可被 collectSrcClaims 认领 SRC endpoint）。
 * - 服务注册走 `ctx.reflect.provide(name, instance)`，与 Service 基类构造函数所做的事等价，
 *   fiber 卸载时自动注销。
 * - SRC 模式参数约束：方法参数必须是不带默认值/解构/rest 的单一标识符（gateway 取函数源码切分参数名，
 *   客户端 contribution descriptor 的 wire 名与之一一对应）。
 *   实测（dsh-api-gateway methodParameterNames + Node type-strip 行为）：`: unknown` 这类简单类型注解
 *   strip 后替换为空白、解析时按 trim 保留标识符，可安全携带（tsc strict 需要）；默认值/解构/rest 禁止。
 */
import { buildOverview, normalizeRange, scanFolds } from "./aggregate.ts";
import { sessionsRoot } from "./scanner.ts";
import { FoldStore } from "./store.ts";

export type CordisConfig = {
  /** 会话根目录覆盖（默认 $DSH_HOME/sessions 或 ~/.dsh/sessions）。 */
  sessionsHome?: string;
};

const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";

class UsageStatsService {
  ctx: any;
  config: CordisConfig;
  typertRemote: { service: UsageStatsService; serviceKey: string; namespace: string };
  /** 增量扫描存量（懒初始化：sessions 根要到首次查询才确定）。 */
  private store: FoldStore | null = null;

  constructor(ctx: any, config: CordisConfig) {
    this.ctx = ctx;
    this.config = config || {};
    this.typertRemote = Object.freeze({ service: this, serviceKey: "usageStats", namespace: "usageStats" });
  }

  /** 全局汇总视图：`{ from?, to?, model?, provider? }`（日期 YYYY-MM-DD 本地时区），缺省全部。
   *  已删会话的用量由墓碑账本保留，一并计入（见 store.ts）。 */
  async overview(filter: unknown) {
    const root = sessionsRoot(this.config.sessionsHome);
    if (!this.store) this.store = new FoldStore(root);
    const { folds, tombs } = await scanFolds(root, this.store);
    return buildOverview(folds, normalizeRange(filter), tombs);
  }
}

/** 手写 SRC Remote 标记（形态 = typert-protocol mark() 产物：{version:1, methods:[...]}）。 */
Object.defineProperty(UsageStatsService.prototype, REMOTE_METHODS_KEY, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([Object.freeze({ method: "overview", invocation: Object.freeze({ kind: "direct" }) })]),
  }),
});

export const name = "usage-stats";
export const inject: string[] = [];

export function applyCordis(ctx: any, config?: CordisConfig) {
  const service = new UsageStatsService(ctx, config || {});
  ctx.reflect.provide("usageStats", service);
  ctx.logger?.info?.("[plugin-usage-stats] usageStats remote online");
  return service;
}

export default { name, inject, apply: applyCordis };
export { UsageStatsService };
