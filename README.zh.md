# dsh-plugin-usage-stats

[English](./README.md)

DSH（DeepSeek Harness）Web GUI 的用量统计插件（v3）：**设置里的独立「Token 用量」页**——跨全部 workspace 的全局报表（与会话无关）：日期范围选择器（默认今天；预设 今天 / 近3天 / 近7天 / 近30天 / 全部）、**按模型与服务商过滤**、KPI 网格与一张按模型明细表。严格只读，零埋点。

单会话统计（轮/步、tok/s、缓存命中、逐条消息用量）**宿主聊天界面自带**——本插件刻意不重复造；v2 的右侧栏 tab 与下钻接口因此删除。

- 数据源：`<DSH_HOME>/sessions/*/*/session.v3.jsonl.zstd`——**跨全部 workspace 的全局视图**，含子代理会话。
- 增量设计：会话文件是追加式多帧 zstd。字节级精确的帧 walker（RFC 8878 帧头/块头，不碰 LZ4）让扫描器按文件持久化折叠状态，后续只解压**新完成的帧**，未变文件零解压开销。状态落 `<DSH_HOME>/cache/usage-stats.folds.json`（tmp+rename 原子写；状态损坏或缺失自动整文件重扫）。
- 形态：服务端注册 `usageStats` Typert Remote（**单只读方法 `overview(filter)`**）；浏览器半是手写 `__ModuleLoader__` 工厂（`lib/client.js`，无构建链），自挂 remote descriptor 并注入 `settings.section` 页面。

## 安装

```sh
dsh plugin --profile <your-profile> add dsh-plugin-usage-stats
```

然后**重启该 profile 的 host**（新挂载的包不会热加载）。刷新 Web GUI → 设置 → 通用侧栏 → **Token 用量**。

- **日期范围**：单触发按钮（不是两个原生输入框），弹层内含预设快捷键 + 月历任意范围选择（本地时区、按天粒度）。点「全部」清空窗口。
- **过滤**：服务商、模型两个下拉（选项池来自最近一次无过滤扫描；选中服务商后模型列表随之收窄）。
- **报表**：会话数 / 总 token / 未缓存输入 / 输出 / 缓存读（含命中率）/ 缓存写，随后仅一张按模型明细表。刻意**不做按天表**——看某一天用日期筛选直接框住那天即可；报表是纯 token 统计——费用在 v4 整个退出产品（价目层连 API 一并拆除），底部只标数据截至时间。

## 口径

- `inputTokens` = **未缓存输入**（`total = input + output + cacheRead + cacheWrite`，真实数据已核实）。
- 命中率 = `cacheRead / (cacheRead + 未缓存输入)`；`cacheWrite` 单列报告、不参与比率。
- 从不上报缓存字段的 provider，命中率显示“—”（绝不给误导性的 0%）。
- 重试折叠：同一 `(session, turn, step)` scope 只保留末条 usage 样本——这也让增量重放天然幂等。
- 会话画像：scanner 仍把 `userMessages` / `assistantMessages` / `toolCalls` 解析进 `SessionMeta`（逐行 O(1) 顺带计数），但 overview 不再聚合——界面无消息行。
- `overview(filter)` 接受 `{ from?, to?, model?, provider? }`——日期 `YYYY-MM-DD`（本地时区，起止倒挂自动交换），`model` 匹配（`"provider/model"` 全键精确优先、裸模型名兜底），`provider` 匹配服务商段。非法键直接丢弃、不做猜测。

## 开发

以 pnpm `link:`（符号链接）挂进宿主 profile 时，改源码**免重装**：服务端改动重启 host 生效，`lib/client.js` 改动刷新页面即生效。`file:` 挂载则每次须在 profile 内 `pnpm install` 重同步拷贝。

## 测试

```sh
node --test tests/*.test.ts
```

fixture 口径测试（折叠、重试取末条、维度过滤、会话画像计数、store 版本门）、用真 `zstd` CLI 产物对表的帧边界测试（无 CLI 自动 skip）、跨帧半行场景的「增量 === 全量重放」性质测试、持久化 store 重启复用测试，另有真实会话目录集成测试（无会话目录自动 skip）。

## 已知边界（v0.3）

- 增量解码依赖帧 walker 识别「完整帧」：文件尾半帧留待下次补齐；legacy/字典帧退化为整文件重扫（仍正确，只是慢）。
- 无 `zstd` CLI 时增量按帧喂 node:zlib；再失败则整库回退全量重解（结果正确）。
- 打开页面、手动刷新、改筛选时拉取；无服务端推送，也不自动轮询。
- 浏览器侧 `$mount` 手写 strict descriptor（结果 schema 透传）；方法/参数名（`overview(filter)`）与 `src/cordis.ts` 是隐式两端契约，改一端必同步另一端。
