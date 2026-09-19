/** card.ui.test.ts —— 插件卡 UI 自动化验证（索引仓 `docs/settings-cards.md` §1.1/§1.2 + live-verify 机器件，dsh-check 底座）：
 *  一次性实例真启、真浏览器载入，走「侧边栏插件面板 → usage-stats 卡 → 点开详情」全链 DOM 断言。
 *  卡形态 = 宿主 PluginConfigForm 同形四件套：① plugins.item 注册（data-plugin-item）
 *  ② 详情默认折叠（点开才有控件）③ 暂存草稿（拨开关不落盘，未保存标 + 丢弃回基线）
 *  ④ 保存唯一写点（成功后收起、重开回读新值；结束翻回默认开，不污染实例）。
 *  跑法：pnpm check:browser。 */
import { uiScenarioSuite } from "dsh-check";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));

/** 打开侧边栏插件面板，返回本插件卡片行（点开详情后列表卸载，卡片行断言必须在点开之前做）。 */
async function openPluginsPanel(page: any) {
  const panelBtn = page.getByRole("button", { name: /^插件$/ }).first();
  await panelBtn.waitFor({ timeout: 20_000 });
  await panelBtn.click({ timeout: 10_000 });
  const card = page.locator('li[data-plugin-item="usage-stats"]').first();
  await card.waitFor({ timeout: 15_000 });
  return card;
}

/** 点开本插件详情（调用方已断完卡片行之后调；返回详情根）。 */
async function openUsageDetail(card: any, page: any) {
  const openBtn = card.getByRole("button", { name: /Token 用量/ }).first();
  await openBtn.waitFor({ timeout: 15_000 });
  await openBtn.click({ timeout: 10_000 });
  const detail = page.locator('[data-plugin-item-detail="usage-stats"]').first();
  await detail.waitFor({ timeout: 15_000 });
  return detail;
}

const dockSwitch = (detail: any) => detail.getByRole("switch", { name: "对话框底下显示" }).first();
const familySwitch = (detail: any) => detail.getByRole("switch", { name: "合计统计" }).first();

uiScenarioSuite({
  pluginRoot,
  scenarios: [
    {
      name: "卡结构 = 宿主配置卡：plugins.item 注册 + 简介 + 默认折叠 + 点开两开关",
      async run({ page }) {
        const card = await openPluginsPanel(page);
        await card.waitFor({ timeout: 10_000 });
        const cardText = await card.innerText();
        if (!cardText.includes("全局用量页")) throw new Error(`summary 简介缺失：${JSON.stringify(cardText.slice(0, 120))}`);
        const detail = await openUsageDetail(card, page);
        const root = detail.locator("li.usg-card").first();
        await root.waitFor({ timeout: 10_000 });
        const header = detail.getByRole("button", { name: /Token 用量/ }).first();
        if ((await header.getAttribute("aria-expanded")) !== "false")
          throw new Error("卡默认未折叠（aria-expanded ≠ false）——违索引仓 docs/settings-cards.md §1.1");
        if (await detail.getByRole("switch").count()) throw new Error("折叠态就渲染了控件——平铺常开，多吃多占");
        await header.click();
        await header.waitFor({ state: "visible" });
        if ((await header.getAttribute("aria-expanded")) !== "true") throw new Error("点开没生效（aria-expanded 未转 true）");
        // 远端 getConfig 是异步读：等开关回填再断。
        await dockSwitch(detail).waitFor({ state: "visible", timeout: 20_000 });
        await familySwitch(detail).waitFor({ state: "visible", timeout: 20_000 });
        if (!(await detail.locator(".usg-discard").first().isVisible())) throw new Error("footer 缺丢弃");
        if (!(await detail.locator(".usg-save").first().isVisible())) throw new Error("footer 缺保存");
      },
    },
    {
      name: "暂存草稿：拨开关不落盘、未保存标出现、丢弃回基线；保存后收起并回读新值",
      async run({ page }) {
        let detail = page.locator('[data-plugin-item-detail="usage-stats"]').first();
        if (!(await detail.count())) {
          detail = await openUsageDetail(await openPluginsPanel(page), page);
        }
        const header = detail.getByRole("button", { name: /Token 用量/ }).first();
        if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
        const sw = dockSwitch(detail);
        await sw.waitFor({ state: "visible", timeout: 20_000 });
        const baseline = await sw.getAttribute("aria-checked");
        // ① 拨开关：只落草稿，未保存 Tag 挂上，保存从禁用转可用。
        await sw.click();
        await detail.locator(".usg-save:not([disabled])").first().waitFor({ state: "visible", timeout: 10_000 });
        if (!(await detail.getByText("未保存", { exact: false }).first().count())) throw new Error("草稿态无未保存标记");
        if (!(await detail.locator("span[data-tone][class*='usg-pending']").first().count()))
          throw new Error("未保存标记走了替身路径——ui-primitives require 未命中");
        // ② 丢弃：草稿回基线，未保存标记消失——全程没写过盘。
        await detail.locator(".usg-discard").first().click();
        if ((await sw.getAttribute("aria-checked")) !== baseline) throw new Error("丢弃未回基线");
        if (await detail.getByText("未保存", { exact: false }).count()) throw new Error("丢弃后未保存标记未消失");
        // ③ 唯一写点：再拨一次 → 保存 → 收起 → 重开走远端回读，值必须是新写的。
        await sw.click();
        await detail.locator(".usg-save").first().click();
        await detail.locator("button.usg-cardHead[aria-expanded='false']").first().waitFor({ state: "visible", timeout: 15_000 });
        await header.click();
        await sw.waitFor({ state: "visible", timeout: 20_000 });
        const value = await sw.getAttribute("aria-checked");
        if (value === baseline) throw new Error("保存后重开回读失配：值没变");
        // ④ 翻回基线，保持默认开（不污染后继场景与实例）。
        await sw.click();
        await detail.locator(".usg-save").first().click();
        await detail.locator("button.usg-cardHead[aria-expanded='false']").first().waitFor({ state: "visible", timeout: 15_000 });
      },
    },
  ],
});
