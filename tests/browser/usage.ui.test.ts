/** usage.ui.test.ts —— UI 自动化验证（§5 机器化）：一次性实例走「设置 → 通用设置 → Token 用量」，
 *  断言面板挂载且表结构渲染。跑法：pnpm check:browser。 */
import { uiScenarioSuite } from "dsh-check";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));

uiScenarioSuite({
  pluginRoot,
  scenarios: [
    {
      name: "设置 → 通用设置 → Token 用量面板挂载并出表",
      async run({ page }) {
        await page.locator('[aria-label="设置"]').first().click({ timeout: 10_000 });
        const dialog = page.locator('[role="dialog"]').last();
        await dialog.locator("span", { hasText: "通用设置" }).first().waitFor({ timeout: 10_000 });
        await dialog.locator("span", { hasText: "通用设置" }).first().click();
        await dialog.getByText("Token 用量", { exact: false }).first().click({ timeout: 8_000 });
        // 面板组件异步挂载：等 .usg-root 真可见，再等首轮扫描出 KPI（一次性 home 无会话也应出零值 KPI）。
        await page.locator(".usg-root").first().waitFor({ state: "visible", timeout: 25_000 });
        await page.locator(".usg-kpis").first().waitFor({ state: "visible", timeout: 30_000 });
      },
    },
  ],
});
