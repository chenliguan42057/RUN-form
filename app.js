/**
 * 不按惯例 · 打卡站点 前端逻辑
 * 数据全部存于浏览器 localStorage（台账 + Token 均持久保存，刷新/关页面不丢），不依赖任何后端。
 * 台账变更（打卡 / 删除 / 清空）后会自动防抖同步到 GitHub 仓库；顶部按钮保留手动同步能力。
 */

// ---- 常量 ----
const STORAGE_KEY = "runform_checkins"; // 台账数据键名
const TOKEN_KEY = "runform_pat"; // Personal Access Token（持久保存于本机 localStorage）
const REPO_DISPATCH_URL =
  "https://api.github.com/repos/chenliguan42057/RUN-form/dispatches";
const AUTO_SYNC_DELAY = 800; // 自动同步防抖窗口（毫秒）：连续操作只在最后一次后统一同步

// ---- DOM 引用（与 index.html 的 id 一一对应）----
const $ = (id) => document.getElementById(id);
const form = $("checkin-form");
const contentInput = $("checkin-content");
const ledgerBody = $("ledger-body");
const emptyHint = $("empty-hint");
const clearAllBtn = $("clear-all-btn");
const patInput = $("pat-input");
const syncBtn = $("sync-btn");
const toast = $("toast");

let toastTimer = null;
let autoSyncTimer = null; // 自动同步防抖定时器句柄

// ---- 工具函数 ----

/**
 * 生成记录唯一 id：优先用 crypto.randomUUID（安全上下文），
 * 退化场景（如个别浏览器 file:// 限制）用时间戳+随机串兜底，保证全局唯一。
 * @returns {string}
 */
function genId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 转义 HTML，防止存储内容破坏页面结构或被注入脚本（XSS 防护）
 * @param {string} str 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 读取台账数组，异常时回退为空数组。
 * 兼容旧数据：为缺少 id 的记录补一个随机 id，避免按 ts 去重/删除时误伤。
 * @returns {Array<{id:string, ts:number, content:string}>}
 */
function loadCheckins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) return [];
    // 为每条记录确保有唯一 id（旧记录可能没有）
    return data.map((item) => ({
      id: item.id || genId(),
      ts: item.ts || Date.now(),
      content: typeof item.content === "string" ? item.content : "",
    }));
  } catch (e) {
    console.error("读取台账失败，已重置：", e);
    return [];
  }
}

/**
 * 写入台账数组
 * @param {Array<{ts:number, content:string}>} list
 */
function saveCheckins(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/**
 * 将时间戳格式化为可读的日期时间字符串
 * @param {number} ts 毫秒时间戳
 * @returns {string}
 */
function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 弹出 toast 提示
 * @param {string} message 提示文案
 * @param {"info"|"success"|"error"} type 提示类型
 */
function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast" + (type !== "info" ? ` toast-${type}` : "");
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

// ---- 渲染 ----

/**
 * 按时间倒序渲染台账表格
 */
function renderLedger() {
  const list = loadCheckins()
    .slice()
    .sort((a, b) => b.ts - a.ts); // 倒序：最新在上
  ledgerBody.innerHTML = "";

  if (list.length === 0) {
    emptyHint.hidden = false;
    return;
  }
  emptyHint.hidden = true;

  list.forEach((item, index) => {
    const tr = document.createElement("tr");

    const tdIndex = document.createElement("td");
    tdIndex.textContent = String(index + 1);

    const tdTime = document.createElement("td");
    tdTime.textContent = formatTime(item.ts);

    const tdContent = document.createElement("td");
    tdContent.className = "content-cell";
    tdContent.innerHTML = escapeHtml(item.content); // 已转义，安全

    const tdAction = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => deleteCheckin(item.id));
    tdAction.appendChild(delBtn);

    tr.append(tdIndex, tdTime, tdContent, tdAction);
    ledgerBody.appendChild(tr);
  });
}

// ---- 业务操作 ----

/**
 * 新增一条打卡记录
 * @param {string} content 打卡内容
 */
function addCheckin(content) {
  const list = loadCheckins();
  // 用随机 id 作为唯一键（ts 仅用于展示/排序），避免毫秒级同 ts 误删
  list.push({ id: genId(), ts: Date.now(), content });
  saveCheckins(list);
  renderLedger();
}

/**
 * 按 id 删除一条打卡记录（带二次确认）
 * @param {string} id 要删除记录的唯一 id
 */
