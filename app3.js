/**
 * 星河契约 · 星历页逻辑（app3.js）
 *
 * 职责：把「坚持」这件事讲成一段星途——
 *   里程碑贺词 → 星途总览 → 星轨攀升 → 月度星历 → 全年星点 → 星光起伏
 *   → 星座亮度 → 里程碑徽章 → 周期分布。
 * 本页【只读】业务数据，唯一的写操作是把「星点来源筛选」存进偏好（与仪表盘共享口径）。
 *
 * 依赖（加载顺序 store.js → components.js → app3.js）：
 *   store.js      loadPlans / loadPrefs / savePrefs / globalStreak / buildActivityMap /
 *                 buildHeatmap / buildMonthGrid / dailyTrend / completionRate /
 *                 computeStreak / milestones / milestoneCheer / describePlan / themeOf /
 *                 escapeHtml / loadReminderLog / reminderStatus / FREQ_LABELS /
 *                 PLAN_KEY / CHECKIN_KEY / PREFS_KEY
 *   components.js uiNav / uiStarfield / uiCheer / uiStarTrack / uiMonthGrid /
 *                 uiStarHeatmap / uiSparkline / uiBrightBars / uiBadgeGrid /
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

const cheerSlot = $("cheer-slot");

const statStreak = $("stat-streak");
const statBest = $("stat-best");
const statDays = $("stat-days");
const statTotal = $("stat-total");

const trackSlot = $("track-slot");

const monthPrevBtn = $("month-prev");
const monthTodayBtn = $("month-today");
const monthNextBtn = $("month-next");
const monthSlot = $("month-slot");

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
/** 星点图数据来源：'all' | 'auto' | 'manual' */
let hmSource = prefs.heatmapSource;
/** 趋势图回溯天数 */
let trendDays = 30;
/** 月度星历游标：{year, month(0~11)} */
let monthCursor = { year: new Date().getFullYear(), month: new Date().getMonth() };

/** 星轨最多同屏展示多少条，超出的在轴线说明里提示 */
const TRACK_LIMIT = 12;

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

/**
 * 把游标压回「当前月」。
 * @returns {void}
 */
function resetMonthCursor() {
  const now = new Date();
  monthCursor = { year: now.getFullYear(), month: now.getMonth() };
}

/**
 * 游标按月平移，自动处理跨年。
 * @param {number} delta 偏移月数，可负
 * @returns {void}
 */
