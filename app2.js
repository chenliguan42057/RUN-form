/**
 * 不按惯例 · 管理页逻辑（app2.js）
 *
 * 职责：计划 CRUD（含每计划提醒时间）、全量台账（删除 / 清空）、GitHub 同步设置。
 *
 * 依赖：store.js 必须先加载。以下函数 / 常量来自 store.js，本文件只使用不重复声明：
 *   loadPlans / addPlan / updatePlan / deletePlan / togglePlan / describePlan
 *   loadCheckins / deleteCheckin / clearAll
 *   resolveToken / syncToRepo / scheduleAutoSync
 *   showToast / formatTime / escapeHtml / TOKEN_KEY
 */

// ---- DOM 引用（与 manage.html 的 id 一一对应）----
const $ = (id) => document.getElementById(id);
const planForm = $("plan-form");
const planNameInput = $("plan-name");
const planFreqSelect = $("plan-freq");
const planTimeInput = $("plan-time");
const planWeekdaySelect = $("plan-weekday");
const planDateInput = $("plan-date");
const planEnabledCheckbox = $("plan-enabled");
const planSubmitBtn = $("plan-submit");
const planCancelLink = $("plan-cancel");
const weekdayWrap = $("weekday-wrap");
const dateWrap = $("date-wrap");
const planListEl = $("plan-list");
const planListEmpty = $("plan-list-empty");

const ledgerBody = $("ledger-body");
const ledgerEmpty = $("ledger-empty");
const clearAllBtn = $("clear-all-btn");

const patInput = $("pat-input");
const syncBtn = $("sync-btn");

/** 当前正在编辑的计划 id；为 null 表示处于「新增」模式 */
let editingId = null;

// ============================ 表单辅助 ============================

/**
 * 根据当前频率切换「星期」/「日期」字段的可见性。
 * 每日 → 两者都隐藏；每周 → 只显示星期；每月 → 只显示日期。
 * @returns {void}
 */
function syncFreqVisibility() {
  const freq = planFreqSelect.value;
  weekdayWrap.hidden = freq !== "weekly";
  dateWrap.hidden = freq !== "monthly";
}

/**
 * 把表单重置回「新增计划」的初始状态。
 * @returns {void}
 */
function resetPlanForm() {
  editingId = null;
  planNameInput.value = "";
  planFreqSelect.value = "daily";
  planTimeInput.value = "08:00";
  planWeekdaySelect.value = "0";
  planDateInput.value = "1";
  planEnabledCheckbox.checked = true;
  planSubmitBtn.textContent = "添加计划";
  planCancelLink.hidden = true;
  syncFreqVisibility();
}

/**
 * 把某个计划的数据填进表单，进入「编辑」模式。
 * @param {Object} plan 计划对象
 * @returns {void}
 */
function fillPlanForm(plan) {
  editingId = plan.id;
  planNameInput.value = plan.name;
  planFreqSelect.value = plan.freq;
  planTimeInput.value = plan.time;
  if (plan.freq === "weekly") {
    planWeekdaySelect.value = String(plan.day);
  } else if (plan.freq === "monthly") {
    planDateInput.value = String(plan.day);
  }
  planEnabledCheckbox.checked = plan.enabled !== false;
  planSubmitBtn.textContent = "保存修改";
  planCancelLink.hidden = false;
  syncFreqVisibility();
  planNameInput.focus();
}

// ============================ 渲染：计划列表 ============================

/**
 * 渲染计划列表：名称 + 频率/时间/日期描述 + 启用开关 + 编辑 / 删除。
 * @returns {void}
 */
