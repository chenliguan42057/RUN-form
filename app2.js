/**
 * app2.js —— 星图页（manage.html）交互逻辑（v4「星河契约」）
 *
 * v4 的核心变化：主视图不再是表单 + 卡片列表，而是一张【星图画布】。
 *   · 每个计划 = 夜空里的一颗星，位置由 id 哈希固定，亮度由坚持程度决定；
 *   · 点一颗星 → 打开「星体编辑舱」弹层（表单 id 与 v2/v3 完全一致）；
 *   · 「＋ 缔结新星」→ 同一个弹层的新增模式；
 *   · 同步 / 备份 / 偏好 / 台账这些技术性内容，统统收进右上角设置抽屉。
 *
 * 职责（与 v3 一致，只是入口位置变了）：
 *   1. 计划的增 / 删 / 改 / 启停（含 icon / color / desc）
 *   2. 界面偏好（显示手动打卡按钮 / 星点图数据来源 / 减少动效）
 *   3. 数据备份与恢复（导出 JSON、导入 JSON）
 *   4. 全部台账浏览与删除
 *   5. GitHub Personal Access Token 与手动同步
 *
 * ⚠️ 依赖关系（加载顺序固定，不可颠倒）：
 *     store.js  →  components.js  →  app2.js
 *   本文件只做「取 DOM、组织流程、绑事件」，
 *   所有数据读写走 store.js，所有 HTML 片段走 components.js 的 ui* 函数。
 *
 * ⚠️ 星期口径：plan.day 全程使用 Python 口径（周一 = 0），
 *   与 data/plans.json、dingtalk-reminder.yml 完全一致；
 *   #plan-weekday 的 option value 已按此口径写死，这里直接透传，不做任何换算。
 */

/** 取元素的语法糖。⚠️ 只允许在页面脚本里声明，store.js / components.js 中禁止出现。 */
const $ = (id) => document.getElementById(id);

// ============================ DOM 引用 ============================

const appRoot = $("app-root");
const navSlot = $("nav-slot");

// 星图主视图
const skyPoemEl = $("sky-poem");
const skyMetaSlot = $("sky-meta-slot");
const skyMapSlot = $("sky-map-slot");
const newStarBtn = $("new-star-btn");

// 星体编辑舱
const starModal = $("star-modal");
const starModalTitle = $("star-modal-title");
const starBriefSlot = $("star-brief-slot");
const starCloseBtn = $("star-close");

// 计划表单（id 与 v2/v3 完全一致）
const planForm = $("plan-form");
const planNameInput = $("plan-name");
const iconSlot = $("icon-picker-slot");
const themeSlot = $("theme-picker-slot");
const planDescInput = $("plan-desc");
const planFreqSelect = $("plan-freq");
const planTimeInput = $("plan-time");
const weekdayWrap = $("weekday-wrap");
const planWeekdaySelect = $("plan-weekday");
const dateWrap = $("date-wrap");
const planDateInput = $("plan-date");
const planEnabledInput = $("plan-enabled");
const planSubmitBtn = $("plan-submit");
const planCancelLink = $("plan-cancel");
const planDangerZone = $("plan-danger");
const planDeleteBtn = $("plan-delete");

// 设置抽屉
const settingsBtn = $("settings-btn");
const settingsDrawer = $("settings-drawer");
const settingsCloseBtn = $("settings-close");

// 偏好
const prefManualInput = $("pref-manual");
const prefHeatmapSelect = $("pref-heatmap-source");
const prefReduceMotionInput = $("pref-reduce-motion");

// 备份
const exportBtn = $("export-btn");
const importFileInput = $("import-file");
const importMergeInput = $("import-merge");
const importBtn = $("import-btn");

// 台账
const ledgerBody = $("ledger-body");
const ledgerEmpty = $("ledger-empty");
const clearAllBtn = $("clear-all-btn");

// 语录库
const quoteInput = $("quote-input");
const addQuoteBtn = $("add-quote-btn");
const quotePreviewCount = $("quote-preview-count");

// 同步
const patInput = $("pat-input");
const syncBtn = $("sync-btn");

// ============================ 模块状态 ============================

/** 当前正在编辑的计划 id；null 表示「新增」模式 */
let editingId = null;
/** 表单中当前选中的图标（始终是一个具体 emoji） */
let selectedIcon = "🌟";
/** 表单中当前选中的配色 key；空串表示「自动分配」（交给 store 按 id 哈希决定） */
let selectedTheme = "";
/** 当前界面偏好快照 */
let prefs = loadPrefs();
/** 最近一次 buildStarMap() 的结果，供编辑舱取星体简报 */
let skyMap = { stars: [], links: [], total: 0, lit: 0, dim: 0 };

