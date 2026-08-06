/**
 * 星河自律 · 统计页逻辑（app3.js）
 *
 * 职责：把「坚持」这件事可视化——全年星图、活跃趋势、各计划完成率、里程碑、频率分布。
 * 本页【只读】，不写任何业务数据（唯一的写操作是把星图来源筛选存进偏好）。
 *
 * 依赖（加载顺序 store.js → components.js → app3.js）：
 *   store.js      loadPlans / loadPrefs / savePrefs / globalStreak / buildActivityMap /
 *                 buildHeatmap / dailyTrend / completionRate / computeStreak / milestones /
 *                 describePlan / themeOf / escapeHtml / loadReminderLog / reminderStatus /
 *                 FREQ_LABELS
 *   components.js uiNav / uiStarfield / uiRing / uiHeatmap / uiSparkline / uiBadgeGrid /
 *                 uiEmpty / uiCountUp / uiTooltip / uiRevealOnLoad
 *
 * ⚠️ `const $` 只在页面脚本里声明；store.js / components.js 内绝不出现。
 */

// ---- DOM 引用（与 stats.html 的 id 一一对应）----
const $ = (id) => document.getElementById(id);
const appRoot = $("app-root");
const navSlot = $("nav-slot");
const chipWrap = $("chip-wrap");
const offlineChip = $("offline-chip");

const statStreak = $("stat-streak");
const statBest = $("stat-best");
const statDays = $("stat-days");
const statTotal = $("stat-total");

const hmSourceSelect = $("hm-source");
const heatmapYear = $("heatmap-year");
const heatmapSummary = $("heatmap-summary");

const trendRangeSelect = $("trend-range");
const trendChart = $("trend-chart");

const rateList = $("rate-list");
const rateEmpty = $("rate-empty");
const badgeGrid = $("badge-grid");
const freqDistEl = $("freq-dist");
const freqLegendEl = $("freq-legend");

/** UI 偏好快照 */
let prefs = loadPrefs();
/** 星图数据来源：'all' | 'auto' | 'manual' */
let hmSource = prefs.heatmapSource;
/** 趋势图回溯天数 */
let trendDays = 30;

/** 频率 → 主题色的固定映射，保证进度条与图例颜色一致 */
const FREQ_THEME = [
  { key: "daily", theme: "gold" },
  { key: "weekly", theme: "teal" },
  { key: "monthly", theme: "violet" },
];

// ============================ 基础设置 ============================

/**
 * 应用「减少动效」偏好：挂 / 摘 <html class="no-motion">。
 * @returns {void}
 */
function applyMotionPref() {
  document.documentElement.classList.toggle("no-motion", prefs.reduceMotion === true);
}

// ============================ 渲染：总览 ============================

/**
 * 渲染四宫格：当前连续 / 最佳连续 / 有记录天数 / 累计触达次数。
 * @returns {void}
 */
function renderOverview() {
  const streak = globalStreak();
  const activity = buildActivityMap();
  let total = 0;
  activity.forEach((cell) => {
    total += cell.count;
  });

  uiCountUp(statStreak, streak.current, { suffix: " 天" });
  uiCountUp(statBest, streak.best, { suffix: " 天" });
  uiCountUp(statDays, activity.size, { suffix: " 天" });
  uiCountUp(statTotal, total, { suffix: " 次" });
}

// ============================ 渲染：星图 ============================

/**
 * 渲染全年（371 天 ≈ 53 周）星图与统计小结。
 * @returns {void}
 */
function renderHeatmap() {
  const data = buildHeatmap(371, { source: hmSource });
  heatmapYear.innerHTML = uiHeatmap(data, {
    cell: 12,
    gap: 3,
    showMonths: true,
    showLegend: true,
  });
  heatmapSummary.textContent =
    `${data.startDate} ~ ${data.endDate} · 活跃 ${data.activeDays} 天 · ` +
    `累计 ${data.total} 次 · 单日最高 ${data.max} 次`;
}

// ============================ 渲染：趋势 ============================

/**
 * 渲染近 trendDays 天的活跃趋势折线。
 * @returns {void}
 */
function renderTrend() {
  trendChart.innerHTML = uiSparkline(dailyTrend(trendDays), {
    width: 720,
    height: 150,
    theme: "teal",
  });
}

// ============================ 渲染：完成率 ============================

/**
 * 渲染每个启用计划的近 30 天完成率（进度环 + 进度条 + 连续记录）。
 * 停用的计划不参与统计，避免历史计划把整体数据拖低。
 * @returns {void}
 */
