/**
 * qa-static.js —— RUN-form v4「星河契约」静态一致性检查（QA / Edward 自建）
 *
 * ⚠️ 这是测试脚本，不是站点源文件。发布前可直接删除。
 *
 * 检查分区：
 *   A. 管理页主界面移除两张技术卡片（用户硬性要求 A）
 *   B. 创意升级「星图契约」的静态落地（用户硬性要求 B）
 *   C. v3 契约回归（数据模型 / localStorage 键 / 工作流 / data 文件）
 *   D. 减弱动效契约（CSS animation 必须在 no-preference 内 + no-motion 降级分支）
 *
 * 运行：node qa-static.js
 * 退出码：0 = 全过，1 = 有 FAIL
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ============================ 断言收集器 ============================

const results = [];
let currentSection = "";

function section(name) {
  currentSection = name;
}

/**
 * 记录一条断言。
 * @param {string} id 断言编号
 * @param {boolean} ok 是否通过
 * @param {string} desc 断言描述
 * @param {string} evidence 证据（通过与否都记录，便于人工复核）
 */
function assert(id, ok, desc, evidence) {
  results.push({
    section: currentSection,
    id,
    ok: Boolean(ok),
    desc,
    evidence: String(evidence == null ? "" : evidence).slice(0, 220),
  });
}

// ============================ HTML 区域切割 ============================

/**
 * 从 html 中抠出 id=targetId 的元素完整区域（依赖 div/aside 等成对标签配平）。
 * 做法：定位起始标签，然后按同名标签计数向后扫描找配对闭合标签。
 * @param {string} html 完整 HTML
 * @param {string} targetId 元素 id
 * @returns {{start:number, end:number, text:string}|null}
 */
function extractRegionById(html, targetId) {
  const idRe = new RegExp(`id=["']${targetId}["']`);
  const m = idRe.exec(html);
  if (!m) return null;

  // 向前回溯到这个属性所属标签的 '<'
  const openLt = html.lastIndexOf("<", m.index);
  if (openLt < 0) return null;

  const tagNameMatch = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(openLt));
  if (!tagNameMatch) return null;
  const tag = tagNameMatch[1].toLowerCase();

  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");

  let depth = 0;
  let cursor = openLt;
  // 逐个比较下一个开标签与下一个闭标签，谁近先处理谁
  while (cursor < html.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return null;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) {
        return { start: openLt, end: cursor, text: html.slice(openLt, cursor) };
      }
    }
  }
  return null;
}

/**
 * 删除 html 中若干区域，返回剩余部分（用于构造「主视图」）。
 * @param {string} html 完整 HTML
 * @param {Array<{start:number,end:number}>} regions 要挖掉的区域
 * @returns {string}
 */
function removeRegions(html, regions) {
  const sorted = regions.slice().sort((a, b) => b.start - a.start);
  let out = html;
  for (const r of sorted) out = out.slice(0, r.start) + out.slice(r.end);
  return out;
}

/** 去掉 HTML 注释，避免注释里的关键词造成误判 */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

// ============================ 读文件 ============================

const manageHtml = read("manage.html");
const indexHtml = read("index.html");
const statsHtml = read("stats.html");
const app2 = read("app2.js");
const app = read("app.js");
const app3 = read("app3.js");
const store = read("store.js");
const components = read("components.js");
const css = read("styles.css");

// =====================================================================
// A. 管理页主界面移除两张技术卡片
// =====================================================================
section("A · 移除技术卡片");

const manageClean = stripComments(manageHtml);
const drawerRegion = extractRegionById(manageClean, "settings-drawer");
const modalRegion = extractRegionById(manageClean, "star-modal");

assert(
  "A0",
  drawerRegion !== null,
  "manage.html 存在 #settings-drawer 且标签配平可被切割",
  drawerRegion ? `抽屉区域 ${drawerRegion.text.length} 字符` : "未找到或标签不配平"
);

const mainView = removeRegions(
  manageClean,
  [drawerRegion, modalRegion].filter(Boolean)
);