// ============================ 通用工具 ============================

/**
 * 把「减少动效」偏好同步到 <html> 上。
 * 系统级 prefers-reduced-motion 由 CSS 与 components.js 的 PREFERS_REDUCED 独立处理，
 * 这里只负责用户在本页手动打开的那一档开关。
 * @returns {void}
 */
function applyMotionPref() {
  document.documentElement.classList.toggle("no-motion", prefs.reduceMotion === true);
}

/**
 * 把时间戳格式化成「YYYY-MM-DD HH:MM」。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 格式化文本
 */
function formatTs(ts) {
  const d = new Date(Number(ts) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * 有弹层打开时锁住页面滚动，避免背景跟着一起滑。
 * @returns {void}
 */
function syncScrollLock() {
  const open =
    (starModal && !starModal.hidden) || (settingsDrawer && !settingsDrawer.hidden);
  document.body.classList.toggle("is-locked", Boolean(open));
}

// ============================ 图标 / 配色选择器 ============================

/**
 * 重新渲染图标选择器（会重置自定义输入框）。
 * @returns {void}
 */
function renderIconPicker() {
  if (!iconSlot) return;
  iconSlot.innerHTML = uiIconPicker(selectedIcon);
}

/**
 * 重新渲染配色选择器，并在「自动分配」状态下清掉所有高亮。
 * @returns {void}
 */
function renderThemePicker() {
  if (!themeSlot) return;
  themeSlot.innerHTML =
    uiThemePicker(selectedTheme) +
    `<p class="setting-note">不选＝让星河替这颗星挑一种颜色。</p>`;
  syncThemeActive();
}

/**
 * 依据 selectedIcon 同步图标格子的高亮状态（不重建 DOM，避免输入框失焦）。
 * @returns {void}
 */
function syncIconActive() {
  if (!iconSlot) return;
  const cells = iconSlot.querySelectorAll(".icon-cell");
  Array.prototype.forEach.call(cells, (cell) => {
    const on = cell.getAttribute("data-icon") === selectedIcon;
    cell.classList.toggle("is-active", on);
    cell.setAttribute("aria-checked", on ? "true" : "false");
  });
}

/**
 * 依据 selectedTheme 同步色块的高亮状态。
 * selectedTheme 为空串时全部取消高亮，表示「自动分配」。
 * @returns {void}
 */
function syncThemeActive() {
  if (!themeSlot) return;
  const swatches = themeSlot.querySelectorAll(".swatch");
  Array.prototype.forEach.call(swatches, (swatch) => {
    const on = selectedTheme !== "" && swatch.getAttribute("data-theme") === selectedTheme;
    swatch.classList.toggle("is-active", on);
    swatch.setAttribute("aria-checked", on ? "true" : "false");
  });
}

// ============================ 计划表单 ============================

/**
 * 依据当前频率，切换「星期」/「日期」两个附加字段的显隐。
 * ⚠️ v2 同名函数行为保持一致。
 * @returns {void}
 */
function syncFreqVisibility() {
  const freq = planFreqSelect ? planFreqSelect.value : "daily";
  if (weekdayWrap) weekdayWrap.hidden = freq !== "weekly";
  if (dateWrap) dateWrap.hidden = freq !== "monthly";
}

/**
 * 把表单恢复到「缔结新星」的初始状态。
 * @returns {void}
 */
function resetPlanForm() {
  editingId = null;
  selectedIcon = "🌟";
  selectedTheme = "";

  if (planNameInput) planNameInput.value = "";
  if (planDescInput) planDescInput.value = "";
  if (planFreqSelect) planFreqSelect.value = "daily";
  if (planTimeInput) planTimeInput.value = "08:00";
  if (planWeekdaySelect) planWeekdaySelect.value = "0";
  if (planDateInput) planDateInput.value = "1";
  if (planEnabledInput) planEnabledInput.checked = true;
  if (planSubmitBtn) planSubmitBtn.textContent = "缔结";
  if (planCancelLink) planCancelLink.hidden = false;
  if (planDangerZone) planDangerZone.hidden = true;

  renderIconPicker();
  renderThemePicker();
  syncFreqVisibility();
}

/**
 * 把某个计划的数据灌进表单，进入「编辑」模式。
 * @param {Object} plan 计划对象
 * @returns {void}
 */
function fillPlanForm(plan) {
  if (!plan) return;
  editingId = plan.id;
  selectedIcon = plan.icon || "🌟";
  selectedTheme = typeof plan.color === "string" ? plan.color : "";

  if (planNameInput) planNameInput.value = plan.name || "";
  if (planDescInput) planDescInput.value = plan.desc || "";
  if (planFreqSelect) planFreqSelect.value = plan.freq || "daily";
  if (planTimeInput) planTimeInput.value = plan.time || "08:00";
  if (planWeekdaySelect) {
    // plan.day 是 Python 口径（周一 = 0），option value 同口径，直接赋值
    planWeekdaySelect.value = String(plan.freq === "weekly" ? Number(plan.day) || 0 : 0);
  }
  if (planDateInput) {
    planDateInput.value = String(plan.freq === "monthly" ? Number(plan.day) || 1 : 1);
  }
  if (planEnabledInput) planEnabledInput.checked = plan.enabled !== false;
  if (planSubmitBtn) planSubmitBtn.textContent = "保存契约";
  if (planCancelLink) planCancelLink.hidden = false;
  if (planDangerZone) planDangerZone.hidden = false;

  renderIconPicker();
  renderThemePicker();
  syncFreqVisibility();
}

/**
 * 从表单读取字段并做基本校验。
 * @returns {Object|null} 合法时返回字段对象，非法时提示并返回 null
 */
function collectPlanFields() {
  const name = planNameInput ? planNameInput.value.trim() : "";
  if (!name) {
    showToast("先给这颗星取个名字", "error");
    if (planNameInput) planNameInput.focus();
    return null;
  }

  const freq = planFreqSelect ? planFreqSelect.value : "daily";
  const time = planTimeInput && planTimeInput.value ? planTimeInput.value : "08:00";

  // day 的含义随频率而变：weekly = 星期号 0~6（周一 = 0）；monthly = 每月第几日 1~31
  let day = 0;
  if (freq === "weekly") {
    day = uiClamp(Number(planWeekdaySelect ? planWeekdaySelect.value : 0) || 0, 0, 6);
  } else if (freq === "monthly") {
    day = uiClamp(Number(planDateInput ? planDateInput.value : 1) || 1, 1, 31);
  }

  const fields = {
    name,
    freq,
    time,
    day,
    enabled: planEnabledInput ? planEnabledInput.checked : true,
    icon: selectedIcon || "🌟",
    desc: planDescInput ? planDescInput.value.trim().slice(0, 60) : "",
  };
  // 只有用户明确选了颜色才带 color 字段，否则交给 store 按 id 哈希自动分配
  if (selectedTheme !== "") fields.color = selectedTheme;
  return fields;
}

// ============================ 弹层：星体编辑舱 ============================

/**
 * 打开星体编辑舱。
 * @param {string|null} planId 计划 id；传 null / 空表示「缔结新星」
 * @returns {void}
 */
function openStarModal(planId) {
  if (!starModal) return;

  const plan = planId ? loadPlans().find((p) => p.id === planId) || null : null;

  if (plan) {
    fillPlanForm(plan);
    const star = skyMap.stars.find((s) => s.id === plan.id) || null;
    if (starBriefSlot) starBriefSlot.innerHTML = uiStarBrief(star);
    if (starModalTitle) starModalTitle.textContent = "改写契约";
  } else {
    resetPlanForm();
    if (starBriefSlot) starBriefSlot.innerHTML = uiStarBrief(null);
    if (starModalTitle) starModalTitle.textContent = "缔结新星";
  }

  starModal.hidden = false;
  syncScrollLock();
  if (planNameInput) planNameInput.focus();
}

/**
 * 关闭星体编辑舱并复位表单。
 * @returns {void}
 */
function closeStarModal() {
  if (!starModal) return;
  starModal.hidden = true;
  resetPlanForm();
  syncScrollLock();
}

// ============================ 弹层：设置抽屉 ============================

/**
 * 打开设置抽屉。
 * @returns {void}
 */
function openSettings() {
  if (!settingsDrawer) return;
  settingsDrawer.hidden = false;
  if (settingsBtn) settingsBtn.setAttribute("aria-expanded", "true");
  syncScrollLock();
  if (settingsCloseBtn) settingsCloseBtn.focus();
}

/**
 * 关闭设置抽屉。
 * @returns {void}
 */
function closeSettings() {
  if (!settingsDrawer) return;
  settingsDrawer.hidden = true;
  if (settingsBtn) settingsBtn.setAttribute("aria-expanded", "false");
  syncScrollLock();
  if (settingsBtn) settingsBtn.focus();
}

// ============================ 渲染 ============================

/**
 * 渲染星图主视图（星点 + 星座连线 + 顶部统计）。
 * @returns {void}
 */
function renderSky() {
  skyMap = buildStarMap();
  if (skyMetaSlot) skyMetaSlot.innerHTML = uiSkyMeta(skyMap);
  if (skyMapSlot) skyMapSlot.innerHTML = uiStarMap(skyMap, { links: true });
}

/**
 * 渲染顶部时段旁白。
 * @returns {void}
 */
function renderSkyPoem() {
  if (skyPoemEl) skyPoemEl.textContent = skyPoem();
}

/**
 * 渲染全部台账表格（倒序，最新在最上面）。
 * @returns {void}
 */
function renderLedger() {
  if (!ledgerBody) return;
  const list = loadCheckins().slice().sort((a, b) => Number(b.ts) - Number(a.ts));

  if (list.length === 0) {
    ledgerBody.innerHTML = "";
    if (ledgerEmpty) ledgerEmpty.hidden = false;
    if (clearAllBtn) clearAllBtn.disabled = true;
    return;
  }
  if (ledgerEmpty) ledgerEmpty.hidden = true;
  if (clearAllBtn) clearAllBtn.disabled = false;

  ledgerBody.innerHTML = list
    .map((item, index) => {
      const isManual = item.source !== "auto";
      const srcClass = "source-tag" + (isManual ? " is-manual" : "");
      const srcText = isManual ? "手动点亮" : "提醒送达";
      const icon = item.planIcon || "✅";
      return (
        `<tr data-id="${escapeHtml(item.id || "")}">` +
        `<td>${index + 1}</td>` +
        `<td>${escapeHtml(formatTs(item.ts))}</td>` +
        `<td class="content-cell">` +
        `<span aria-hidden="true">${escapeHtml(icon)}</span> ` +
        `${escapeHtml(item.planName || "未命名")}</td>` +
        `<td><span class="${srcClass}">${escapeHtml(srcText)}</span></td>` +
        `<td><button type="button" class="delete-btn" data-act="del-checkin">删除</button></td>` +
        `</tr>`
      );
    })
    .join("");
}

/**
 * 把偏好写回三个控件（用于首次进入与导入后刷新）。
 * @returns {void}
 */
function renderPrefs() {
  if (prefManualInput) prefManualInput.checked = prefs.showManualCheckin !== false;
  if (prefHeatmapSelect) prefHeatmapSelect.value = prefs.heatmapSource || "all";
  if (prefReduceMotionInput) prefReduceMotionInput.checked = prefs.reduceMotion === true;
}

/**
 * 整页重渲染（不含表单，表单有自己的生命周期）。
 * @returns {void}
 */
function renderAll() {
  renderSky();
  renderLedger();
}

// ============================ 事件：星图（委托） ============================

if (skyMapSlot) {
  skyMapSlot.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn || !skyMapSlot.contains(btn)) return;
    const act = btn.getAttribute("data-act");

    if (act === "new-star") {
      openStarModal(null);
      return;
    }
    if (act === "star") {
      const id = btn.getAttribute("data-id");
      if (id) openStarModal(id);
    }
  });
}