function renderPlanList() {
  const plans = loadPlans();
  planListEl.innerHTML = "";

  if (plans.length === 0) {
    planListEmpty.hidden = false;
    return;
  }
  planListEmpty.hidden = true;

  plans.forEach((plan) => {
    const row = document.createElement("div");
    row.className = "plan-row plan-item";

    // 左侧信息区：计划名（转义）+ 频率描述
    const info = document.createElement("div");
    info.className = "plan-info";
    info.innerHTML =
      `<strong>${escapeHtml(plan.name)}</strong>` +
      `<div class="plan-meta">${escapeHtml(describePlan(plan))}</div>`;

    // 右侧操作区
    const actions = document.createElement("div");
    actions.className = "plan-actions";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "checkbox-row checkbox-inline";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = plan.enabled !== false;
    toggle.addEventListener("change", () => {
      togglePlan(plan.id);
      renderPlanList();
      scheduleAutoSync();
    });
    const toggleText = document.createElement("span");
    toggleText.textContent = "启用";
    toggleLabel.append(toggle, toggleText);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "mini-btn";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => fillPlanForm(plan));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      if (!confirm("确定删除该计划？")) return;
      deletePlan(plan.id);
      // 正在编辑的计划被删掉时，表单要退回新增态，避免保存到不存在的 id
      if (editingId === plan.id) resetPlanForm();
      renderPlanList();
      showToast("已删除该计划", "success");
      scheduleAutoSync();
    });

    actions.append(toggleLabel, editBtn, delBtn);
    row.append(info, actions);
    planListEl.appendChild(row);
  });
}

// ============================ 渲染：全部台账 ============================

/**
 * 渲染全部打卡台账（倒序，最新在上）。
 * @returns {void}
 */
function renderLedger() {
  const list = loadCheckins()
    .slice()
    .sort((a, b) => b.ts - a.ts);
  ledgerBody.innerHTML = "";

  if (list.length === 0) {
    ledgerEmpty.hidden = false;
    return;
  }
  ledgerEmpty.hidden = true;

  list.forEach((item, index) => {
    const tr = document.createElement("tr");

    const tdIndex = document.createElement("td");
    tdIndex.textContent = String(index + 1);

    const tdTime = document.createElement("td");
    tdTime.textContent = formatTime(item.ts);

    const tdPlan = document.createElement("td");
    tdPlan.className = "content-cell";
    tdPlan.innerHTML = escapeHtml(item.planName); // 已转义，安全

    const tdAction = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      if (!confirm("确定要删除这条打卡记录吗？")) return;
      deleteCheckin(item.id);
      renderLedger();
      showToast("已删除该记录", "success");
      scheduleAutoSync();
    });
    tdAction.appendChild(delBtn);

    tr.append(tdIndex, tdTime, tdPlan, tdAction);
    ledgerBody.appendChild(tr);
  });
}

// ============================ 事件绑定 ============================

planFreqSelect.addEventListener("change", syncFreqVisibility);

planForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = planNameInput.value.trim();
  if (!name) {
    showToast("请填写计划名称", "error");
    planNameInput.focus();
    return;
  }

  const freq = planFreqSelect.value;
  let day = 0;
  if (freq === "weekly") {
    day = Number(planWeekdaySelect.value) || 0;
  } else if (freq === "monthly") {
    // 钳制到 1~31 的合法日值；短月（如 2 月 31 日）由钉钉调度按当月最后一天兜底
    const raw = Number(planDateInput.value) || 1;
    day = Math.min(31, Math.max(1, Math.floor(raw)));
  }

  const patch = {
    name,
    freq,
    time: planTimeInput.value || "08:00",
    day,
    enabled: planEnabledCheckbox.checked,
  };

  if (editingId) {
    updatePlan(editingId, patch);
    showToast("已保存修改", "success");
  } else {
    addPlan(patch);
    showToast("已添加计划", "success");
  }

  resetPlanForm();
  renderPlanList();
  scheduleAutoSync();
});

planCancelLink.addEventListener("click", (e) => {
  e.preventDefault();
  resetPlanForm();
});

clearAllBtn.addEventListener("click", () => {
  const confirmMsg =
    "确定要清空全部打卡记录吗？此操作会同时清空本地与 GitHub 仓库中的记录，不可恢复。";
  if (!confirm(confirmMsg)) return;
  clearAll();
  renderLedger();
  showToast("已清空全部记录", "success");
  scheduleAutoSync();
});

syncBtn.addEventListener("click", syncToRepo);

// ============================ 初始化 ============================
(function init() {
  // 回填本机持久保存的 token（若存在）
  const savedToken = localStorage.getItem(TOKEN_KEY);
  if (savedToken) patInput.value = savedToken;

  syncFreqVisibility();
  renderPlanList();
  renderLedger();
})();
