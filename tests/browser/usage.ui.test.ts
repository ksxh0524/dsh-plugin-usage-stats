/** usage.ui.test.ts —— 分区页 UI 自动化验证（索引仓 `docs/settings-pages.md` §4.4 + 索引仓 `docs/runbooks/live-verify.md` 机器件，dsh-check 底座）：
 *  一次性实例真启、真浏览器载入，走「设置 → 左导航 Token 用量」全链 DOM 断言。
 *  断言的是**宿主同位形态**，不是像素：① 滚动只归壳（页根不自开 overflow/height/padding）
 *  ② 页 <h2> 标题 + 页内分节可折叠（组头 aria-expanded/aria-controls 真收得掉内容）
 *  ③ 读视图三态挂 aria-busy、读数走 <dl>/<dt>/<dd>、表带 caption 与 th[scope]
 *  ④ 过滤下拉走宿主 primitives（portal 出页容器 + role=menu/menuitem + Enter/方向键/Escape 全链）
 *  且**无自铺全屏 mask**（v3 的 mask 会压在宿主左导航与关闭 X 之上）
 *  ⑤ 月历（宿主无件）日格是真 <button>、未来日原生 disabled、Escape 只关浮层不关设置窗。
 *  跑法：pnpm check:browser。 */
import { uiScenarioSuite } from "dsh-check";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));

/** 打开设置弹窗并切到本页（宿主设置弹窗左导航栏里与 General/Models/Plugins 同级的条目）。 */
async function openSection(page: any) {
  const dialog = page.locator('[role="dialog"]').last();
  const root = page.locator(".usg-root").first();
  if (await root.isVisible().catch(() => false)) return { dialog, root };
  // 弹窗已开（上一景可能停在别条目）时只切条目：再点齿轮会把窗子关掉
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.locator('[aria-label="设置"]').first().click({ timeout: 10_000 });
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
  }
  await dialog.getByText("Token 用量").first().click({ timeout: 8_000 });
  await root.waitFor({ state: "visible", timeout: 25_000 });
  return { dialog, root };
}

