/**
 * Commitlint 配置 - 强制 Conventional Commits（scope 按「模块/位置」组织，agent 从改动文件路径机械推导）。
 *
 * scope → 路径映射：
 *   cordis    → src/cordis.ts（服务注册 / Remote 契约 / 宿主接线）
 *   scanner   → src/scanner.ts（会话目录扫描、多帧 zstd 解码）
 *   aggregate → src/aggregate.ts（JSONL 折叠、口径聚合、sessionUsage）
 *   pricing   → src/pricing.ts（价目折算）
 *   settings  → src/settings.ts（schemastery 命名空间与价目层）
 *   store     → src/store.ts（增量扫描的存量持久化与版本门）
 *   client    → lib/client.js（浏览器半：面板 + 设置卡）
 *   tests     → tests/（仅测试改动时）
 *   infra     → 仓库工具链（.husky/、.github/、commitlint/prettier/tsconfig、AGENTS.md、package.json 的 scripts/devDeps）
 *   deps      → 依赖升级（pnpm-lock.yaml、dependencies 字段）
 *
 * 推导规则：
 *   - 特性跨模块 → 选主要 scope（契约类改动通常落 cordis）；只改 src 的其余文件按文件名选。
 *   - 多 scope / 无法判断 → 省略 scope。
 *   - 纯文档（README 双语、注释外文稿）→ type=docs 且省略 scope。
 *
 * subject 中英皆可（header ≤100，body 单行 ≤160）。
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [2, "always", 160],
    "scope-enum": [2, "always", ["cordis", "scanner", "aggregate", "pricing", "settings", "store", "client", "tests", "infra", "deps"]],
    "scope-case": [2, "always", "lower-case"],
    // 中文 subject 常见，且允许 AI/API/SRC/GUI 等缩写开头：关掉大小写启发式。
    "subject-case": [0],
  },
};
