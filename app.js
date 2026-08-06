/**
 * 不按惯例 · 首页逻辑（app.js）
 *
 * 职责：只做「今日」这一件事——选计划 → 一键打卡 → 看今天打了哪些卡。
 * 计划维护、全量台账、同步设置都在管理页（manage.html + app2.js）。
 *
 * 依赖：store.js 必须先加载。以下函数来自 store.js，本文件只使用不重复声明：
 *   loadPlans / loadCheckins / addCheckin / deleteCheckin / scheduleAutoSync
 *   showToast / formatTime / escapeHtml
 */

// ---- DOM 引用（与 index.html 的 id 一一对应）----
const $ = (id) => document.getElementById(id);
const quickForm = $("quick-checkin");
const planSelect = $("plan-select");
const quickCheckinBtn = $("quick-checkin-btn");
const planEmpty = $("plan-empty");
const todayList = $("today-list");
const todayEmpty = $("today-empty");
const manageBtn = $("manage-btn");

/**
 * 判断某时间戳是否落在“今天”。
 * 用本地时区的 toDateString 比较，跨天自动生效。
 * @param {number} ts 毫秒时间戳
 * @returns {boolean}
 */
function isToday(ts) {
  return new Date(ts).toDateString() === new Date().toDateString();
}

/**
 * 渲染计划下拉框：只列出启用中的计划。
 * 没有任何可用计划时，显示引导文案并禁用打卡入口。
 * @returns {void}
 */
function renderPlanSelect() {
  const plans = loadPlans().filter((p) => p.enabled);

  planSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— 请选择计划 —";
  planSelect.appendChild(placeholder);

  if (plans.length === 0) {
    planEmpty.hidden = false;
    planSelect.disabled = true;
    quickCheckinBtn.disabled = true;
    return;
  }

  planEmpty.hidden = true;
  planSelect.disabled = false;
  quickCheckinBtn.disabled = false;

  plans.forEach((plan) => {
    const opt = document.createElement("option");
    opt.value = plan.id;
    opt.textContent = plan.name; // textContent 自带转义，无需 escapeHtml
    planSelect.appendChild(opt);
  });
}

/**
 * 渲染今日打卡记录（倒序，最新在上）。
 * 每行：计划名 · 打卡时间 + 删除按钮。
 * @returns {void}
 */
function renderToday() {
  const list = loadCheckins()
    .filter((item) => isToday(item.ts))
    .sort((a, b) => b.ts - a.ts);

  todayList.innerHTML = "";

  if (list.length === 0) {
    todayEmpty.hidden = false;
    return;
  }
  todayEmpty.hidden = true;

  list.forEach((item) => {
    const row = document.createElement("div");
    row.className = "plan-row";

    const info = document.createElement("div");
    // 用 escapeHtml 保护计划名，防止历史脏数据里的尖括号破坏结构
    info.innerHTML =
      `<strong>${escapeHtml(item.planName)}</strong>` +
      `<div class="plan-meta">${escapeHtml(formatTime(item.ts))}</div>`;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      if (!confirm("确定要删除这条打卡记录吗？")) return;
      deleteCheckin(item.id);
      renderToday();
      showToast("已删除该记录", "success");
      scheduleAutoSync();
    });

    row.append(info, delBtn);
    todayList.appendChild(row);
  });
}

// ---- 事件绑定 ----

quickForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const planId = planSelect.value;
  if (!planId) {
    showToast("请先选择一个计划", "error");
    return;
  }
  const plan = loadPlans().find((p) => p.id === planId);
  if (!plan) {
    showToast("该计划已不存在，请刷新页面", "error");
    renderPlanSelect();
    return;
  }
  addCheckin(plan.id, plan.name);
  showToast("打卡成功：" + plan.name, "success");
  renderToday();
  scheduleAutoSync();
});

// 「管理」在 HTML 里已是 <a href="manage.html">，这里只对退化成 <button> 的情况兜底
if (manageBtn && manageBtn.tagName === "BUTTON") {
  manageBtn.addEventListener("click", () => {
    location.href = "manage.html";
  });
}

// ---- 初始化 ----
(function init() {
  renderPlanSelect();
  renderToday();
})();
