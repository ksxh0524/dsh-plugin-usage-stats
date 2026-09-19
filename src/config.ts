/** config.ts —— usage-stats 用户配置的纯函数面（宿主插件卡的配置数据模型）。
 *
 * 设计约束（research 同款）：
 * - **持久化归宿主**：配置值走宿主 settings 系统（cordis 侧 `settings.installSection("usage-stats", SCHEMA, entry)`
 *   注册，落 `~/.dsh/settings.yaml`，热推送）。本文件不做文件 IO。
 * - 写入校验交给宿主 settings schema（schemastery，见 cordis.ts USAGE_STATS_SETTINGS_SCHEMA）——replace fail-loud；
 *   本文件的 validateConfigPatch 是 Remote 侧快速失败（类型级校验由宿主 schema 兜底）。
 * - 两个开关都是 true 缺省（装上即现行行为：合计功能开、dock pill 显示；关掉才隐藏）。
 * - `sessionsHome` 不进用户配置：它是 profile patch 层的会话根覆盖（见 cordis.patch.yml），与用户文档层无关。
 */

export interface UsageStatsSettings {
  /** 总开关：合计统计（familyTotal + dock pill 数据源）是否启用；false = familyTotal 回 enabled:false。 */
  familyEnabled: boolean;
  /** 对话框底下显示：主会话输入框下方的合计 pill 是否渲染。 */
  dockVisible: boolean;
}

/** profile patch 行的覆盖（两个键都可选；缺省 = 现行行为全开）。 */
export interface SettingsBase {
  familyEnabled?: boolean;
  dockVisible?: boolean;
}

/** 空配置：全开 = 现行行为（插件卡装出来就是这个态）。 */
export function defaultConfig(base?: SettingsBase): UsageStatsSettings {
  return {
    familyEnabled: base?.familyEnabled !== false,
    dockVisible: base?.dockVisible !== false,
  };
}

/** patch 合并（undefined 字段保留现值；严格布尔）——settings.replace 前的归一化。 */
export function applyConfigPatch(current: UsageStatsSettings, patch: unknown): UsageStatsSettings {
  const p = (patch ?? {}) as Record<string, unknown>;
  return {
    familyEnabled: p.familyEnabled !== undefined ? p.familyEnabled === true : current.familyEnabled,
    dockVisible: p.dockVisible !== undefined ? p.dockVisible === true : current.dockVisible,
  };
}

/** patch 形状预检（settings.replace 前的快速失败；类型级校验由宿主 schema 兜底）。 */
export function validateConfigPatch(patch: unknown): string[] {
  const errors: string[] = [];
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return ["patch 必须是对象"];
  const p = patch as Record<string, unknown>;
  const known = ["familyEnabled", "dockVisible"];
  for (const key of Object.keys(p)) {
    if (!known.includes(key)) errors.push(`未知字段「${key}」（可用：${known.join("、")}）`);
  }
  for (const key of known) {
    if (p[key] !== undefined && typeof p[key] !== "boolean") errors.push(`${key} 必须是布尔`);
  }
  return errors;
}

/** settings 段值归一化（缺字段补缺省——schemastery 可选字段 unset 时缺键；base 来自 profile patch 行）。 */
export function normalizeConfig(value: unknown, base?: SettingsBase): UsageStatsSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const d = defaultConfig(base);
  return {
    familyEnabled: typeof v.familyEnabled === "boolean" ? v.familyEnabled : d.familyEnabled,
    dockVisible: typeof v.dockVisible === "boolean" ? v.dockVisible : d.dockVisible,
  };
}