/** 计算样式取值：字符串表达式在页内求值（本包 tsconfig 不带 DOM lib，测试里不能直接写 document）。 */
const styleOf = (page: any, sel: string, prop: string): Promise<string> =>
  page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).${prop}`);

uiScenarioSuite({
  pluginRoot,
  scenarios: [
    {
      name: "页骨架 = 宿主 section 同形：滚动归壳 + h2 标题 + 分节折叠真收得起内容",
      async run({ page }) {
        const { root } = await openSection(page);
        // ① 页根不自开滚动：宿主 .options 是唯一滚动位（自开 = 嵌套双滚动 + 滚动条 token 失效）
        const overflowY = await styleOf(page, ".usg-root", "overflowY");
        if (overflowY === "auto" || overflowY === "scroll")
          throw new Error(`页根自开滚动（overflow-y=${overflowY}）——违索引仓 docs/settings-pages.md §4.4 滚动归壳`);
        const padL = await styleOf(page, ".usg-root", "paddingLeft");
        if (padL !== "0px") throw new Error(`页根自带 padding（${padL}）——页边距归宿主壳，插件再加一层即文字不对齐`);
        const maxW = await styleOf(page, ".usg-root", "maxWidth");
        if (maxW !== "760px" && maxW !== "none") throw new Error(`页宽自造（max-width=${maxW}），宿主档位只 720/760`);
        // ② 标题层级：页 <h2>（禁 <b>/<div> 当标题）
        const h2 = page.locator("h2.usg-h2");
        if ((await h2.count()) !== 1) throw new Error("缺页级 <h2> 标题");
        if (!(await h2.first().innerText()).includes("Token 用量")) throw new Error("h2 标题文案不对");
        // ③ 分节折叠：组头是 aria-expanded 的 button，收起后 aria-controls 指向的内容真从 DOM 摘掉
        const toggle = root.locator(".usg-groupToggle").first();
        // 组随首轮 overview 落地才渲染：等它，不等就成了「查得太早 → 假红」
        await toggle.waitFor({ state: "visible", timeout: 40_000 }).catch(() => {
          throw new Error("页内无组级折叠头（整片常开 = 平铺占位）");
        });
        const controls = await toggle.getAttribute("aria-controls");
        if (!controls) throw new Error("折叠头缺 aria-controls");
        if ((await toggle.getAttribute("aria-expanded")) !== "true") throw new Error("组默认应展开（宿主 inventory 同形：presetOpen ?? true）");
        if (!(await toggle.innerText()).trim()) throw new Error("折叠头无可见标题文案");
        await page
          .locator("#" + controls)
          .first()
          .waitFor({ state: "visible", timeout: 10_000 });
        await toggle.click();
        await toggle.waitFor({ state: "visible" });
        if ((await toggle.getAttribute("aria-expanded")) !== "false") throw new Error("点击未折叠");
        if (await page.locator("#" + controls).count()) throw new Error("折叠后内容仍在 DOM（aria-expanded 只是装饰）");
        await toggle.click();
        await page
          .locator("#" + controls)
          .first()
          .waitFor({ state: "visible", timeout: 10_000 });
      },
    },
    {
      name: "读数语义：容器 aria-busy + KPI 走 dl/dt/dd + 表带 caption 与 th[scope]",
      async run({ page }) {
        const { root } = await openSection(page);
        // 首轮 overview 可能未回：等 KPI 出来（一次性实例无会话也应出零值卡）
        await page.locator(".usg-kpis").first().waitFor({ state: "visible", timeout: 40_000 });
        if (!(await root.getAttribute("aria-busy"))) throw new Error("页根缺 aria-busy（加载态对 AT 不可见）");
        if ((await page.locator("dl.usg-kpis > div > dt").count()) < 4) throw new Error("KPI 不是 <dl>/<dt>/<dd> 结构（裸 <b>+<span> 读数无标签）");
        if ((await page.locator("dl.usg-kpis > div > dd").count()) < 4) throw new Error("KPI 缺 <dd> 数值");
        if (await page.locator(".usg-groupToggle b, .usg-group b").count()) throw new Error("组标题用了 <b>（改折叠头 + <h3>）");
        // 组内两条正路：有行出表（caption + th[scope] 齐），无行出空态文案——都不许静默一块白
        if ((await page.locator("table.usg-table").count()) === 0) {
          if ((await page.locator(".usg-group p.usg-status").count()) === 0) throw new Error("明细组既无表也无空态文案（静默白块）");
        } else {
          if ((await page.locator("table.usg-table caption").count()) < 1) throw new Error("表缺 <caption>（AT 拿不到表意）");
          if ((await page.locator('table.usg-table th[scope="col"]').count()) < 2) throw new Error("表头缺 th[scope=col]");
        }
      },
    },
    {
      name: "过滤下拉 = 宿主 Menu：portal 出页容器 + 项真按钮可聚焦 + 浮层开着宿主 chrome 仍一点就中",
      async run({ page }) {
        const { dialog } = await openSection(page);
        const trigger = page.locator('.usg-btn[aria-haspopup="menu"]').first();
        await trigger.waitFor({ state: "visible", timeout: 15_000 });
        if (await trigger.getAttribute("aria-pressed")) throw new Error("弹层触发器挂 aria-pressed（开合只走 aria-expanded）");
        await trigger.click();
        await trigger.waitFor({ state: "visible" });
        if ((await trigger.getAttribute("aria-expanded")) !== "true") throw new Error("点触发器未打开宿主 Menu");
        const items = page.locator('[role="menuitem"]');
        await items.first().waitFor({ state: "visible", timeout: 8_000 });
        // portal 实证：列表不在页容器内（自绘就地绝对定位才会留在 .usg-root 里）
        if (await page.locator('.usg-root [role="menu"]').count()) throw new Error("浮层没走 portal（还在页容器里就地定位）");
        if (await page.locator('[class*="usg-mask"]').count()) throw new Error("自铺全屏 mask 回潮——会压在宿主左导航与关闭 X 之上");
        // 项本体 = 真 <button role=menuitem>：可聚焦、焦点在内时方向键在项间走（v3 的 <li onClick> 键盘到不了）
        await items.first().evaluate((el: any) => el.focus());
        const roleNow = () => page.evaluate("document.activeElement?.getAttribute('role') || document.activeElement?.tagName") as Promise<string>;
        if ((await roleNow()) !== "menuitem") throw new Error("菜单项不是可聚焦真按钮");
        await page.keyboard.press("ArrowDown");
        if ((await roleNow()) !== "menuitem") throw new Error("焦点在项内时方向键丢失菜单项");
        // 层阶终极实证：浮层开着时点宿主左导航同级条目必须一点就中（v3 的自铺 mask 要点两下）
        await dialog.getByText("插件", { exact: true }).first().click({ timeout: 5_000 });
        if (await page.locator(".usg-root").count()) throw new Error("浮层挡着宿主 chrome：左导航点不动（mask 或 z 序自造档）");
        if (await page.locator("[data-slot-error]").count()) throw new Error("切页后冒出崩脸件");
        // 回本页用键盘再开一次：触发器是 button，Enter 即开
        await openSection(page);
        await trigger.focus();
        await page.keyboard.press("Enter");
        await trigger.waitFor({ state: "visible" });
        if ((await trigger.getAttribute("aria-expanded")) !== "true") throw new Error("Enter 打不开浮层（触发器键盘不可激活）");
        await items.first().waitFor({ state: "visible", timeout: 8_000 });
        // 实测在案的宿主件行为：设置弹窗里 Menu 的 Escape 会连着把弹窗一起关（宿主 Menu 不 stop 冒泡，
        // 插件侧改不了；本包自绘月历自己 stop 住了，见下一景）。行为哪天变了就更新这条与 docs/debt.md。
        await page.keyboard.press("Escape");
        if (await dialog.isVisible().catch(() => false)) throw new Error("宿主 Menu 的 Escape 不再连设置窗一起关了（宿主件变了，记债条同步）");
      },
    },
    {
      name: "月历（宿主无件，坐宿主锚定/关闭骨架）：日格真按钮 + 未来日原生 disabled + 两段式提交 + Escape 只关浮层",
      async run({ page }) {
        await openSection(page);
        const trigger = page.locator('.usg-btn[aria-haspopup="dialog"]').first();
        await trigger.waitFor({ state: "visible", timeout: 15_000 });
        await trigger.click();
        const cells = page.locator("button.usg-pv");
        await cells.first().waitFor({ state: "visible", timeout: 8_000 });
        if (await page.locator("span.usg-pv, li.usg-pv, div.usg-pv").count())
          throw new Error("日格仍有非 button 件（aria 声明挂 generic = AT 不采纳且键盘不可达）");
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        if (now.getDate() < lastDay && (await page.locator("button.usg-pv[disabled]").count()) === 0)
          throw new Error("未来日未真 disabled（应原生禁点，不靠 aria-disabled 装饰）");
        if (await page.locator(".usg-root .usg-pop").count()) throw new Error("月历面板未 portal（就地定位会被面板裁切）");
        // 翻到上月做确定性两段式选取：当月格随「今天」漂移，历史月不会
        await page.locator('button[aria-label="上一月"]').first().click();
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const p2 = (n: number) => (n < 10 ? "0" : "") + n;
        const ym = prev.getFullYear() + "-" + p2(prev.getMonth() + 1);
        const fromCell = page.locator(`button.usg-pv[aria-label="${ym}-05"]`).first();
        await fromCell.waitFor({ state: "visible", timeout: 8_000 });
        await fromCell.click();
        if ((await fromCell.getAttribute("aria-pressed")) !== "true") throw new Error("起点格未落到自己的 aria-pressed（逐格独立绑定的回归位）");
        await page.locator(`button.usg-pv[aria-label="${ym}-12"]`).first().click();
        await trigger.waitFor({ state: "visible" });
        if ((await trigger.getAttribute("aria-expanded")) !== "false") throw new Error("终点提交后浮层未收起");
        if (!(await trigger.innerText()).includes(`${ym.slice(5)}-05 → ${ym.slice(5)}-12`)) throw new Error(`触发器回显不对：${await trigger.innerText()}`);
        // Escape 只关浮层，不冒泡关宿主设置窗
        await trigger.click();
        await cells.first().waitFor({ state: "visible", timeout: 8_000 });
        await page.keyboard.press("Escape");
        await trigger.waitFor({ state: "visible" });
        if ((await trigger.getAttribute("aria-expanded")) !== "false") throw new Error("月历 Escape 未关（宿主面板同层监听 Esc，本地必须 stop 住）");
        if ((await page.locator(".usg-root").count()) === 0) throw new Error("Escape 冒泡把设置窗一起关了（应只关浮层）");
      },
    },
    {
      name: "全家开关行：role=switch 可开合（dock pill 显隐偏好，默认开）",
      async run({ page }) {
        const { root } = await openSection(page);
        const sw = root.getByRole("switch", { name: "会话底部全家用量开关" });
        await sw.waitFor({ state: "visible", timeout: 25_000 });
        const before = await sw.getAttribute("aria-checked");
        await sw.click();
        let flipped = false;
        for (let i = 0; i < 40; i++) {
          if ((await sw.getAttribute("aria-checked")) !== before) {
            flipped = true;
            break;
          }
          await page.waitForTimeout(200);
        }
        if (!flipped) throw new Error("开关点击后 aria-checked 未翻转");
        // 翻回来，保持默认开（不污染后继场景与用户本地偏好）
        await sw.click();
      },
    },
  ],
});
