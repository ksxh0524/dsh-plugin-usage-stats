# dsh-plugin-usage-stats

[English](./README.md)

DSH Web GUI 的用量统计插件：**设置里的独立「Token 用量」页**——跨全部 workspace 的全局报表（与会话无关）：日期范围选择器、按模型与服务商过滤、KPI 网格与一张按模型明细表。严格只读，零埋点（唯一写点是插件卡里的合计两开关）。单会话统计留在宿主聊天界面；宿主唯一给不出的数——本会话加按血缘递归的全部后代子代理会话——由输入框下方的**「合计」pill**补上。

## 工具与服务

| 名称         | 形态    | 说明                                                                                                                                      |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `usageStats` | Remote  | `overview(filter)` 全局汇总、`familyTotal({sessionId})` 合计、`getConfig`/`setConfig` 合计两开关——读全只读，写只有配置落盘（见 Contract） |
| 增量扫描器   | Service | 字节级精确 zstd 帧 walker：只解压新完成的帧；状态落 `<DSH_HOME>/cache/usage-stats.folds.json`                                             |
| 墓碑账本     | Service | 已删会话的用量晋升墓碑继续计入（活文件重现则活数据权威，不 double count）                                                                 |

## 契约

| 条目          | 规则                                                                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview`    | `{from?, to?, model?, provider?}`——日期 `YYYY-MM-DD`（本地时区，起止倒挂自动交换）；非法键直接丢弃、不做猜测                                                                                                                                                            |
| `familyTotal` | `{sessionId}` → `{enabled, dockVisible, known, isSubagent, sessionCount, totals, hitRate, byModel}`；未知 id 回 `known:false`，子代理会话回 `isSubagent:true`；只计数、不列逐会话明细                                                                                   |
| `getConfig`   | `{}` → `{config: {familyEnabled, dockVisible}, settingsSection: "usage-stats", writable}`——合计两开关现状与宿主写权限                                                                                                                                                   |
| `setConfig`   | `{familyEnabled?, dockVisible?}` → 合并后配置（落 `~/.dsh/settings.yaml` 热推送；非法 patch 或 settings 面缺席抛错）                                                                                                                                                    |
| 口径          | `inputTokens` = 未缓存输入（`total = input + output + cacheRead + cacheWrite`）；命中率 = `cacheRead / (cacheRead + 未缓存输入)`；重试折叠只留同一 `(session, turn, step)` 的末条样本；紧凑显示（K/M/B 档）各自独立舍入——hover 任一数字看精确值（分项精确值恒等于总数） |
| 费用          | 已退出产品：报表是纯 token 统计（价目层 v4 拆除）；底部只标数据截至时间                                                                                                                                                                                                 |

## Config

| key            | 说明                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `sessionsHome` | 会话根覆盖；留空 = 缺省（`$DSH_HOME/sessions` 或 `~/.dsh/sessions`）。在 profile patch 层改它可指向别的会话根。 |

## Install

```sh
# profile package.json dependencies（首个 npm 版本前用本地目录）：
"dsh-plugin-usage-stats": "link:../plugin-usage-stats"
```

Bundle 行：包名 `dsh-plugin-usage-stats` + patch insert id `usage-stats`（`sessionsHome: ""` = 缺省根）。然后重启该 profile 的 host（新挂载的包不会热加载），刷新 Web GUI → 设置 → 左导航 → **Token 用量**。宿主重启只归用户。

## 验证

```sh
node --test tests/*.test.ts   # 先跑服务端逻辑
pnpm check                     # prettier + tsc + 全量测试
pnpm check:browser             # 只在改浏览器半时跑
```

## Browser half

`lib/client.js`（`./client` 子路径，手写 `__ModuleLoader__` 工厂，无构建链）：设置 section 页 + 输入框 pill。断言宿主同形而非像素（索引仓 `docs/settings-pages.md` §1、`docs/design-tokens.md` §1、`docs/runbooks/live-verify.md`）。

| 席位认领与让位 | 现状                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 认领席位       | `settings.section` 页（Token 用量，order 30）+ `conversation.composer.dock` pill（id `family-total`，order 1）+ `plugins.item` 配置卡（id `usage-stats`，order 110） |
| 让位方案       | pill 只在有计费行为的主会话渲染（子代理 / 未知 / 空会话不渲染）；页是专用页，无争位                                                                                  |

合计开关住在插件管理页的本插件卡里：`familyEnabled` 总开关（关掉则设置「Token 用量」页与输入框 pill 一起隐藏）与 `dockVisible`（只隐藏对话框底下的 pill）。拨动即保存，热落盘；两个默认全开。卡与页内分组一律常开不折叠。

## 交互约定（用户拍板，偏离宿主默认）

- 插件卡（`plugins.item`）：内容常开展示——无折叠头、chevron、`aria-expanded`。任一开关拨动即经 `setConfig` 直写（无草稿 / 保存 / 丢弃——两开关都是可逆布尔，内容只有两行）。写失败回滚到确认值，行内报错 + 重试。
- 总开关连 Tab：`familyEnabled` 关闭即摘掉 `settings.section` 注册，设置左导航条目一起消失；打开即恢复。配置读不到时 fail-open（页保留）。
- 页内同样：模型 / 明细分组是静态节（`<h3>` + 计数副行），不折叠。

## 已知边界

- 增量解码依赖帧 walker 识别「完整帧」：文件尾半帧留待下次补齐；legacy/字典帧退化为整文件重扫（仍正确，只是慢）。
- 打开页面、手动刷新、改筛选时拉取；无服务端推送，也不自动轮询。
- 浏览器侧 `$mount` 手写 strict descriptor；方法/参数名与 `src/cordis.ts` 是隐式两端契约，改一端必同步另一端。
- 从不上报缓存字段的 provider，命中率显示“—”（绝不给误导性的 0%）。
