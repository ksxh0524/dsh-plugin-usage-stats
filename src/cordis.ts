/** Cordis 入口：注册 `usageStats` 服务（Typert Gateway 只读 Remote：overview 全局汇总 + familyTotal 合计 + getConfig/setConfig 配置）。
 *  会话级视图宿主自带（底部计数条 + 会话统计对话框），本包只做全局汇总与合计——不预留下钻接口。
 *  合计两开关（familyEnabled 总开关 / dockVisible 对话框底下显示）走宿主 settings 系统
 *  （`settings.installSection("usage-stats", SCHEMA, entry)`，插件管理页按 served namespace ∩ `plugins.item`
 *  同 id 卡配对，值落 `~/.dsh/settings.yaml` 热推送；research 同款姿势）。
 *
 * 设计约束（勿改成 import 官方包）：
 * - 本包运行在宿主 node 进程里，但被 pnpm 链接在文件目录下，若 import
 *   `@deepseek-ai/dsh-typert-protocol` / `@deepseek-ai/cordis` 会解析出与宿主不同的第二副本，
 *   Service 原型链与 instanceof 判定跨副本失效（零依赖铁律）。schemastery 不在此列：
 *   它是被宿主按数据消费的 schema 库（无 Service 原型语义），插件自装同包实例安全（research 同款）。
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
import z from "@deepseek-ai/schemastery";
import { buildFamilyTotal, buildOverview, normalizeRange, scanFolds } from "./aggregate.ts";
import { applyConfigPatch, defaultConfig, normalizeConfig, validateConfigPatch, type UsageStatsSettings } from "./config.ts";
import { sessionsRoot } from "./scanner.ts";
import { FoldStore } from "./store.ts";

export type CordisConfig = {
  /** 会话根目录覆盖（默认 $DSH_HOME/sessions 或 ~/.dsh/sessions）。profile patch 层专用，不进用户配置。 */
  sessionsHome?: string;
  /** 合计总开关的 patch 行底（缺省 true；用户文档层可覆盖）。 */
  familyEnabled?: boolean;
  /** dock 显示的 patch 行底（缺省 true；用户文档层可覆盖）。 */
  dockVisible?: boolean;
};

/** 宿主 settings 系统里本插件的 namespace（lowercase hyphenated；plugins.item 卡 id 与之一致）。 */
export const USAGE_STATS_SETTINGS_NAMESPACE = "usage-stats";

/** 配置段 schema（schemastery；宿主 settings 系统按它解析/校验/持久化文档层）。两个开关都是严格布尔。 */
export const USAGE_STATS_SETTINGS_SCHEMA = z.object({
  familyEnabled: z.boolean(),
  dockVisible: z.boolean(),
});

/** 宿主 settings 面窄脸（research 同款读写位：installSection 注册段 / replace 写值 / writable 只读判定）。 */
interface SettingsFace {
  installSection?(owner: unknown, ns: string, schema: unknown, entry: unknown, hooks: unknown): void;
  replace?(ns: string, value: unknown): Promise<void> | void;
  writable?: boolean;
}

const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";

class UsageStatsService {
  ctx: any;
  config: CordisConfig;
  typertRemote: { service: UsageStatsService; serviceKey: string; namespace: string };
  /** 增量扫描存量（懒初始化：sessions 根要到首次查询才确定）。 */
  private store: FoldStore | null = null;
  /** 当前生效开关（installSection 回灌的 live 闭包；settings 面缺席 = patch 行底）。 */
  source: () => UsageStatsSettings;

  constructor(ctx: any, config: CordisConfig) {
    this.ctx = ctx;
    this.config = config || {};
    this.typertRemote = Object.freeze({ service: this, serviceKey: "usageStats", namespace: "usageStats" });
    const base = { familyEnabled: this.config.familyEnabled, dockVisible: this.config.dockVisible };
    this.source = () => defaultConfig(base);
  }

  private settingsFace(): SettingsFace | undefined {
    return (this.ctx as { get?(name: string): unknown }).get?.("settings") as SettingsFace | undefined;
  }

  private flags(): UsageStatsSettings {
    try {
      return normalizeConfig(this.source(), { familyEnabled: this.config.familyEnabled, dockVisible: this.config.dockVisible });
    } catch {
      return defaultConfig();
    }
  }