function shiftMonthCursor(delta) {
  const step = Number(delta) || 0;
  const d = new Date(monthCursor.year, monthCursor.month + step, 1);
  monthCursor = { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * 判断游标是否已经停在当前月（用于禁用「下一月」与「回到本月」）。
 * @returns {boolean} 是否为本月
 */
function isCursorThisMonth() {
  const now = new Date();
  return monthCursor.year === now.getFullYear() && monthCursor.month === now.getMonth();
}

// ============================ 渲染：贺词 / 总览 ============================

/**
 * 渲染里程碑贺词横幅（已解锁给祝贺，未解锁给「还差几天」）。
 * @returns {void}
 */
function renderCheer() {
  if (!cheerSlot) return;
  cheerSlot.innerHTML = uiCheer(milestoneCheer());
}

/**
 * 渲染四宫格：当前连续 / 最佳连续 / 亮着的日子 / 累计触达次数。
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

// ============================ 渲染：星轨攀升 ============================

/**
 * 渲染竖向星轨：每个启用计划一条轨道，连续记录越久，星升得越高。
 * 停用计划不参与——它们已经熄灭，不该占据攀升的轨道。
 * @returns {void}
 */
function renderTracks() {
  if (!trackSlot) return;

  const plans = loadPlans().filter((p) => p.enabled !== false);
  if (plans.length === 0) {
    trackSlot.innerHTML = uiEmpty("还没有启用中的星，去星图缔结第一颗吧。", "🌠");
    return;
  }

  const rows = plans.map((plan) => {
    const streak = computeStreak(plan.id);
    return {
      id: plan.id,
      name: plan.name || "未命名",
      icon: plan.icon || "🌟",
      theme: themeOf(plan),
      current: streak.current,
      best: streak.best,
      unit: streak.unit,
    };
  });

  // 攀得高的排前面；同高时按名称稳定排序，避免每次刷新顺序乱跳
  rows.sort((a, b) => {
    if (b.current !== a.current) return b.current - a.current;
    if (b.best !== a.best) return b.best - a.best;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  const shown = rows.slice(0, TRACK_LIMIT);
  const hidden = rows.length - shown.length;

  trackSlot.innerHTML =
    uiStarTrack(shown, { cap: 21 }) +
    (hidden > 0
      ? `<p class="setting-note">另有 ${escapeHtml(String(hidden))} 条星轨未显示（按连续记录取前 ${TRACK_LIMIT} 条）。</p>`
      : "");
}

// ============================ 渲染：月度星历 ============================

/**
 * 渲染当前游标所在月的星历，并同步导航按钮的可用状态。
 * @returns {void}
 */
function renderMonth() {
  if (!monthSlot) return;

  const grid = buildMonthGrid(monthCursor.year, monthCursor.month, { source: hmSource });
  monthSlot.innerHTML = uiMonthGrid(grid, { title: grid.label });

  const atThisMonth = isCursorThisMonth();
  if (monthNextBtn) monthNextBtn.disabled = atThisMonth;
  if (monthTodayBtn) monthTodayBtn.disabled = atThisMonth;
}

// ============================ 渲染：全年星点 ============================

/**
 * 渲染全年（371 天 ≈ 53 周）星点图与统计小结。
 * @returns {void}
 */
function renderHeatmap() {
  const data = buildHeatmap(371, { source: hmSource });
  heatmapYear.innerHTML = uiStarHeatmap(data, {
    cell: 13,
    gap: 4,
    showMonths: true,
    showLegend: true,
  });
  heatmapSummary.textContent =
    `${data.startDate} ~ ${data.endDate} · 亮着 ${data.activeDays} 天 · ` +
    `累计 ${data.total} 次 · 单日最亮 ${data.max} 次`;
}

// ============================ 渲染：趋势 ============================

/**
 * 渲染近 trendDays 天的活跃趋势折线（星光起伏）。
 * @returns {void}
 */
function renderTrend() {
  trendChart.innerHTML = uiSparkline(dailyTrend(trendDays), {
    width: 720,
    height: 150,
    theme: "teal",
  });
}

// ============================ 渲染：星座亮度 ============================

/**
 * 渲染每个启用计划近 30 天完成率的亮度条。
 * 停用计划不参与统计，避免历史计划把整体亮度拖低。
 * @returns {void}
 */
function renderRates() {
  const plans = loadPlans().filter((p) => p.enabled !== false);

  if (plans.length === 0) {
    rateList.innerHTML = "";
    rateEmpty.innerHTML = uiEmpty("还没有启用中的星，去星图缔结一颗吧。", "✧");
    rateEmpty.hidden = false;
    return;
  }
  rateEmpty.innerHTML = "";
  rateEmpty.hidden = true;

  const rows = plans.map((plan) => {
    const rate = completionRate(plan.id, 30);
    return {
      id: plan.id,
      name: plan.name || "未命名",
      icon: plan.icon || "🌟",
      theme: themeOf(plan),
      rate: rate.rate,
      done: rate.done,
      expected: rate.expected,
    };
  });

  // 亮的排前面；同亮度按名称稳定排序
  rows.sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  rateList.innerHTML = uiBrightBars(rows);
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
    freqDistEl.innerHTML = uiEmpty("还没有任何星。", "🧭");
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
        : "⚠️ 本地预览模式：读不到提醒记录，星历仅基于手动点亮";
    chipWrap.hidden = false;
    return;
  }
  if (st.size === 0) {
    offlineChip.textContent = "🌱 还没有提醒送达记录，等第一次钉钉提醒后这片天区就会亮起来";
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
  renderCheer();
  renderOverview();
  renderTracks();
  renderMonth();
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
  // 记进偏好，仪表盘的迷你星点图下次也用同一口径
  prefs = savePrefs({ heatmapSource: hmSource });
  renderHeatmap();
  renderMonth();
});

trendRangeSelect.addEventListener("change", () => {
  const value = Number(trendRangeSelect.value);
  trendDays = Number.isFinite(value) && value > 0 ? value : 30;
  renderTrend();
});

if (monthPrevBtn) {
  monthPrevBtn.addEventListener("click", () => {
    shiftMonthCursor(-1);
    renderMonth();
  });
}

if (monthNextBtn) {
  monthNextBtn.addEventListener("click", () => {
    if (isCursorThisMonth()) return; // 不允许翻到未来
    shiftMonthCursor(1);
    renderMonth();
  });
}

if (monthTodayBtn) {
  monthTodayBtn.addEventListener("click", () => {
    resetMonthCursor();
    renderMonth();
  });
}

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
  resetMonthCursor();

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