if (newStarBtn) {
  newStarBtn.addEventListener("click", () => openStarModal(null));
}

// ============================ 事件：编辑舱开合 ============================

if (starModal) {
  // 背景遮罩与右上角 × 共用 data-act="close-star"
  starModal.addEventListener("click", (event) => {
    const hit = event.target.closest('[data-act="close-star"]');
    if (hit && starModal.contains(hit)) closeStarModal();
  });
}

if (starCloseBtn) {
  starCloseBtn.addEventListener("click", closeStarModal);
}

if (settingsBtn) {
  settingsBtn.addEventListener("click", openSettings);
}

if (settingsDrawer) {
  settingsDrawer.addEventListener("click", (event) => {
    const hit = event.target.closest('[data-act="close-settings"]');
    if (hit && settingsDrawer.contains(hit)) closeSettings();
  });
}

if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener("click", closeSettings);
}

// Esc 依次关掉最上层的弹层
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (starModal && !starModal.hidden) {
    closeStarModal();
    return;
  }
  if (settingsDrawer && !settingsDrawer.hidden) closeSettings();
});

// ============================ 事件：计划表单 ============================

if (planFreqSelect) {
  planFreqSelect.addEventListener("change", syncFreqVisibility);
}

if (iconSlot) {
  // 预设图标：点一下即选中，同时清空自定义输入
  iconSlot.addEventListener("click", (event) => {
    const cell = event.target.closest(".icon-cell");
    if (!cell || !iconSlot.contains(cell)) return;
    selectedIcon = cell.getAttribute("data-icon") || "🌟";
    const custom = $("plan-icon-custom");
    if (custom) custom.value = "";
    syncIconActive();
  });

  // 自定义图标：输入非空时以它为准，清空则回落到默认星星
  iconSlot.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || target.id !== "plan-icon-custom") return;
    const value = target.value.trim();
    selectedIcon = value || "🌟";
    syncIconActive();
  });
}

