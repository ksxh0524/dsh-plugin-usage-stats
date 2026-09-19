/** card.ui.test.ts —— 插件卡 UI 自动化验证（本包 README「交互约定」的用户拍板形态，dsh-check 底座）：
 *  一次性实例真启、真浏览器载入，走「侧边栏插件面板 → usage-stats 卡 → 点进详情」全链 DOM 断言。
 *  ① 点进详情内容直接可见（无二次折叠、无保存/丢弃按钮）② 拨动即写（无草稿：拨完等存完，
 *  重载页重开回读必须是新值；结束翻回默认开，不污染实例）③ 总开关连 Tab（关掉后设置左导航
 *  「Token 用量」条目即消失，打开即恢复；结束保持开）。
 *  跑法：pnpm check:browser。 */
import { uiScenarioSuite } from "dsh-check";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));

/** 打开侧边栏插件面板，返回本插件卡片行。 */
async function openPluginsPanel(page: any) {
  const panelBtn = page.getByRole("button", { name: /^插件$/ }).first();
  await panelBtn.waitFor({ timeout: 20_000 });
  await panelBtn.click({ timeout: 10_000 });
  const card = page.locator('li[data-plugin-item="usage-stats"]').first();
  await card.waitFor({ timeout: 15_000 });
  return card;
}

/** 点进本插件详情（宿主 chrome；返回详情根——内容直接可见，不许再点折叠头）。 */
async function openUsageDetail(card: any, page: any) {
  const openBtn = card.getByRole("button", { name: /Token 用量/ }).first();
  await openBtn.waitFor({ timeout: 15_000 });
  await openBtn.click({ timeout: 10_000 });
  const detail = page.locator('[data-plugin-item-detail="usage-stats"]').first();
  await detail.waitFor({ timeout: 15_000 });
  return detail;
}

/** 回插件列表（详情页左上「‹ 插件列表」）并等卡片行重现：详情卸载，
 *  再点进即整卡重挂载 → getConfig 重读（reload 会撞宿主 API-Key 引导窗，禁 reload）。 */
async function backToPluginList(page: any) {
  await page.locator("a,button").filter({ hasText: "插件列表" }).first().click({ timeout: 10_000 });
  const card = page.locator('li[data-plugin-item="usage-stats"]').first();
  await card.waitFor({ state: "visible", timeout: 15_000 });
  return card;
}
const dockSwitch = (detail: any) => detail.getByRole("switch", { name: "对话框底下显示" }).first();
const masterSwitch = (detail: any) => detail.getByRole("switch", { name: "Token 用量统计" }).first();
/** 存完判定：《保存中…》行内提示出现过并摘掉（写得快时可能没挂上过，直接看开关可用即算存完）。 */
async function waitSaved(detail: any, sw: any) {
  await detail
    .getByText("保存中…")
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => {});
  await sw.waitFor({ state: "visible", timeout: 15_000 });
  if (await detail.getByText("保存失败").count()) throw new Error("保存失败行未消失（写盘报错，见行内文案）");
}

/** 打开设置弹窗（左导航含 Token 用量条目的那扇窗）。 */
async function openSettings(page: any) {
  const dialog = page.locator('[role="dialog"]').last();
  if (await dialog.isVisible().catch(() => false)) return dialog;
  await page.locator('[aria-label="设置"]').first().click({ timeout: 10_000 });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  return dialog;
}

