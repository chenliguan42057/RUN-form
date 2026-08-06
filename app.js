/**
 * 星河自律 · 仪表盘逻辑（app.js）
 *
 * 职责：一屏回答三个问题——「接下来要做什么」「今天完成得怎么样」「最近坚持得如何」。
 * 计划维护在管理页（manage.html + app2.js），深度统计在统计页（stats.html + app3.js）。
 *
 * 依赖（加载顺序 store.js → components.js → app.js）：
 *   store.js      loadPlans / loadCheckins / addCheckin / loadPrefs / todayPlans /
 *                 overviewStats / buildHeatmap / nextReminder / describePlan / themeOf /
 *                 greetingNow / randomQuote / formatCountdown / dateKey / pyWeekday /
 *                 loadReminderLog / reminderStatus / scheduleAutoSync / showToast /
 *                 WEEKDAY_LABELS
 *   components.js uiNav / uiStarfield / uiRing / uiHeatmap / uiTimelineItem / uiEmpty /
 *                 uiCountUp / uiTooltip / uiRevealOnLoad
 *
 * ⚠️ `const $` 只在页面脚本里声明；store.js / components.js 内绝不出现。
 */

// ---- DOM 引用（与 index.html 的 id 一一对应）----
const $ = (id) => document.getElementById(id);
const appRoot = $("app-root");
const navSlot = $("nav-slot");
const greetingEl = $("greeting");
const todayDateEl = $("today-date");
const dailyQuoteEl = $("daily-quote");
const chipWrap = $("chip-wrap");
const offlineChip = $("offline-chip");

const nextCard = $("next-card");
const nextRing = $("next-ring");
const nextBody = $("next-body");
const nextIcon = $("next-icon");
const nextName = $("next-name");
const nextDesc = $("next-desc");
const nextMeta = $("next-meta");
const nextCountdown = $("next-countdown");
const nextEmpty = $("next-empty");
const manualCheckBtn = $("manual-check-btn");

const statActive = $("stat-active");
const statToday = $("stat-today");
const statStreak = $("stat-streak");
const statRate = $("stat-rate");

const timelineEl = $("timeline");
const timelineEmpty = $("timeline-empty");
const miniHeatmap = $("mini-heatmap");

/** 当前 UI 偏好快照，init 时读一次，管理页改动下次进页面生效 */
let prefs = loadPrefs();
/** 主卡当前聚焦的计划 id，「标记完成」按钮据此打卡 */
let focusPlanId = null;
/** 上一次渲染时的日期键，用于检测跨天 */
let lastDayKey = dateKey();
/** 心跳计数，每 10 次（5 分钟）做一次整页重算 */
let tickCount = 0;

// ============================ 基础设置 ============================

/**
 * 应用「减少动效」偏好：挂 / 摘 <html class="no-motion">。
 * 必须在任何 ui* 渲染之前调用，否则 uiMotionOff() 读到的是旧状态。
 * @returns {void}
 */
function applyMotionPref() {
  document.documentElement.classList.toggle("no-motion", prefs.reduceMotion === true);
}

// ============================ 渲染：页头 ============================

/**
 * 渲染时段问候、今天的日期、当日恒定的梵高语录。
 * 语录用 dateKey() 作 seed，同一天刷新多少次都一样，避免闪烁感。
 * @returns {void}
 */
function renderHeader() {
  const now = new Date();
  const g = greetingNow(now);
  greetingEl.textContent = `${g.emoji} ${g.text}`;
  todayDateEl.textContent =
    `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ` +
    `${WEEKDAY_LABELS[pyWeekday(now)]}`;
  dailyQuoteEl.textContent = `「${randomQuote(dateKey(now))}」`;
}

// ============================ 渲染：主卡 ============================

/**
 * 挑出主卡要展示的「下一件事」。
 * 优先级：今天最近的未完成计划 > 今天已过点但未确认的计划 > 全站下一次提醒。
 * @returns {{plan:Object, theme:Object, dueTs:number, overdue:boolean, whenText:string}|null}
 */