function deleteCheckin(id) {
  if (!confirm("确定要删除这条打卡记录吗？")) return;
  const list = loadCheckins().filter((item) => item.id !== id);
  saveCheckins(list);
  renderLedger();
  showToast("已删除该记录", "success");
  scheduleAutoSync(); // 删除成功后自动同步
}

/**
 * 清空全部记录（带二次确认）
 */
function clearAll() {
  // 提示需覆盖远端：清空后自动同步会把空台账推到仓库，data/checkins.json 一并被清
  const confirmMsg =
    "确定要清空全部打卡记录吗？此操作会同时清空本地与 GitHub 仓库中的记录，不可恢复。";
  if (!confirm(confirmMsg)) return;
  localStorage.removeItem(STORAGE_KEY);
  renderLedger();
  showToast("已清空全部记录", "success");
  scheduleAutoSync(); // 清空成功后自动同步（推送空台账）
}

// ---- 同步到 GitHub ----

/**
 * 记忆 / 取回 PAT：优先用本次输入，否则取本机 localStorage 中持久保存的。
 * Token 只落在本机浏览器，并且仅通过 Authorization 请求头发给 GitHub。
 * @returns {string} 可用的 token，取不到时为空字符串
 */
function resolveToken() {
  const token = patInput.value.trim();
  if (token) localStorage.setItem(TOKEN_KEY, token);
  return token || localStorage.getItem(TOKEN_KEY) || "";
}

/**
 * 纯粹的 repository_dispatch 调用：只发请求，不碰任何 UI。
 * 手动同步与自动同步共用此函数；失败时抛出异常，由调用方决定如何提示。
 * @param {Array<{id:string, ts:number, content:string}>} checkins 待同步的台账数据
 * @param {string} token GitHub Personal Access Token（仅放进 Authorization 头）
 * @returns {Promise<void>}
 * @throws {Error} 网络异常或 HTTP 非 2xx 时抛出
 */
async function dispatchSync(checkins, token) {
  const resp = await fetch(REPO_DISPATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      event_type: "sync-checkins",
      client_payload: { checkins },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${errText}`);
  }
}

/**
 * 台账变更后的自动同步（防抖 800ms，把连续操作合并成一次请求）。
 * 与手动同步的差异：不操纵 syncBtn、不弹成功 toast，只在失败时提示；
 * 未配置 token 时静默跳过，避免打扰没打算同步的用户。
 */
function scheduleAutoSync() {
  // 提前探测一次：拿不到 token 就完全不排期，保持静默
  if (!resolveToken()) return;

  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(async () => {
    // 延时到点后重新取一次 token 与台账，保证同步的是最终状态
    const token = resolveToken();
    if (!token) return;

    try {
      await dispatchSync(loadCheckins(), token);
    } catch (err) {
      console.error("自动同步失败：", err);
      showToast(`自动同步失败：${err.message}`, "error");
    }
  }, AUTO_SYNC_DELAY);
}

/**
 * 手动同步：点击「同步到仓库」按钮时触发，行为保持不变
 * （操纵按钮禁用态与文案，成功/失败都给 toast）
 */
async function syncToRepo() {
  const token = resolveToken();
  if (!token) {
    showToast("请先填写 Personal Access Token", "error");
    patInput.focus();
    return;
  }

  const checkins = loadCheckins();
  syncBtn.disabled = true;
  syncBtn.textContent = "同步中…";

  try {
    await dispatchSync(checkins, token);
    showToast("已触发同步，仓库稍后更新", "success");
  } catch (err) {
    console.error("同步失败：", err);
    showToast(`同步失败：${err.message}`, "error");
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = "同步到仓库";
  }
}

// ---- 事件绑定 ----
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const content = contentInput.value.trim();
  if (!content) {
    showToast("打卡内容不能为空", "error");
    contentInput.focus();
    return;
  }
  addCheckin(content);
  contentInput.value = "";
  showToast("打卡成功", "success");
  scheduleAutoSync(); // 打卡成功后自动同步
});

clearAllBtn.addEventListener("click", clearAll);
syncBtn.addEventListener("click", syncToRepo);

// ---- 初始化 ----
// 启动：回填本机持久保存的 token（若存在），将旧数据补好的 id 一次性持久化，再渲染台账
(function init() {
  const savedToken = localStorage.getItem(TOKEN_KEY);
  if (savedToken) patInput.value = savedToken;
  // 关键：把 loadCheckins 中临时补的 id 写回 localStorage，
  // 否则每次 load 都会重新生成随机 id，导致旧记录（无 id）首次删除失效（BUG-5）
  saveCheckins(loadCheckins());
  renderLedger();
})();