  /** 全局汇总视图：`{ from?, to?, model?, provider? }`（日期 YYYY-MM-DD 本地时区），缺省全部。
   *  已删会话的用量由墓碑账本保留，一并计入（见 store.ts）。 */
  async overview(filter: unknown) {
    const root = sessionsRoot(this.config.sessionsHome);
    if (!this.store) this.store = new FoldStore(root);
    const { folds, tombs } = await scanFolds(root, this.store);
    return buildOverview(folds, normalizeRange(filter), tombs);
  }

  /** 合计聚合：`{ sessionId }`（本会话 + 按 parentId 血缘递归的全部后代，全时段全模型）。
   *  只计不列明细：返回计数 + 总数 + 按 `provider/model` 拆行。未知/空 sessionId 返回 known:false；
   *  子代理会话返回 isSubagent:true（调用方不渲染）；已删子会话的用量由墓碑账本保留，一并计入。
   *  总开关关闭时回 enabled:false（调用方不渲染）。 */
  async familyTotal(filter: unknown) {
    const flags = this.flags();
    const id = filter && typeof filter === "object" ? String((filter as Record<string, unknown>).sessionId || "").trim() : "";
    const root = sessionsRoot(this.config.sessionsHome);
    if (!this.store) this.store = new FoldStore(root);
    const { folds, tombs } = await scanFolds(root, this.store);
    return buildFamilyTotal(folds, id, tombs, { enabled: flags.familyEnabled, dockVisible: flags.dockVisible });
  }

  /** 读配置 + 附 UI 所需事实（settingsSection = 宿主 settings 的段落名；writable = 宿主文档是否接受写，卡据此禁用控件）。 */
  async getConfig(_hint: unknown) {
    const settings = this.settingsFace();
    return { config: this.flags(), settingsSection: USAGE_STATS_SETTINGS_NAMESPACE, writable: settings?.writable !== false };
  }

  /** 写配置：patch 归一化 + 形状预检 → 宿主 settings.replace（schema 校验/持久化 settings.yaml/热推送）。
   *  settings 面缺席 = 抛（fail-loud：没有宿主就没有持久化位，不静默吞写）。 */
  async setConfig(patch: unknown) {
    const errors = validateConfigPatch(patch);
    if (errors.length > 0) throw new Error(`usage-stats 配置校验失败：${errors.join("；")}`);
    const settings = this.settingsFace();
    if (!settings?.replace) throw new Error("宿主 settings 服务缺席：无法写入 usage-stats 配置段（settings.yaml）");
    const next = applyConfigPatch(this.flags(), patch);
    await settings.replace(USAGE_STATS_SETTINGS_NAMESPACE, next);
    return next;
  }
}

/** 手写 SRC Remote 标记（形态 = typert-protocol mark() 产物：{version:1, methods:[...]}）。 */
Object.defineProperty(UsageStatsService.prototype, REMOTE_METHODS_KEY, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: "overview", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "familyTotal", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "getConfig", invocation: Object.freeze({ kind: "direct" }) }),
      Object.freeze({ method: "setConfig", invocation: Object.freeze({ kind: "direct" }) }),
    ]),
  }),
});

export const name = "usage-stats";
export const inject: string[] = [];

export function applyCordis(ctx: any, config?: CordisConfig) {
  const service = new UsageStatsService(ctx, config || {});
  ctx.reflect.provide("usageStats", service);
  // 配置段装进宿主 settings 系统（served namespace = 插件卡派发的服务端半）：
  // installSection 把 schema + base 装进宿主，setSource 回灌 live 闭包；settings.yaml 变更热推送。
  ctx.inject?.(["settings"], (settingsCtx: unknown) => {
    const face = (settingsCtx ?? {}) as { settings?: SettingsFace };
    face.settings?.installSection?.(
      ctx,
      USAGE_STATS_SETTINGS_NAMESPACE,
      USAGE_STATS_SETTINGS_SCHEMA,
      defaultConfig({ familyEnabled: config?.familyEnabled, dockVisible: config?.dockVisible }),
      {
        setSource: (source: () => unknown) => {
          service.source = () => normalizeConfig(source(), { familyEnabled: config?.familyEnabled, dockVisible: config?.dockVisible });
        },
        onChange: () => {},
      },
    );
  });
  ctx.logger?.info?.("[plugin-usage-stats] usageStats remote online");
  return service;
}

export default { name, inject, apply: applyCordis };
export { UsageStatsService };