uiScenarioSuite({
  pluginRoot,
  scenarios: [
    {
      name: "详情常开：点进卡开关直接可见，无二次折叠、无保存/丢弃",
      async run({ page }) {
        const card = await openPluginsPanel(page);
        const cardText = await card.innerText();
        if (!cardText.includes("拨动即保存")) throw new Error(`summary 简介不对：${JSON.stringify(cardText.slice(0, 120))}`);
        const detail = await openUsageDetail(card, page);
        // 开关不经二次点击直接可见
        await dockSwitch(detail).waitFor({ state: "visible", timeout: 20_000 });
        await masterSwitch(detail).waitFor({ state: "visible", timeout: 20_000 });
        // 卡内无折叠头、无保存/丢弃按钮
        if (await detail.locator("button.usg-cardHead").count()) throw new Error("卡头还是可点折叠按钮（详情应常开直出）");
        if (await detail.getByRole("button", { name: /^(保存|丢弃)$/ }).count()) throw new Error("保存/丢弃按钮回潮（本卡拨动即写）");
      },
    },
    {
      name: "拨动即写：拨开关直接落盘，重进详情回读新值（末尾翻回基线）",
      async run({ page }) {
        let detail = page.locator('[data-plugin-item-detail="usage-stats"]').first();
        if (!(await detail.count())) {
          detail = await openUsageDetail(await openPluginsPanel(page), page);
        }
        const sw = dockSwitch(detail);
        await sw.waitFor({ state: "visible", timeout: 20_000 });
        const baseline = await sw.getAttribute("aria-checked");
        // ① 拨开关：不等保存按钮，直接等存完（回显的是服务端回执值）
        await sw.click();
        await waitSaved(detail, sw);
        const flipped = await sw.getAttribute("aria-checked");
        if (flipped === baseline) throw new Error("拨动没翻值");
        // ② 回列表再点进：整卡重挂载 → getConfig 重读必须是新值（草稿态退列表即丢，真落盘才留得住）
        detail = await openUsageDetail(await backToPluginList(page), page);
        const reread = await dockSwitch(detail)
          .getAttribute("aria-checked")
          .catch(async () => {
            await dockSwitch(detail).waitFor({ state: "visible", timeout: 30_000 });
            return dockSwitch(detail).getAttribute("aria-checked");
          });
        if (reread !== flipped) throw new Error("重进后回读失配：拨动没落盘");
        // ③ 翻回基线再重进确认，不污染后继场景与实例
        await dockSwitch(detail).click();
        await waitSaved(detail, dockSwitch(detail));
        detail = await openUsageDetail(await backToPluginList(page), page);
        await dockSwitch(detail).waitFor({ state: "visible", timeout: 20_000 });
        if ((await dockSwitch(detail).getAttribute("aria-checked")) !== baseline) throw new Error("翻回基线失败");
      },
    },
    {
      name: "总开关连 Tab：关掉左导航条目消失，打开恢复（末尾保持开）",
      async run({ page }) {
        let detail = page.locator('[data-plugin-item-detail="usage-stats"]').first();
        if (!(await detail.count())) {
          detail = await openUsageDetail(await openPluginsPanel(page), page);
        }
        const sw = masterSwitch(detail);
        await sw.waitFor({ state: "visible", timeout: 20_000 });
        if ((await sw.getAttribute("aria-checked")) !== "true") {
          await sw.click();
          await waitSaved(detail, sw);
        }
        // ① 关总开关
        await sw.click();
        await waitSaved(detail, sw);
        if ((await sw.getAttribute("aria-checked")) !== "false") throw new Error("总开关没关掉");
        // ② 设置左导航条目必须消失
        const dialog = await openSettings(page);
        await dialog
          .getByText("Token 用量", { exact: true })
          .first()
          .waitFor({ state: "detached", timeout: 15_000 })
          .catch(() => {
            throw new Error("关总开关后设置左导航 Tab 还在（应连 Tab 一起隐藏）");
          });
        // ③ 开回来（先关设置窗，免模态盖住侧边栏）
        await page.keyboard.press("Escape");
        detail = page.locator('[data-plugin-item-detail="usage-stats"]').first();
        if (!(await detail.count())) {
          detail = await openUsageDetail(await openPluginsPanel(page), page);
        }
        const sw2 = masterSwitch(detail);
        await sw2.click();
        await waitSaved(detail, sw2);
        const dialog2 = await openSettings(page);
        await dialog2.getByText("Token 用量", { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
        await page.keyboard.press("Escape");
      },
    },
  ],
});