function pickFocus() {
  const today = todayPlans();
  const pending = today.filter((v) => !v.done);

  if (pending.length > 0) {
    const upcoming = pending.filter((v) => !v.passed);
    // todayPlans() 已按 dueTs 升序，取第一个即最近的一个
    const target = upcoming.length > 0 ? upcoming[0] : pending[0];
    return {
      plan: target,
      theme: target.theme,
      dueTs: target.dueTs,
      overdue: target.passed === true,
      whenText: `今天 ${target.dueTime}`,
    };
  }

  const stats = overviewStats();
  if (stats.nextUp) {
    return {
      plan: stats.nextUp.plan,
      theme: themeOf(stats.nextUp.plan),
      dueTs: stats.nextUp.info.ts,
      overdue: false,
      whenText: stats.nextUp.info.human,
    };
  }
  return null;
}

/**
 * 刷新倒计时文案（心跳每 30 秒调一次，不重排 DOM）。
 * @returns {void}
 */
function updateCountdown() {
  const focus = pickFocus();
  if (!focus) {
    nextCountdown.textContent = "—";
    return;
  }
  const diff = focus.dueTs - Date.now();
  nextCountdown.textContent =
    focus.overdue || diff <= 0
      ? "⌛ 已过提醒时间 · 待确认"
      : `⏳ 还有 ${formatCountdown(diff)}`;
}

/**
 * 渲染主卡：进度环（今日完成度）+ 聚焦计划信息 + 倒计时 + 操作按钮。
 * @returns {void}
 */
function renderNextUp() {
  const focus = pickFocus();
  const today = todayPlans();
  const doneCount = today.filter((v) => v.done).length;
  const percent = today.length > 0 ? doneCount / today.length : 0;

  if (!focus) {
    focusPlanId = null;
    nextCard.className = "card next-card theme-gold";
    nextRing.hidden = true;
    nextBody.hidden = true;
    nextEmpty.hidden = false;
    manualCheckBtn.hidden = true;
    nextCountdown.textContent = "—";
    return;
  }

  focusPlanId = focus.plan.id || null;
  nextRing.hidden = false;
  nextBody.hidden = false;
  nextEmpty.hidden = true;

  // 整张卡跟随计划配色：theme-<key> 会覆写 --t-from / --t-to / --t-glow
  nextCard.className = `card next-card theme-${focus.theme.key}`;

  nextRing.innerHTML = uiRing({
    percent,
    size: 132,
    stroke: 11,
    theme: focus.theme.key,
    label: today.length > 0 ? `${doneCount}/${today.length}` : "—",
    sub: "今日进度",
  });
  // 重新注入后要再激活一次，否则动效模式下环会停在空态
  uiRevealOnLoad(nextRing);

  nextIcon.textContent = focus.plan.icon || "🌟";
  nextName.textContent = focus.plan.name || "未命名";

  const desc = String(focus.plan.desc || "").trim();
  nextDesc.textContent = desc;
  nextDesc.hidden = desc === "";

  nextMeta.textContent = `${describePlan(focus.plan)} · ${focus.whenText}`;

  manualCheckBtn.hidden = prefs.showManualCheckin === false;
  manualCheckBtn.setAttribute(
    "data-tip",
    `把「${focus.plan.name || "未命名"}」记为今天已完成`
  );

  updateCountdown();
}

// ============================ 渲染：概览 / 时间轴 / 星图 ============================

/**
 * 渲染四宫格关键指标（带数字滚动，动效关闭时直接落终值）。
 * @returns {void}
 */
function renderOverview() {
  const stats = overviewStats();
  uiCountUp(statActive, stats.planActive);
  uiCountUp(statToday, stats.todayDone, { suffix: `/${stats.todayDue}` });
  uiCountUp(statStreak, stats.streak, { suffix: " 天" });
  uiCountUp(statRate, Math.round(stats.rate30 * 100), { suffix: "%" });
}

/**
 * 渲染今日时间轴，并给第一个「未完成且未过点」的项打上 is-now（脉冲高亮）。
 * @returns {void}
 */