if (themeSlot) {
  themeSlot.addEventListener("click", (event) => {
    const swatch = event.target.closest(".swatch");
    if (!swatch || !themeSlot.contains(swatch)) return;
    const key = swatch.getAttribute("data-theme") || "";
    // 再点一次已选中的色块＝取消选择，回到「自动分配」
    selectedTheme = selectedTheme === key ? "" : key;
    syncThemeActive();
  });
}

if (planForm) {
  planForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = collectPlanFields();
    if (!fields) return;

    if (editingId) {
      // 编辑模式：只打补丁，不动 id / createdAt
      const patch = Object.assign({}, fields);
      if (selectedTheme === "") {
        // 用户取消了配色选择：让它回到自动分配（写空串，themeOf 会走哈希兜底）
        patch.color = "";
      }
      updatePlan(editingId, patch);
      showToast("契约已改写", "success");
    } else {
      addPlan(fields);
      showToast("新星已缔结 ✦", "success");
    }

    closeStarModal();
    renderAll();
    scheduleAutoSync();
  });
}

if (planCancelLink) {
  planCancelLink.addEventListener("click", (event) => {
    event.preventDefault();
    closeStarModal();
  });
}

if (planDeleteBtn) {
  planDeleteBtn.addEventListener("click", () => {
    if (!editingId) return;
    const plan = loadPlans().find((p) => p.id === editingId);
    const name = plan ? plan.name : "这颗星";
    if (!window.confirm(`确定熄灭「${name}」吗？它会从夜空中消失，打卡记录仍然保留。`)) {
      return;
    }
    deletePlan(editingId);
    showToast("这颗星已熄灭", "success");
    closeStarModal();
    renderAll();
    scheduleAutoSync();
  });
}

