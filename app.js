/**
 * 星河契约 · 天文台逻辑（app.js，v4）
 *
 * 职责：一屏回答三个问题——「下一颗要点亮的是哪颗星」「今夜亮了几颗」「最近这片天区如何」。
 * 星图维护在星图页（manage.html + app2.js），深度统计在星历页（stats.html + app3.js）。
 *
 * v4 的观感变化（数据口径完全不变）：
 *   · 时段旁白 skyPoem() 取代干巴巴的副标题；
 *   · 四个指标改成天文语汇：已缔结星数 / 今夜待点亮 / 彗尾（连续）/ 月相（完成率）；
 *   · 今日时间轴 → 「今晚的星轨」，到点未完成的星会脉冲；
 *   · 热力图 → 星点图；梵高语录 → 「星语」。
 *
 * 依赖（加载顺序 store.js → components.js → app.js）：
 *   store.js      loadPlans / loadCheckins / addCheckin / loadPrefs / todayPlans /
 *                 overviewStats / buildHeatmap / nextReminder / describePlan / themeOf /
 *                 greetingNow / skyPoem / randomQuote / formatCountdown / dateKey /
 *                 pyWeekday / loadReminderLog / reminderStatus / scheduleAutoSync /
 *                 showToast / WEEKDAY_LABELS /
 *                 loadMindsetQuotes / dailyMindsetQuote（每日心法，见 data/quotes.json）
 *   components.js uiNav / uiStarfield / uiRing / uiStarHeatmap / uiTimelineStar / uiEmpty /
 *                 uiCountUp / uiComet / uiMoonPhase / uiMoonName / uiSkyQuote /
 *                 uiTooltip / uiRevealOnLoad
 *
 * ⚠️ `const $` 只在页面脚本里声明；store.js / components.js 内绝不出现。
 */

// ---- DOM 引用（与 index.html 的 id 一一对应）----
const $ = (id) => document.getElementById(id);
const appRoot = $("app-root");
const navSlot = $("nav-slot");
const greetingEl = $("greeting");
const todayDateEl = $("today-date");
const skyPoemEl = $("sky-poem");
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
const tileToday = $("tile-today");
const cometSlot = $("comet-slot");
const moonSlot = $("moon-slot");
const moonNameEl = $("moon-name");

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
 * 渲染时段问候、时段旁白、今天的日期，以及当日恒定的「星语」。
 * 「星语」分两步：先用梵高语录同步兜底（避免加载期空白），
 * 再异步取 data/quotes.json 大库里的「当日心法」覆盖。
 * 两步都按日期确定性取句，同一天刷新多少次都一样，避免闪烁感。
 * @returns {void}
 */