// A1 主视图不应出现「同步到 GitHub / 同步到仓库」卡片文案
const syncCopyRe = /同步到\s*(GitHub|仓库)|Personal Access Token|ghp_|github_pat_/;
assert(
  "A1",
  !syncCopyRe.test(mainView),
  "主视图（抽屉/弹层之外）不含「同步到 GitHub/仓库」卡片文案",
  syncCopyRe.test(mainView) ? `命中：${(syncCopyRe.exec(mainView) || [])[0]}` : "主视图无同步文案"
);

// A2 主视图不应出现 #pat-input / #sync-btn
const patInMain = /id=["']pat-input["']/.test(mainView);
const syncInMain = /id=["']sync-btn["']/.test(mainView);
assert(
  "A2",
  !patInMain && !syncInMain,
  "#pat-input / #sync-btn 不在主视图 DOM 中",
  `pat-input in main = ${patInMain}, sync-btn in main = ${syncInMain}`
);

// A3 主视图不应出现「备份与恢复」卡片与导出按钮
const backupCopyRe = /备份与恢复|导出备份/;
const exportInMain = /id=["']export-btn["']/.test(mainView);
assert(
  "A3",
  !backupCopyRe.test(mainView) && !exportInMain,
  "主视图不含「备份与恢复」卡片与 #export-btn",
  `备份文案命中=${backupCopyRe.test(mainView)}, export-btn in main=${exportInMain}`
);

// A4 三个关键 id 必须仍存在于整页 DOM 中
for (const id of ["pat-input", "sync-btn", "toast"]) {
  const re = new RegExp(`id=["']${id}["']`);
  assert(
    `A4.${id}`,
    re.test(manageClean),
    `#${id} 仍存在于 manage.html DOM 中（同步功能不失联）`,
    re.test(manageClean) ? "存在" : "缺失 —— 同步/提示功能会失联"
  );
}

// A5 pat-input / sync-btn / export-btn 必须落在抽屉内
if (drawerRegion) {
  for (const id of ["pat-input", "sync-btn", "export-btn", "import-btn", "clear-all-btn"]) {
    const re = new RegExp(`id=["']${id}["']`);
    assert(
      `A5.${id}`,
      re.test(drawerRegion.text),
      `#${id} 位于 #settings-drawer 内`,
      re.test(drawerRegion.text) ? "在抽屉内" : "不在抽屉内"
    );
  }
}

// A6 存在可触发抽屉的按钮，且 app2.js 绑定了点击
const gearBtnRe = /<button[^>]*id=["']([a-z-]*(?:gear|settings|star)[a-z-]*)["'][^>]*>/i;
const gearMatch = gearBtnRe.exec(mainView);
assert(
  "A6",
  gearMatch !== null,
  "主视图存在可触发设置抽屉的按钮（id 含 gear/settings/star）",
  gearMatch ? `按钮 id = ${gearMatch[1]}` : "未找到触发按钮"
);

const bindsOpen =
  /settingsBtn\.addEventListener\(\s*["']click["']\s*,\s*openSettings\s*\)/.test(app2);
assert(
  "A6.bind",
  bindsOpen,
  "app2.js 将设置按钮 click 绑定到 openSettings()",
  bindsOpen ? "已绑定 openSettings" : "未找到绑定"
);

const hasAriaControls = /aria-controls=["']settings-drawer["']/.test(mainView);
assert(
  "A6.a11y",
  hasAriaControls,
  "触发按钮带 aria-controls=\"settings-drawer\"（无障碍关联）",
  hasAriaControls ? "存在 aria-controls" : "缺少 aria-controls"
);

// =====================================================================
// B. 创意升级（星图契约）静态落地
// =====================================================================
section("B · 创意升级");

// B1 星图容器 + 渲染调用
const hasSkyMapSlot = /id=["']sky-map-slot["']/.test(manageClean);
const rendersStarMap = /uiStarMap\s*\(/.test(app2);
assert(
  "B1",
  hasSkyMapSlot && rendersStarMap,
  "manage.html 存在星图容器 #sky-map-slot，app2.js 调用 uiStarMap 渲染星节点",
  `容器=${hasSkyMapSlot}, app2 调用 uiStarMap=${rendersStarMap}`
);

const starClickDelegated = /data-act["']?\s*\)\s*===?\s*["']star["']|act === "star"/.test(app2);
assert(
  "B1.click",
  starClickDelegated && /openStarModal\(/.test(app2),
  "点击星节点可打开星体编辑舱（事件委托 data-act=\"star\" → openStarModal）",
  starClickDelegated ? "已委托" : "未找到 data-act=star 分支"
);

// B5 定义在 store.js 的核心算法函数
for (const fn of ["planStarPosition", "planBrightness", "buildStarMap", "skyPoem", "buildMonthGrid", "milestoneCheer"]) {
  const re = new RegExp(`^function ${fn}\\s*\\(`, "m");
  assert(`B2.${fn}`, re.test(store), `store.js 定义 ${fn}()`, re.test(store) ? "已定义" : "缺失");
}

// B3 v4 ui* 渲染器
for (const fn of ["uiStarMap", "uiStar", "uiSkyMeta", "uiStarBrief", "uiMoonPhase", "uiComet", "uiStarTrack", "uiMonthGrid", "uiBrightBars", "uiCheer", "uiStarHeatmap", "uiTimelineStar", "uiSkyQuote"]) {
  const re = new RegExp(`^function ${fn}\\s*\\(`, "m");
  assert(`B3.${fn}`, re.test(components), `components.js 定义 ${fn}()`, re.test(components) ? "已定义" : "缺失");
}

// B4 仪表盘四项天象指标 + 月相/彗尾容器
const astroIds = ["stat-active", "stat-today", "stat-streak", "stat-rate", "comet-slot", "moon-slot"];
for (const id of astroIds) {
  const re = new RegExp(`id=["']${id}["']`);
  assert(`B4.${id}`, re.test(indexHtml), `index.html 天象指标容器 #${id} 存在`, re.test(indexHtml) ? "存在" : "缺失");
}
const appRendersMoon = /uiMoonPhase\s*\(/.test(app);
const appRendersComet = /uiComet\s*\(/.test(app);
assert(
  "B4.render",
  appRendersMoon && appRendersComet,
  "app.js 实际调用 uiMoonPhase / uiComet 注入真实 SVG",
  `uiMoonPhase=${appRendersMoon}, uiComet=${appRendersComet}`
);

// 月相必须是真 SVG（存在 path/circle 与渐变），而不是 emoji 占位
const moonBody = /function uiMoonPhase[\s\S]*?\n}/.exec(components);
const moonIsSvg =
  moonBody &&
  /<svg/.test(moonBody[0]) &&
  /<path class="moon-lit"/.test(moonBody[0]) &&
  /radialGradient/.test(moonBody[0]);
assert(
  "B4.svg",
  Boolean(moonIsSvg),
  "月相为真实 SVG（含 <svg> / moon-lit path / radialGradient），非 emoji 占位",
  moonIsSvg ? "真 SVG 月相" : "未检出 SVG 月相结构"
);

// B5 统计页「星历」结构
const statsIds = ["cheer-slot", "track-slot", "month-slot", "heatmap-year", "badge-grid", "rate-list"];
for (const id of statsIds) {
  const re = new RegExp(`id=["']${id}["']`);
  assert(`B5.${id}`, re.test(statsHtml), `stats.html 星历模块 #${id} 存在`, re.test(statsHtml) ? "存在" : "缺失");
}
const app3Renders = ["uiStarTrack", "uiMonthGrid", "uiBrightBars", "uiCheer"].filter((f) =>
  new RegExp(`${f}\\s*\\(`).test(app3)
);
assert(
  "B5.render",
  app3Renders.length === 4,
  "app3.js 调用 uiStarTrack / uiMonthGrid / uiBrightBars / uiCheer",
  `已调用：${app3Renders.join(", ")}`
);

// B6 情感化文案
const emotionWords = ["缔结", "熄灭", "星河", "星语", "星历", "星轨", "契约"];
const corpus = manageHtml + indexHtml + statsHtml + store + components + app + app2 + app3;
const hitWords = emotionWords.filter((w) => corpus.includes(w));
assert(
  "B6",
  hitWords.length >= 5,
  "情感化文案关键词覆盖（缔结/熄灭/星河/星语/星历/星轨/契约 至少 5 个）",
  `命中 ${hitWords.length}/${emotionWords.length}：${hitWords.join("、")}`
);

// 三页标题都已切到星河契约语义
const titles = [
  ["manage.html", /<title>([^<]*)<\/title>/.exec(manageHtml)],
  ["index.html", /<title>([^<]*)<\/title>/.exec(indexHtml)],
  ["stats.html", /<title>([^<]*)<\/title>/.exec(statsHtml)],
];
const allStarTitles = titles.every(([, m]) => m && /星河契约/.test(m[1]));
assert(
  "B6.title",
  allStarTitles,
  "三页 <title> 均带「星河契约」标识",
  titles.map(([f, m]) => `${f}: ${m ? m[1] : "?"}`).join(" | ")
);

// =====================================================================
// C. v3 契约回归
// =====================================================================
section("C · 回归 v3");

// C1 localStorage 键名
const keyExpect = {
  PLAN_KEY: "runform_plans",
  CHECKIN_KEY: "runform_checkins",
  TOKEN_KEY: "runform_pat",
  PREFS_KEY: "runform_prefs",
};
for (const [k, v] of Object.entries(keyExpect)) {
  const re = new RegExp(`const ${k}\\s*=\\s*["']${v}["']`);
  assert(`C1.${k}`, re.test(store), `localStorage 键 ${k} === "${v}" 未变`, re.test(store) ? "一致" : "已被改动");
}

// C2 v3 核心函数仍在（签名未删）
const v3Fns = [
  "computeStreak", "buildHeatmap", "nextReminder", "overviewStats", "loadPlans",
  "savePlans", "addPlan", "updatePlan", "deletePlan", "togglePlan", "loadCheckins",
  "addCheckin", "deleteCheckin", "clearAll", "isPlanDueOn", "todayPlans",
  "completionRate", "globalStreak", "dailyTrend", "milestones", "exportData",
  "importData", "scheduleAutoSync", "describePlan", "buildActivityMap", "reminderStatus",
];
const missingV3 = v3Fns.filter((f) => !new RegExp(`^function ${f}\\s*\\(`, "m").test(store));
assert(
  "C2",
  missingV3.length === 0,
  "v3 全部核心函数仍存在于 store.js（v4 为追加而非改写）",
  missingV3.length ? `缺失：${missingV3.join(", ")}` : `${v3Fns.length} 个函数全部在位`
);

assert(
  "C2.quotes",
  /const VAN_GOGH_QUOTES\s*=/.test(store),
  "VAN_GOGH_QUOTES 常量保留",
  /const VAN_GOGH_QUOTES\s*=/.test(store) ? "保留" : "已删除"
);

// v4 增量层必须在 v3 之后追加
const v4MarkerIdx = store.indexOf("v4「星河契约」增量层");
const computeStreakIdx = store.indexOf("function computeStreak");
assert(
  "C2.append",
  v4MarkerIdx > computeStreakIdx && computeStreakIdx > 0,
  "v4 增量层位于 v3 函数之后（追加式改造）",
  `computeStreak@${computeStreakIdx} < v4增量层@${v4MarkerIdx}`
);

// C3 Plan / Checkin 数据模型字段
// ⚠️ QA 修正记录（Edward）：初版断言只认 `field:` 写法，漏掉了 ES6 简写属性
//    （store.js addPlan 里 `id` 写作 `id,` 而非 `id: id`），导致误报 C3.plan FAIL。
//    源码本身 10 字段齐全，属测试代码 Bug，已在此放宽为「field: 或 field, 或 field}」。
//    真正的字段校验以 qa-runtime.js 的 Object.keys(addPlan(...)) 为准。
const propRe = (f) => new RegExp(`(^|[{,\\s])${f}\\s*(:|,|\\n|\\})`);

const planFields = ["id", "name", "freq", "time", "day", "enabled", "icon", "color", "desc", "createdAt"];
const addPlanBody = /function addPlan[\s\S]*?\n}/.exec(store);
const missingPlan = addPlanBody ? planFields.filter((f) => !propRe(f).test(addPlanBody[0])) : planFields;
assert(
  "C3.plan",
  addPlanBody && missingPlan.length === 0,
  `Plan 模型 10 字段未删改（${planFields.join("/")}）`,
  missingPlan.length ? `缺失：${missingPlan.join(", ")}` : "10 字段齐全（含 ES6 简写 id）"
);

const checkinFields = ["id", "planId", "planName", "ts", "source"];
const addCheckinBody = /function addCheckin[\s\S]*?\n}/.exec(store);
const missingCheckin = addCheckinBody ? checkinFields.filter((f) => !propRe(f).test(addCheckinBody[0])) : checkinFields;
assert(
  "C3.checkin",
  addCheckinBody && missingCheckin.length === 0,
  `Checkin 模型字段未删改（${checkinFields.join("/")}）`,
  missingCheckin.length ? `缺失：${missingCheckin.join(", ")}` : "5 字段齐全"
);

// C4 工作流关键逻辑仍在（本次未改动）
const wfReminder = read(".github/workflows/dingtalk-reminder.yml");
const wfSync = read(".github/workflows/sync.yml");
for (const [name, text, markers] of [
  ["dingtalk-reminder.yml", wfReminder, ["WINDOW_MIN", "candidate_days", "now.weekday() == day", "schedule:"]],
  ["sync.yml", wfSync, ["repository_dispatch", "sync-checkins", "data/plans.json", "data/checkins.json"]],
]) {
  const miss = markers.filter((m) => !text.includes(m));
  assert(
    `C4.${name}`,
    miss.length === 0,
    `${name} 关键逻辑完整（${markers.join(" / ")}）`,
    miss.length ? `缺失：${miss.join(", ")}` : "全部命中"
  );
}

// 星期口径必须仍是 Python 口径（周一 = 0），前后端一致
const pyInStore = /function pyWeekday/.test(store);
const pyInHtml = /value="0">周一/.test(manageHtml);
const pyInWf = /weekday\(\) == day/.test(wfReminder);
assert(
  "C4.weekday",
  pyInStore && pyInHtml && pyInWf,
  "星期口径三处一致：store.pyWeekday / manage.html option value=0→周一 / 提醒脚本 weekday()",
  `store=${pyInStore}, html=${pyInHtml}, workflow=${pyInWf}`
);

// C5 data/*.json 未改动（内容应为 v3 初始态）
const dataExpect = {
  "data/plans.json": "[]",
  "data/checkins.json": "[]",
};
for (const [f, want] of Object.entries(dataExpect)) {
  const got = read(f).trim();
  assert(`C5.${f}`, got === want, `${f} 保持初始态 ${want}`, `实际：${got.slice(0, 80)}`);
}
const rs = JSON.parse(read("data/reminder-state.json"));
assert(
  "C5.reminder-state",
  rs && typeof rs === "object" && "sent" in rs && "updatedAt" in rs,
  "data/reminder-state.json 结构未变（{sent, updatedAt}）",
  JSON.stringify(rs)
);

// C6 .nojekyll
assert("C6", exists(".nojekyll"), ".nojekyll 仍在根目录（GitHub Pages 不走 Jekyll）", exists(".nojekyll") ? "存在" : "缺失");

// C7 无构建 / 无第三方依赖：三页只引 3 个本地脚本
for (const [name, html] of [["index.html", indexHtml], ["manage.html", manageHtml], ["stats.html", statsHtml]]) {
  const srcs = Array.from(html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)).map((m) => m[1]);
  const allLocal = srcs.length > 0 && srcs.every((s) => !/^https?:|^\/\//.test(s));
  assert(`C7.${name}`, allLocal, `${name} 只引用本地脚本，无第三方 CDN`, `scripts: ${srcs.join(", ")}`);
}

// =====================================================================
// D. 减弱动效契约
// =====================================================================
section("D · 动效契约");

/** 去掉 CSS 注释 */
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * 扫描所有 animation 相关声明，判断它们是否处于
 * @media (prefers-reduced-motion: no-preference) 内。
 * @param {string} text CSS 源码
 * @returns {{inside:Array, outside:Array, keyframesOutside:Array}}
 */
function scanAnimations(text) {
  const src = stripCssComments(text);
  const stack = []; // 每层记录 { atRule:string }
  const inside = [];
  const outside = [];
  const keyframesOutside = [];

  let i = 0;
  let blockStart = 0;
  let line = 1;

  const lineAt = (idx) => src.slice(0, idx).split("\n").length;

  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = src.slice(blockStart, i).trim().split("\n").pop().trim();
      const fullPrelude = src.slice(blockStart, i).trim();
      stack.push({ prelude: fullPrelude || prelude });
      blockStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      blockStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === ";") {
      const decl = src.slice(blockStart, i).trim();
      blockStart = i + 1;
      if (/^animation(-name)?\s*:/.test(decl)) {
        const inNoPref = stack.some((s) =>
          /@media[^{]*prefers-reduced-motion\s*:\s*no-preference/i.test(s.prelude)
        );
        const selector = stack.length ? stack[stack.length - 1].prelude.replace(/\s+/g, " ") : "?";
        const entry = { decl, selector, line: lineAt(i), inNoPref };
        if (inNoPref) inside.push(entry);
        else outside.push(entry);
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  // @keyframes 是否都在 no-preference 内
  const kfRe = /@keyframes\s+([\w-]+)/g;
  let km;
  while ((km = kfRe.exec(src))) {
    // 判断该 @keyframes 之前最近的 no-preference 块是否仍未闭合
    const before = src.slice(0, km.index);
    const openNoPref = (before.match(/@media[^{]*prefers-reduced-motion\s*:\s*no-preference[^{]*\{/gi) || []).length;
    if (openNoPref === 0) {
      keyframesOutside.push({ name: km[1], line: lineAt(km.index) });
      continue;
    }
    // 粗粒度：统计从最后一个 no-preference 开始处到当前位置的花括号是否配平
    const lastIdx = before.toLowerCase().lastIndexOf("prefers-reduced-motion: no-preference");
    const seg = src.slice(lastIdx, km.index);
    const opens = (seg.match(/\{/g) || []).length;
    const closes = (seg.match(/\}/g) || []).length;
    if (opens - closes < 1) keyframesOutside.push({ name: km[1], line: lineAt(km.index) });
  }

  return { inside, outside, keyframesOutside, line };
}

const scan = scanAnimations(css);

// D1 no-preference 之外的 animation 声明，只允许是「降级重置」
const illegalOutside = scan.outside.filter((e) => {
  const v = e.decl.split(":").slice(1).join(":").trim().toLowerCase();
  // 合法降级：animation: none / animation-name: none / 0.001ms 之类
  return !(/^none\b/.test(v) || /0\.001m?s/.test(v) || /\bnone\s*!important/.test(v));
});
assert(
  "D1",
  illegalOutside.length === 0,
  "所有真实 animation 声明都在 @media (prefers-reduced-motion: no-preference) 内",
  illegalOutside.length
    ? illegalOutside.map((e) => `L${e.line} ${e.selector} { ${e.decl} }`).join(" ;; ")
    : `no-preference 内 ${scan.inside.length} 条，外部仅 ${scan.outside.length} 条降级重置`
);

// D2 所有 @keyframes 都在 no-preference 内
assert(
  "D2",
  scan.keyframesOutside.length === 0,
  "所有 @keyframes 都定义在 no-preference 块内",
  scan.keyframesOutside.length
    ? scan.keyframesOutside.map((k) => `${k.name}@L${k.line}`).join(", ")
    : "全部 @keyframes 在 no-preference 内"
);

// D3 html.no-motion 全局降级分支存在
const noMotionGlobal = /html\.no-motion\s*\*[\s\S]{0,400}?animation[^;]*0\.001m?s[^;]*!important/.test(
  stripCssComments(css)
);
assert(
  "D3",
  noMotionGlobal,
  "存在 html.no-motion * 全局降级分支（animation 0.001ms !important）",
  noMotionGlobal ? "存在全局降级" : "未找到 html.no-motion 全局降级"
);

// D4 prefers-reduced-motion: reduce 分支存在
const reduceBranch = (stripCssComments(css).match(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/gi) || []).length;
assert(
  "D4",
  reduceBranch >= 1,
  "存在 @media (prefers-reduced-motion: reduce) 系统级降级分支",
  `找到 ${reduceBranch} 处 reduce 分支`
);

// D5 v4 新增动效类都有 no-motion 覆盖
const v4MotionClasses = ["track-trail", "bright-fill", "modal-panel", "drawer-panel", "sky-link", "star-halo"];
const noMotionSection = stripCssComments(css);
const uncovered = v4MotionClasses.filter((c) => !new RegExp(`html\\.no-motion[^{]*\\.${c}`).test(noMotionSection));
assert(
  "D5",
  uncovered.length === 0,
  "v4 新增动效类均被 html.no-motion 降级规则覆盖",
  uncovered.length ? `未覆盖：${uncovered.join(", ")}` : `${v4MotionClasses.length} 个类全部覆盖`
);

// D6 组件层不写死 animation（动效必须交给 CSS 统一开关）
const inlineAnim = /style="[^"]*animation\s*:/.test(components) || /animation\s*:/.test(
  components.replace(/^\s*\*.*$/gm, "")
);
assert(
  "D6",
  !inlineAnim,
  "components.js 不内联写死 animation（动效统一交给 CSS 开关）",
  inlineAnim ? "检出内联 animation" : "无内联 animation"
);

// =====================================================================
// E. 跨文件引用完整性（白屏风险）
// =====================================================================
section("E · 跨文件引用");

/** 抽取一段 JS 里的顶层声明名（function / const / let） */
function topLevelDecls(src) {
  const names = new Set();
  const re = /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1] || m[2]);
  return names;
}

const storeDecls = topLevelDecls(store);
const compDecls = topLevelDecls(components);

// E1 store.js 与 components.js 顶层不得重名（浏览器里同属全局脚本作用域，重复声明 = 白屏）
const clash = [...storeDecls].filter((n) => compDecls.has(n));
assert(
  "E1",
  clash.length === 0,
  "store.js 与 components.js 顶层声明无重名（避免 \"already declared\" 白屏）",
  clash.length ? `冲突：${clash.join(", ")}` : `store ${storeDecls.size} 个 / components ${compDecls.size} 个，无冲突`
);

// E2 页面脚本与两个库之间也不得重名（$ 除外，它只允许在页面脚本里声明）
for (const [name, src] of [["app.js", app], ["app2.js", app2], ["app3.js", app3]]) {
  const d = topLevelDecls(src);
  const c = [...d].filter((n) => storeDecls.has(n) || compDecls.has(n));
  assert(
    `E2.${name}`,
    c.length === 0,
    `${name} 顶层声明不与 store.js / components.js 重名`,
    c.length ? `冲突：${c.join(", ")}` : `${d.size} 个顶层声明，无冲突`
  );
}

// E3 components.js 禁止声明 const $（契约明文规定，重复声明会白屏）
assert(
  "E3",
  !/^\s*(?:const|let|var)\s+\$\s*=/m.test(components),
  "components.js 未声明 `$`（页面脚本已占用该名，重复声明会白屏）",
  /^\s*(?:const|let|var)\s+\$\s*=/m.test(components) ? "检出 $ 声明" : "未声明 $"
);

// E4 页面脚本引用的 DOM id 必须在对应 HTML 中存在（悬空引用 = 功能静默失效）
//
// ⚠️ QA 修正记录（Edward）：初版只比对「静态 HTML 文件里的 id」，漏掉了
//    components.js 各 ui* 渲染器在运行时 innerHTML 注入到页面的 id。
//    例如 app2.js 引用 #plan-icon-custom，该元素由 uiIconPicker()（components.js:341）
//    动态生成并注入 #icon-picker-slot（manage.html:82），打开计划表单时
//    iconSlot.innerHTML = uiIconPicker(...)（app2.js:147）才会落地。所以静态 HTML
//    查不到它，属「静态分析误报」，而非源码 Bug。已修正为：HTML 静态 id 与
//    components.js 模板里声明的 id 取并集后再比对。
const componentInjectedIds = new Set();
for (const m of components.matchAll(/id=["']([\w-]+)["']/g)) componentInjectedIds.add(m[1]);

const pageMap = [
  ["app.js", app, "index.html", indexHtml],
  ["app2.js", app2, "manage.html", manageHtml],
  ["app3.js", app3, "stats.html", statsHtml],
];
for (const [jsName, jsSrc, htmlName, htmlSrc] of pageMap) {
  const ids = new Set();
  for (const m of jsSrc.matchAll(/\$\(\s*["']([\w-]+)["']\s*\)/g)) ids.add(m[1]);
  for (const m of jsSrc.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)/g)) ids.add(m[1]);
  const missing = [...ids].filter(
    (id) => !new RegExp(`id=["']${id}["']`).test(htmlSrc) && !componentInjectedIds.has(id)
  );
  assert(
    `E4.${jsName}`,
    missing.length === 0,
    `${jsName} 引用的 DOM id 在 ${htmlName}（含运行时注入）均存在（无悬空引用）`,
    missing.length ? `${htmlName} 缺少：${missing.join(", ")}` : `${ids.size} 个 id 全部命中`
  );
}

// E5 页面脚本调用的 ui* / store 函数必须已定义（未定义 = 运行时 ReferenceError 白屏）
const known = new Set([...storeDecls, ...compDecls]);
const jsBuiltins = new Set(["uiSeq"]);
for (const [name, src] of [["app.js", app], ["app2.js", app2], ["app3.js", app3]]) {
  const localDecls = topLevelDecls(src);
  const called = new Set();
  for (const m of src.matchAll(/\b(ui[A-Z][\w$]*)\s*\(/g)) called.add(m[1]);
  const undef = [...called].filter(
    (fn) => !known.has(fn) && !localDecls.has(fn) && !jsBuiltins.has(fn)
  );
  assert(
    `E5.${name}`,
    undef.length === 0,
    `${name} 调用的所有 ui* 函数均已定义`,
    undef.length ? `未定义：${undef.join(", ")}` : `${called.size} 个 ui* 调用全部有定义`
  );
}

// E6 HTML 里的内联 on* 事件处理器（CSP 风险 + 与「事件全在 JS 里绑」的契约冲突）
for (const [name, html] of [["index.html", indexHtml], ["manage.html", manageHtml], ["stats.html", statsHtml]]) {
  const inline = Array.from(html.matchAll(/\son(?:click|change|input|submit|load)\s*=/gi)).length;
  assert(`E6.${name}`, inline === 0, `${name} 无内联 on* 事件处理器`, `找到 ${inline} 处`);
}

// =====================================================================
// 输出
// =====================================================================

const bySection = new Map();
for (const r of results) {
  if (!bySection.has(r.section)) bySection.set(r.section, []);
  bySection.get(r.section).push(r);
}

let failCount = 0;
console.log("\n══════════ RUN-form v4 静态一致性检查（qa-static.js）══════════\n");
for (const [name, list] of bySection) {
  const pass = list.filter((r) => r.ok).length;
  console.log(`── ${name} ── ${pass}/${list.length}`);
  for (const r of list) {
    const tag = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failCount += 1;
    console.log(`  [${tag}] ${r.id}  ${r.desc}`);
    console.log(`         证据: ${r.evidence}`);
  }
  console.log("");
}

const total = results.length;
console.log("──────────────────────────────────────────────────────────");
console.log(`总计 ${total} 条断言 · 通过 ${total - failCount} · 失败 ${failCount}`);
console.log("──────────────────────────────────────────────────────────\n");

process.exit(failCount === 0 ? 0 : 1);