function renderTimeline() {
  const list = todayPlans();

  if (list.length === 0) {
    timelineEl.innerHTML = "";
    timelineEmpty.innerHTML = uiEmpty("今天没有需要触发的计划，好好休息。", "🌙");
    timelineEmpty.hidden = false;
    return;
  }

  timelineEmpty.innerHTML = "";
  timelineEmpty.hidden = true;

  let marked = false;
  timelineEl.innerHTML = list
    .map((v) => {
      const isNow = !marked && !v.passed && !v.done;
      if (isNow) marked = true;
      return uiTimelineItem(Object.assign({}, v, { isNow }));
    })
    .join("");
}

/**
 * 渲染近 12 周（84 天）迷你星图。
 * @returns {void}
 */
function renderMiniHeatmap() {
  const data = buildHeatmap(84, { source: prefs.heatmapSource });
  miniHeatmap.innerHTML = uiHeatmap(data, {
    cell: 13,
    gap: 4,
    showMonths: true,
    showLegend: true,
  });
}

/**
 * 渲染提醒数据的降级提示胶囊。
 * @returns {void}
 */
function renderOfflineChip() {
  const st = reminderStatus();

  if (!st.loaded) {
    chipWrap.hidden = true;
    return;
  }
  if (st.fromCache) {
    offlineChip.textContent =
      st.size > 0
        ? "⚠️ 提醒记录来自本地缓存（暂时读不到 data/reminder-state.json）"
        : "⚠️ 本地预览模式：读不到提醒记录，星图仅显示手动确认";
    chipWrap.hidden = false;
    return;
  }
  if (st.size === 0) {
    offlineChip.textContent = "🌱 还没有提醒送达记录，等第一次钉钉提醒后星图就会亮起来";
    chipWrap.hidden = false;
    return;
  }
  chipWrap.hidden = true;
}

/**
 * 整页重算并重绘（不含页头，页头只在跨天时更新）。
 * @returns {void}
 */
function renderAll() {
  renderNextUp();
  renderOverview();
  renderTimeline();
  renderMiniHeatmap();
  renderOfflineChip();
}

// ============================ 心跳 ============================

/**
 * 启动 30 秒心跳：刷新倒计时、跨天重绘、每 5 分钟整页重算。
 * @returns {void}
 */
function startClock() {
  setInterval(() => {
    tickCount += 1;

    const key = dateKey();
    if (key !== lastDayKey) {
      // 跨零点：日期 / 问候 / 今日列表全部作废，整体重来
      lastDayKey = key;
      renderHeader();
      renderAll();
      return;
    }

    updateCountdown();
    if (tickCount % 10 === 0) renderAll();
  }, 30000);
}

// ============================ 事件绑定 ============================

manualCheckBtn.addEventListener("click", () => {
  if (!focusPlanId) {
    showToast("当前没有可标记的计划", "error");
    return;
  }
  const plan = loadPlans().find((p) => p.id === focusPlanId);
  if (!plan) {
    showToast("该计划已不存在，请刷新页面", "error");
    renderAll();
    return;
  }
  addCheckin(plan.id, plan.name);
  showToast(`已标记完成：${plan.name}`, "success");
  renderAll();
  scheduleAutoSync();
});

// 从别的标签页改了数据（打卡 / 计划 / 偏好）时，本页跟着刷新
window.addEventListener("storage", (e) => {
  if (!e.key) return;
  if ([PLAN_KEY, CHECKIN_KEY, PREFS_KEY].indexOf(e.key) < 0) return;
  prefs = loadPrefs();
  applyMotionPref();
  renderAll();
});

// ============================ 初始化 ============================
(function init() {
  prefs = loadPrefs();
  applyMotionPref();

  uiStarfield(document.body);
  navSlot.innerHTML = uiNav("home");

  renderHeader();
  renderAll();

  uiTooltip(document.body);
  uiRevealOnLoad(appRoot);
  startClock();

  // 异步拉取提醒送达记录，回来后再刷一次（失败会静默降级读缓存）
  loadReminderLog()
    .then(() => {
      renderAll();
    })
    .catch((err) => {
      console.error("提醒记录加载异常：", err);
      renderOfflineChip();
    });
})();