function renderHeader() {
  const now = new Date();
  const g = greetingNow(now);
  greetingEl.textContent = `${g.emoji} ${g.text}`;
  todayDateEl.textContent =
    `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ` +
    `${WEEKDAY_LABELS[pyWeekday(now)]}`;
  if (skyPoemEl) skyPoemEl.textContent = skyPoem(now);
  if (dailyQuoteEl) {
    // 先给一句兜底，避免加载期间空白
    dailyQuoteEl.innerHTML = uiSkyQuote(randomQuote(dateKey(now)), { from: "梵高" });
    // 再异步加载大语录库，用「当日心法」覆盖（与钉钉 9:10 推送同源同句）
    loadMindsetQuotes()
      .then((quotes) => {
        const q = dailyMindsetQuote(dateKey(new Date()), quotes);
        if (!q) return;
        // ⚠️ 离线 / 404 时 loadMindsetQuotes() 会回落到梵高语录，
        //    但返回值类型和成功时一样，光看 q 分不出来。
        //    这里必须查 mindsetQuotesReady()，否则会把梵高的话署成「RUN-form 心法」。
        dailyQuoteEl.innerHTML = uiSkyQuote(q, {
          from: mindsetQuotesReady() ? "RUN-form 心法" : "梵高",
        });
      })
      .catch(() => {});
  }
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
 * ←/→ 键位：在今日计划里按偏移切换「当前聚焦计划」。
 * offset -1 = 上一颗，+1 = 下一颗；首尾相接成环。
 * @param {number} offset
 * @returns {boolean} 是否切换成功
 */
function moveFocusPlan(offset) {
  const list = todayPlans();
  if (!list.length) return false;
  let idx = focusPlanId ? list.findIndex((p) => p.id === focusPlanId) : -1;
  if (idx < 0) {
    const firstPending = list.findIndex((p) => !p.done);
    idx = firstPending < 0 ? 0 : firstPending;
  } else {
    idx = (idx + (offset || 0) + list.length) % list.length;
  }
  focusPlanId = list[idx] ? list[idx].id || null : null;
  renderNextUp();
  return true;
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
  const today = todayPlans();
  const doneCount = today.filter((v) => v.done).length;
  const percent = today.length > 0 ? doneCount / today.length : 0;

  let focus = pickFocus();
  // ←/→ 手动选中的计划优先（仍在今日列表内才生效，否则回落自动聚焦）
  if (focusPlanId) {
    const ov = today.find((p) => p.id === focusPlanId);
    if (ov) {
      focus = {
        plan: ov,
        theme: ov.theme,
        dueTs: ov.dueTs,
        overdue: ov.passed === true,
        whenText: `今天 ${ov.dueTime}`,
      };
    }
  }

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
    `把「${focus.plan.name || "未命名"}」记为今天已点亮`
  );

  updateCountdown();
}

// ============================ 渲染：概览 / 时间轴 / 星图 ============================

/**
 * 渲染四个天象指标：
 *   已缔结星数 / 今夜待点亮 / 连续天数（彗尾）/ 近 30 天完成率（月相）。
 * 数字带滚动动画，动效关闭时直接落终值；彗尾与月相是纯 SVG，随数据重绘。
 * @returns {void}
 */
function renderOverview() {
  const stats = overviewStats();
  const pending = Math.max(stats.todayDue - stats.todayDone, 0);

  uiCountUp(statActive, stats.planActive);
  uiCountUp(statToday, pending);
  uiCountUp(statStreak, stats.streak, { suffix: " 天" });
  uiCountUp(statRate, Math.round(stats.rate30 * 100), { suffix: "%" });

  if (tileToday) {
    tileToday.setAttribute(
      "data-tip",
      stats.todayDue > 0
        ? `今夜共 ${stats.todayDue} 颗待亮，已点亮 ${stats.todayDone} 颗`
        : "今夜没有需要点亮的星"
    );
  }

  // 彗尾：连续越久，尾巴拖得越长
  if (cometSlot) {
    cometSlot.innerHTML = uiComet(stats.streak, { width: 128, height: 40 });
  }

  // 月相：0% 新月，100% 满月。图形只画盘面，百分比由 #stat-rate 显示
  if (moonSlot) {
    moonSlot.innerHTML = uiMoonPhase(stats.rate30, { size: 64, label: "", sub: "" });
  }
  if (moonNameEl) {
    moonNameEl.textContent = `近 30 天 · ${uiMoonName(stats.rate30)}`;
  }
}

/**
 * 渲染「今晚的星轨」，并给第一个「未完成且未过点」的项打上 is-now（脉冲高亮）。
 * @returns {void}
 */
function renderTimeline() {
  const list = todayPlans();

  if (list.length === 0) {
    timelineEl.innerHTML = "";
    timelineEmpty.innerHTML = uiEmpty("今晚没有星要亮起，安心休息。", "🌙");
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
      return uiTimelineStar(Object.assign({}, v, { isNow }));
    })
    .join("");
}

/**
 * 渲染近 12 周（84 天）迷你星点图。
 * @returns {void}
 */