// ============================ 事件：偏好 ============================

if (prefManualInput) {
  prefManualInput.addEventListener("change", () => {
    prefs = savePrefs({ showManualCheckin: prefManualInput.checked });
    showToast(prefManualInput.checked ? "天文台将显示「点亮」" : "已隐藏「点亮」", "success");
  });
}

if (prefHeatmapSelect) {
  prefHeatmapSelect.addEventListener("change", () => {
    prefs = savePrefs({ heatmapSource: prefHeatmapSelect.value });
    showToast("星点图数据来源已更新", "success");
  });
}

if (prefReduceMotionInput) {
  prefReduceMotionInput.addEventListener("change", () => {
    prefs = savePrefs({ reduceMotion: prefReduceMotionInput.checked });
    applyMotionPref();
    showToast(prefReduceMotionInput.checked ? "已关闭动效" : "已恢复动效", "success");
  });
}

// ============================ 事件：备份与恢复 ============================

if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    try {
      const json = exportData();
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `runform-backup-${dateKey()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // 立刻回收会让部分浏览器来不及下载，延后一拍再释放
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("备份已导出", "success");
    } catch (err) {
      console.error("导出失败：", err);
      showToast("导出失败，请检查浏览器下载权限", "error");
    }
  });
}

if (importBtn) {
  importBtn.addEventListener("click", () => {
    const file = importFileInput && importFileInput.files ? importFileInput.files[0] : null;
    if (!file) {
      showToast("请先选择一个备份文件", "error");
      return;
    }
    const merge = importMergeInput ? importMergeInput.checked : true;
    if (!merge && !window.confirm("覆盖导入会清空当前的星图与台账，确定继续吗？")) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importData(String(reader.result || ""), { merge });
        // 导入可能带进新的偏好，重新取一次并刷新界面
        prefs = loadPrefs();
        renderPrefs();
        applyMotionPref();
        closeStarModal();
        renderAll();
        scheduleAutoSync();
        showToast(`导入完成：星 ${result.plans} 颗，台账 ${result.checkins} 条`, "success");
      } catch (err) {
        console.error("导入失败：", err);
        showToast(err.message || "导入失败", "error");
      }
    };
    reader.onerror = () => {
      console.error("读取备份文件失败：", reader.error);
      showToast("读取文件失败，请重试", "error");
    };
    reader.readAsText(file, "utf-8");
  });
}

// ============================ 事件：台账 ============================

if (ledgerBody) {
  ledgerBody.addEventListener("click", (event) => {
    const btn = event.target.closest('[data-act="del-checkin"]');
    if (!btn) return;
    const row = btn.closest("tr");
    if (!row) return;
    const id = row.getAttribute("data-id");
    if (!id) return;

    deleteCheckin(id);
    showToast("记录已删除", "success");
    renderLedger();
    renderSky(); // 亮度依赖台账，删记录后星图要跟着变暗
    scheduleAutoSync();
  });
}

if (clearAllBtn) {
  clearAllBtn.addEventListener("click", () => {
    if (!window.confirm("确定清空全部点亮记录吗？此操作不可撤销（星本身会保留）。")) return;
    clearAll();
    showToast("台账已清空", "success");
    renderAll();
    scheduleAutoSync();
  });
}

// ============================ 事件：同步 ============================

if (syncBtn) {
  syncBtn.addEventListener("click", () => {
    syncToRepo();
  });
}

if (patInput) {
  // 输入框失焦时把 token 落盘，省得用户填完忘了点同步
  patInput.addEventListener("change", () => {
    const value = patInput.value.trim();
    if (value) {
      safeSetItem(TOKEN_KEY, value);
      showToast("Token 已保存到本机浏览器", "success");
    }
  });
}

// ============================ 事件：扩充语录库 ============================

/**
 * 刷新「将新增 N 条」预览。
 * N 是【清洗后】的候选条数，不含「与现有库重复」的判断——那一步要异步读 quotes.json，
 * 放到真正提交时做，避免每敲一个字都去比对 1100+ 条。
 * @returns {void}
 */
function renderQuotePreview() {
  if (!quotePreviewCount || !quoteInput) return;
  quotePreviewCount.textContent = String(parseQuoteInput(quoteInput.value).length);
}

if (quoteInput) {
  quoteInput.addEventListener("input", renderQuotePreview);
}

if (addQuoteBtn) {
  addQuoteBtn.addEventListener("click", async () => {
    // 按钮 disable + 改文案 + finally 恢复，与 syncToRepo() 的样板一致
    const originalText = addQuoteBtn.textContent;
    addQuoteBtn.disabled = true;
    addQuoteBtn.textContent = "提交中…";
    try {
      const n = await addMindsetQuotes(quoteInput ? quoteInput.value : "", resolveToken());
      if (n > 0 && quoteInput) {
        quoteInput.value = "";
        renderQuotePreview();
      }
    } finally {
      addQuoteBtn.disabled = false;
      addQuoteBtn.textContent = originalText || "添加到语录库";
    }
  });
}

// ============================ 跨标签页同步 ============================

window.addEventListener("storage", (event) => {
  if (!event.key) return;
  if (event.key === PLAN_KEY || event.key === CHECKIN_KEY) {
    renderAll();
  } else if (event.key === PREFS_KEY) {
    prefs = loadPrefs();
    renderPrefs();
    applyMotionPref();
  }
});

// ============================ 初始化 ============================

/**
 * 页面入口：注入星空与导航，回填数据，绑定完毕后做一次进场动画。
 * @returns {void}
 */
function init() {
  applyMotionPref();
  uiStarfield(document.body);
  if (navSlot) navSlot.innerHTML = uiNav("manage");

  // v2 行为保留：已存过的 token 回填到输入框，方便用户确认
  if (patInput) {
    const saved = safeGetItem(TOKEN_KEY);
    if (saved) patInput.value = saved;
  }

  renderSkyPoem();
  renderPrefs();
  resetPlanForm();
  renderAll();
  renderQuotePreview();

  uiTooltip(document.body);
  uiRevealOnLoad(appRoot);
}

init();