function renderRates() {
  const plans = loadPlans().filter((p) => p.enabled !== false);

  if (plans.length === 0) {
    rateList.innerHTML = "";
    rateEmpty.innerHTML = uiEmpty("还没有启用中的计划，去管理页添加一个吧。", "🛠");
    rateEmpty.hidden = false;
    return;
  }
  rateEmpty.innerHTML = "";
  rateEmpty.hidden = true;

  rateList.innerHTML = plans
    .map((plan) => {
      const theme = themeOf(plan);
      const rate = completionRate(plan.id, 30);
      const streak = computeStreak(plan.id);
      const pct = Math.round(rate.rate * 100);
      const missedText = rate.missed > 0 ? ` · 缺 ${rate.missed}` : "";

      return (
        `<div class="rate-item theme-${escapeHtml(theme.key)}">` +
        uiRing({
          percent: rate.rate,
          size: 68,
          stroke: 7,
          theme: theme.key,
          label: `${pct}%`,
        }) +
        `<div class="rate-body">` +
        `<p class="rate-name">${escapeHtml(plan.icon || "🌟")} ` +
        `${escapeHtml(plan.name || "未命名")}</p>` +
        `<p class="plan-meta">${escapeHtml(describePlan(plan))} · 🔥 连续 ` +
        `${streak.current} ${escapeHtml(streak.unit)}（最佳 ${streak.best}）</p>` +
        `<div class="rate-bar" data-tip="近 30 天完成率 ${pct}%">` +
        `<span class="rate-bar-fill" style="width:${pct}%"></span></div>` +
        `<p class="plan-meta">已完成 ${rate.done} / 应完成 ${rate.expected}${escapeHtml(
          missedText
        )}</p>` +
        `</div></div>`
      );
    })
    .join("");

  // 进度环是新注入的，需要再激活一次才会填充
  uiRevealOnLoad(rateList);
}

// ============================ 渲染：徽章 / 频率分布 ============================

/**
 * 渲染里程碑徽章网格。
 * @returns {void}
 */
function renderBadges() {
  badgeGrid.innerHTML = uiBadgeGrid(milestones());
}

/**
 * 渲染计划频率分布条与图例。
 * @returns {void}
 */
function renderFreqDist() {
  const plans = loadPlans();
  const counts = { daily: 0, weekly: 0, monthly: 0 };
  plans.forEach((p) => {
    const key = Object.prototype.hasOwnProperty.call(counts, p.freq) ? p.freq : "daily";
    counts[key] += 1;
  });

  const total = plans.length;
  if (total === 0) {
    freqDistEl.innerHTML = uiEmpty("还没有任何计划。", "🧭");
    freqLegendEl.innerHTML = "";
    return;
  }

  freqDistEl.innerHTML =
    `<div class="freq-dist">` +
    FREQ_THEME.filter((o) => counts[o.key] > 0)
      .map((o) => {
        const pct = (counts[o.key] / total) * 100;
        const tip = `${FREQ_LABELS[o.key]} ${counts[o.key]} 个（${Math.round(pct)}%）`;
        return (
          `<span class="freq-seg theme-${escapeHtml(o.theme)}" ` +
          `style="width:${pct.toFixed(2)}%" data-tip="${escapeHtml(tip)}">` +
          `${counts[o.key]}</span>`
        );
      })
      .join("") +
    `</div>`;

  freqLegendEl.innerHTML = FREQ_THEME.map(
    (o) =>
      `<span class="theme-${escapeHtml(o.theme)}">` +
      `${escapeHtml(FREQ_LABELS[o.key])} ${counts[o.key]} 个</span>`
  ).join("");
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
        : "⚠️ 本地预览模式：读不到提醒记录，统计仅基于手动确认";
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
 * 整页重绘。
 * @returns {void}
 */
function renderAll() {
  renderOverview();
  renderHeatmap();
  renderTrend();
  renderRates();
  renderBadges();
  renderFreqDist();
  renderOfflineChip();
}

// ============================ 事件绑定 ============================

hmSourceSelect.addEventListener("change", () => {
  hmSource = hmSourceSelect.value;
  // 记进偏好，仪表盘的迷你星图下次也用同一口径
  prefs = savePrefs({ heatmapSource: hmSource });
  renderHeatmap();
});

trendRangeSelect.addEventListener("change", () => {
  const value = Number(trendRangeSelect.value);
  trendDays = Number.isFinite(value) && value > 0 ? value : 30;
  renderTrend();
});

// 其它标签页改了数据就同步刷新
window.addEventListener("storage", (e) => {
  if (!e.key) return;
  if ([PLAN_KEY, CHECKIN_KEY, PREFS_KEY].indexOf(e.key) < 0) return;
  prefs = loadPrefs();
  hmSource = prefs.heatmapSource;
  hmSourceSelect.value = hmSource;
  applyMotionPref();
  renderAll();
});

// ============================ 初始化 ============================
(function init() {
  prefs = loadPrefs();
  hmSource = prefs.heatmapSource;
  applyMotionPref();

  uiStarfield(document.body);
  navSlot.innerHTML = uiNav("stats");

  hmSourceSelect.value = hmSource;
  trendRangeSelect.value = String(trendDays);

  renderAll();

  uiTooltip(document.body);
  uiRevealOnLoad(appRoot);

  loadReminderLog()
    .then(() => {
      renderAll();
    })
    .catch((err) => {
      console.error("提醒记录加载异常：", err);
      renderOfflineChip();
    });
})();