function renderMiniHeatmap() {
  const data = buildHeatmap(84, { source: prefs.heatmapSource });
  miniHeatmap.innerHTML = uiStarHeatmap(data, {
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
        : "⚠️ 本地预览模式：读不到提醒记录，星点图仅显示手动点亮";
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
 * 整页重算并重绘（不含页头，页头只在跨天时更新）。
 * @returns {void}
 */
function renderAll() {
  renderNextUp();
  renderOverview();
  renderTimeline();
  renderMiniHeatmap();
  renderOfflineChip();
  renderRank();
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

/* =====================================================================
   v6.1 · 备忘录站内提示
   首页加载时检测「已到期且未完成」的备忘，用 toast 弹一次。
   去重键 memoId|YYYY-MM-DD 存 localStorage，当天不重复弹；
   跨天会自动换键，第二天打开仍会提醒，直到用户在星图页标记完成 / 删除。
   ===================================================================== */

/**
 * 检测到期备忘并弹站内提示（幂等：同一条备忘同一天只弹一次）。
 * @returns {void}
 */
function checkDueMemos() {
  if (typeof loadMemos !== "function") return;
  let due;
  try {
    due = dueMemos();
  } catch (e) {
    console.error("到期备忘检测异常：", e);
    return;
  }
  if (!due || due.length === 0) return;

  // 只挑今天还没提示过的；多条备忘合并成一条提示，避免 toast 互相覆盖
  const fresh = due.filter((memo) => memo && memo.id && !isMemoNotified(memo.id));
  if (fresh.length === 0) return;

  if (fresh.length === 1) {
    const m = fresh[0];
    showToast(`⏰ 备忘：${m.title}（${m.due || "未设到期"}）`, "info");
  } else {
    const names = fresh
      .slice(0, 3)
      .map((m) => m.title)
      .join("、");
    const extra = fresh.length > 3 ? ` 等 ${fresh.length} 条` : "";
    showToast(`⏰ 备忘到点：${names}${extra}`, "info");
  }
  fresh.forEach((memo) => markMemoNotified(memo.id));
}

/* =====================================================================
   v6 · 星河契约装配层
   这一段只做「接线」：状态与副作用全在各模块内部，app.js 不重复实现逻辑。
   两条硬约束：
     1) renderHeader() 里那两个逻辑块一个字节都没动，段位走独立的 #rank-slot；
     2) 首页同步加载的新增脚本只有 5 个核心模块（≈43KB，卡在 45KB 预算内），
        onboarding / focus / shortcuts / ambient 全部 loadModule() 按需注入——
        老用户不会为一段只看一次的引导动画付流量。
   ===================================================================== */

/** 已注入过的按需脚本：文件名 → Promise，避免重复插 <script> */
const moduleCache = {};

/**
 * 按需注入同目录脚本。
 * 失败只 resolve(false) 而不 reject——任何 v6 增强都不许拖垮主页面。
 * @param {string} name 文件名，如 "focus.js"
 * @returns {Promise<boolean>}
 */
function loadModule(name) {
  if (moduleCache[name]) return moduleCache[name];
  const task = new Promise((resolve) => {
    const el = document.createElement("script");
    el.src = name;
    el.async = true;
    el.addEventListener("load", () => resolve(true));
    el.addEventListener("error", () => {
      console.error("按需模块加载失败：", name);
      // 弱网 / SW 未命中时静默失败会让用户「按了没反应」，仅当次会话提示一次
      if (!loadModule._warned) {
        loadModule._warned = true;
        try {
          if (typeof showToast === "function") {
            showToast("有个小模块没加载上，功能暂不可用，刷新或联网后重试 ✦", "warning");
          }
        } catch (e) {
          /* 忽略：提示本身失败不能阻断 */
        }
      }
      resolve(false);
    });
    document.body.appendChild(el);
  });
  moduleCache[name] = task;
  return task;
}

// ---------------------------- C1 段位徽章 ----------------------------

/**
 * 渲染页头段位徽章。rank.js 没加载或算不出来时整块留空，页头照常。
 * @returns {void}
 */
function renderRank() {
  const slot = $("rank-slot");
  if (!slot) return;
  if (!window.Rank || typeof uiRankBadge !== "function") {
    slot.hidden = true;
    return;
  }
  let html = "";
  try {
    html = uiRankBadge(window.Rank.getRank());
  } catch (err) {
    console.error("段位渲染异常：", err);
    html = "";
  }
  slot.innerHTML = html;
  slot.hidden = html === "";
}

// ---------------------------- B1 打卡仪式 ----------------------------

/**
 * 打卡之后的全部仪式。顺序是刻意排的：
 * 先给即时反馈（星屑 / 声音），再问一句情绪，庆典压到最后——
 * 三层动效同时出会糊成一团，看着像卡了。
 * @param {Element} el 触发按钮，星屑从它的中心炸开
 * @param {Object|null} item addCheckin() 返回的记录
 * @param {Object|null} rankBefore 打卡前的段位快照
 * @returns {void}
 */
function afterCheckin(el, item, rankBefore) {
  const id = item && item.id ? item.id : null;

  try {
    if (window.Celebrate) window.Celebrate.onCheckin(el, id);
  } catch (err) {
    console.error("打卡仪式异常：", err);
  }

  if (id) askMood(id);

  // 升段 / 里程碑都要等 checkin 落盘后再算，否则算的是打卡前的旧数
  window.setTimeout(() => {
    try {
      if (rankBefore && window.Rank && window.Celebrate) {
        const now = window.Rank.getRank();
        if (now.key !== rankBefore.key) {
          window.Celebrate.celebrateRankUp(rankBefore, now);
          renderRank();
          // 升段横幅已经占了屏，里程碑让给下一次，不叠着放
          return;
        }
      }
      if (window.Celebrate) {
        const days = window.Celebrate.pendingMilestone();
        if (days) window.Celebrate.celebrateMilestone(days);
      }
    } catch (err) {
      console.error("庆典判定异常：", err);
    }
  }, 900);
}

// ---------------------------- C3 情绪速记 ----------------------------

/** 正在等情绪的 checkin id；为空表示情绪卡该收起来 */
let moodTarget = null;

/**
 * 收起情绪卡。
 * @returns {void}
 */
function closeMood() {
  moodTarget = null;
  const card = $("mood-card");
  if (card) card.hidden = true;
}

/**
 * 打卡后弹一次情绪速记（五档 + 一句话，可以完全不理）。
 * ⚠️ 情绪只写旁路表 runform_mood，checkin 仍是七字段——
 *    同步 payload 结构一个字节都不变。
 * @param {string} id 打卡记录 id
 * @returns {void}
 */
function askMood(id) {
  const card = $("mood-card");
  const slot = $("mood-slot");
  if (!card || !slot || !window.MoodStore || typeof uiMoodPicker !== "function") return;

  moodTarget = id;
  const cur = window.MoodStore.getMood(id);
  slot.innerHTML = uiMoodPicker({
    moods: window.MoodStore.MOODS,
    selected: cur ? cur.m : "",
    note: cur ? cur.note : "",
    max: window.MoodStore.NOTE_MAX,
  });
  card.hidden = false;
}

/**
 * 把当前选择写进旁路表。
 * @param {string} key 情绪 key
 * @returns {void}
 */
function saveMood(key) {
  if (!moodTarget || !window.MoodStore) return;
  const box = $("mood-note");
  const entry = window.MoodStore.recordMood(moodTarget, {
    m: key,
    note: box ? box.value : "",
  });
  if (!entry) {
    showToast("这个心情没记上，再点一次试试", "error");
    return;
  }
  const def = window.MoodStore.MOODS.find((m) => m.key === key);
  showToast(`记下了：${def ? def.icon + " " + def.name : key}`, "success");
  closeMood();
}

// ---------------------------- B3 静坐一程 ----------------------------

/** focus.js 是否已经装好并接上 UI */
let focusReady = false;

/** 表盘上当前选中的分钟数（未开始时才可改），初值取偏好里的默认时长 */
let focusMinutes = prefs.focusMinutes || 25;

/**
 * 把 Focus.state() 的原始快照翻译成 uiFocusDial() 要的形状。
 * 模块给的是 percent 0~1 / remain 毫秒，组件要的是 0~100 / 剩余秒——
 * 换算放在这里，两边各自保持自己的自然单位。
 * @returns {Object} uiFocusDial 的入参
 */
function focusView() {
  const st = window.Focus ? window.Focus.state() : null;
  if (!st || !st.active) {
    return { minutes: focusMinutes, left: focusMinutes * 60, percent: 0, phase: "idle" };
  }
  return {
    minutes: st.minutes,
    left: Math.ceil(st.remain / 1000),
    percent: Math.round(st.percent * 100),
    phase: st.done ? "done" : st.paused ? "paused" : "running",
    planName: st.planName,
  };
}

/**
 * 重绘专注表盘。
 * @returns {void}
 */
function renderFocus() {
  const slot = $("focus-slot");
  if (!slot || typeof uiFocusDial !== "function") return;
  slot.innerHTML = uiFocusDial(focusView());
}

/**
 * 渲染 / 折叠专注记录。
 * @param {boolean} show 是否展开
 * @returns {void}
 */
function renderFocusLog(show) {
  const box = $("focus-log");
  if (!box || !window.Focus) return;
  if (!show) {
    box.hidden = true;
    return;
  }
  const rows = window.Focus.history(12).slice().reverse();
  if (rows.length === 0) {
    box.innerHTML = uiEmpty("还没有坐过一程。第一次总是最难开始的。", "🕯");
    box.hidden = false;
    return;
  }
  box.innerHTML =
    `<div class="focus-log">` +
    rows
      .map((r) => {
        const when = new Date(Number(r.endTs) || Date.now());
        const stamp =
          `${when.getMonth() + 1}/${when.getDate()} ` +
          `${String(when.getHours()).padStart(2, "0")}:` +
          `${String(when.getMinutes()).padStart(2, "0")}`;
        const tag = r.converted ? "✦ 成星" : r.completed ? "✓ 坐满" : "· 中途起身";
        return (
          `<div class="focus-log-row"><span>${stamp}</span>` +
          `<span>${escapeHtml(r.planName || "不为哪颗星")}</span>` +
          `<span>${Number(r.minutes) || 0} 分 ${tag}</span></div>`
        );
      })
      .join("") +
    `</div>`;
  box.hidden = false;
}

/**
 * 挂上专注模块：绑事件、订阅 tick、恢复上次未走完的会话。
 * 只跑一次。
 * @returns {void}
 */
function bindFocus() {
  if (focusReady || !window.Focus) return;
  focusReady = true;

  const card = $("focus-card");
  const slot = $("focus-slot");
  if (card) card.hidden = false;

  if (slot) {
    slot.addEventListener("click", (e) => {
      const min = e.target.closest("[data-focus-min]");
      if (min) {
        focusMinutes = Number(min.getAttribute("data-focus-min")) || 25;
        renderFocus();
        return;
      }
      const btn = e.target.closest("[data-focus]");
      if (!btn) return;
      const act = btn.getAttribute("data-focus");

      if (act === "start") {
        // 用户手势就这一下，音频解锁必须搭在这里
        if (window.Sensory) window.Sensory.unlock();
        const focus = pickFocus();
        window.Focus.startFocus(
          focusMinutes,
          focus ? focus.plan.id : null,
          focus ? focus.plan.name : ""
        );
        showToast(`开始 ${focusMinutes} 分钟 · 别急`, "success");
      } else if (act === "pause") {
        window.Focus.pause();
      } else if (act === "resume") {
        window.Focus.resume();
      } else if (act === "abort") {
        window.Focus.abort();
        showToast("这一程放下了，不记账", "info");
      } else if (act === "convert") {
        const before = window.Rank ? window.Rank.getRank() : null;
        const item = window.Focus.convertToStar();
        if (item) {
          showToast("这一程，成了一颗星 ✦", "success");
          afterCheckin(btn, item, before);
          renderAll();
        }
      }
      renderFocus();
    });
  }

  const logBtn = $("focus-log-btn");
  if (logBtn) {
    logBtn.addEventListener("click", () => {
      const box = $("focus-log");
      const willShow = Boolean(box && box.hidden);
      renderFocusLog(willShow);
      logBtn.textContent = willShow ? "收起" : "看记录";
    });
  }

  window.Focus.onTick(() => renderFocus());
  window.Focus.onFinish(() => {
    renderFocus();
    showToast("时间到。这一程你坐住了。", "success");
  });

  window.Focus.restore();
  renderFocus();
}

// ---------------------------- D4 快捷键 ----------------------------

/**
 * 绑快捷键与 PWA 下拉手势。
 * @returns {void}
 */
function bindShortcuts() {
  if (!window.Shortcuts) return;
  window.Shortcuts.init({
    check: () => {
      if (manualCheckBtn.hidden) {
        showToast("「点亮」按钮当前是关着的，去星图页设置里开", "info");
        return;
      }
      manualCheckBtn.click();
    },
    pull: () => {
      if (!manualCheckBtn.hidden) manualCheckBtn.click();
    },
    focus: () => {
      loadModule("focus.js").then(() => {
        bindFocus();
        const st = window.Focus ? window.Focus.state() : null;
        if (!st || !st.active) {
          if (window.Sensory) window.Sensory.unlock();
          window.Focus.startFocus(focusMinutes, null, "");
        } else if (st.paused) {
          window.Focus.resume();
        } else {
          window.Focus.pause();
        }
        renderFocus();
        const card = $("focus-card");
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
      });
    },
    theme: () => {
      if (!window.Theme) return;
      const list = window.Theme.THEMES;
      const now = window.Theme.resolved();
      const next = list[(list.indexOf(now) + 1) % list.length];
      window.Theme.setMode("manual", next);
      const meta = window.Theme.META[next];
      showToast(`天色换成「${meta ? meta.name : next}」`, "success");
    },
    silent: () => {
      if (!window.Sensory) return;
      const on = !window.Sensory.isSilent();
      window.Sensory.setSilent(on);
      showToast(on ? "静默了。只留画面。" : "声音回来了 ♪", "success");
    },
    goto: () => {
      location.href = "manage.html";
    },
    escape: () => {
      closeMood();
    },
    planPrev: () => moveFocusPlan(-1),
    planNext: () => moveFocusPlan(1),
  });
}

// ---------------------------- 装配总入口 ----------------------------

/**
 * 首屏画完之后再做的事：按需拉模块、弹引导、起环境动效。
 * 全部包在 try 里——v6 的任何一环坏掉，天文台主体都得照常显示。
 * @returns {void}
 */
function bootV6() {
  // 情绪卡与段位徽章用事件委托，写一次就够
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;

    const rank = e.target.closest('[data-act="rank-detail"]');
    if (rank) {
      location.href = "stats.html#rank";
      return;
    }
    const chip = e.target.closest("[data-mood]");
    if (chip) {
      saveMood(chip.getAttribute("data-mood"));
      return;
    }
    if (e.target.closest("#mood-skip")) closeMood();
  });

  document.addEventListener("input", (e) => {
    if (!e.target || e.target.id !== "mood-note") return;
    const n = $("mood-count");
    if (n) n.textContent = String(e.target.value.length);
  });

  if (window.Theme) window.Theme.startAutoWatch();

  // 第一次来的人：先签契约，签完再谈别的
  if (localStorage.getItem("runform_contract") === null) {
    loadModule("onboarding.js").then(() => {
      if (window.Onboarding && window.Onboarding.needed()) window.Onboarding.open();
    });
  }

  loadModule("focus.js").then((ok) => {
    if (ok) bindFocus();
  });

  loadModule("shortcuts.js").then((ok) => {
    if (ok) bindShortcuts();
  });

  // 环境动效默认不开：必须用户手动开过，或者「在充电 + Wi-Fi」——
  // 不能在别人流量 + 20% 电量的手机上偷偷跑粒子。
  loadModule("ambient.js").then((ok) => {
    if (ok && window.Ambient) window.Ambient.autoStart();
  });
}

// ============================ 事件绑定 ============================

manualCheckBtn.addEventListener("click", () => {
  if (!focusPlanId) {
    showToast("当前没有可点亮的星", "error");
    return;
  }
  const plan = loadPlans().find((p) => p.id === focusPlanId);
  if (!plan) {
    showToast("这颗星已不存在，请刷新页面", "error");
    renderAll();
    return;
  }
  const rankBefore = window.Rank ? window.Rank.getRank() : null;
  const item = addCheckin(plan.id, plan.name);
  showToast(`已点亮：${plan.name} ✦`, "success");
  afterCheckin(manualCheckBtn, item, rankBefore);
  renderAll();
  scheduleAutoSync();
});

// 从别的标签页改了数据（打卡 / 计划 / 偏好 / 备忘）时，本页跟着刷新
window.addEventListener("storage", (e) => {
  if (!e.key) return;
  if ([PLAN_KEY, CHECKIN_KEY, PREFS_KEY, MEMO_KEY].indexOf(e.key) < 0) return;
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

  // v6 装配放在首屏画完之后，保证「天文台能看」永远优先于「天文台好看」
  try {
    bootV6();
  } catch (err) {
    console.error("v6 装配异常（不影响主页面）：", err);
  }

  // v6.1 备忘录站内提示：首屏画完再弹，避免遮挡初始化 toast
  try {
    checkDueMemos();
  } catch (err) {
    console.error("备忘录站内提示异常（不影响主页面）：", err);
  }

  // 异步拉取提醒送达记录，回来后再刷一次（失败会静默降级读缓存）
  loadReminderLog()
    .then(() => {
      renderAll();
    })
    .catch((err) => {
      console.error("提醒记录加载异常：", err);
      renderOfflineChip();
    });

  // v6.1「首屏即把本地已有的计划/打卡/备忘录推上云端」：
  // 之前只在用户改动数据时自动同步，导致微信里早已存在的计划从未上传，
  // 钉钉定时任务读不到 data/plans.json → 不推送提醒。这里在加载时补一次，
  // 真正满足「以后要自动同步」。无 token 时 scheduleAutoSync 内部静默跳过。
  try {
    if (typeof scheduleAutoSync === "function") scheduleAutoSync();
    if (typeof scheduleAutoSyncMemos === "function") scheduleAutoSyncMemos();
  } catch (err) {
    console.error("首屏自动同步触发异常（不影响主页面）：", err);
  }

  // 若本地有数据但没配 Token：给一次性根因提示。
  // 这正是「加了备忘/计划却不同步、钉钉不提醒」的根因——数据出不了浏览器。
  try {
    const __tok = (typeof resolveToken === "function") ? resolveToken() : "";
    const __proxy = (typeof resolveProxyUrl === "function") ? resolveProxyUrl() : "";
    if (!__tok && !__proxy) {
      const __localData =
        (typeof loadMemos === "function" && loadMemos().length) ||
        (typeof loadPlans === "function" && loadPlans().length) ||
        (typeof loadCheckins === "function" && loadCheckins().length);
      if (__localData && !sessionStorage.getItem("runform_no_token_hinted")) {
        sessionStorage.setItem("runform_no_token_hinted", "1");
        setTimeout(() => showToast("本机有未同步数据，但未配置 GitHub Token：不会自动同步到云端，钉钉也不会提醒。去「管理」页填 Token 开启。", "warning"), 1400);
      }
    }
  } catch (err) {
    console.error("Token 提示检查异常：", err);
  }
})();
