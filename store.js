/**
 * 不按惯例 · 打卡站点 —— 共享数据层 / 同步层（store.js）
 *
 * 首页（index.html + app.js）与管理页（manage.html + app2.js）共用本文件，
 * 必须在各自页面脚本【之前】加载。
 *
 * 设计约束：
 * - 纯全局函数，不使用任何模块系统（无 import/export），直接挂在全局作用域；
 * - 所有数据存于浏览器 localStorage，无后端；
 * - Token 只存本机 localStorage，只通过 Authorization 头发给 GitHub；
 * - 本文件负责定义 showToast / formatTime / genId / escapeHtml，
 *   页面脚本只能【使用】它们，绝不能重复声明（否则会 "already declared" 报错）。
 */

// ============================ 常量 ============================

/** 计划列表在 localStorage 中的键名 */
const PLAN_KEY = "runform_plans";
/** 打卡台账在 localStorage 中的键名（沿用 v1，保证老数据不丢） */
const CHECKIN_KEY = "runform_checkins";
/** Personal Access Token 在 localStorage 中的键名 */
const TOKEN_KEY = "runform_pat";
/** GitHub repository_dispatch 接口地址 */
const REPO_DISPATCH_URL =
  "https://api.github.com/repos/chenliguan42057/RUN-form/dispatches";
/** 自动同步防抖窗口（毫秒）：连续操作只在最后一次后统一同步 */
const AUTO_SYNC_DELAY = 800;

/** 频率中文标签映射 */
const FREQ_LABELS = {
  daily: "每日",
  weekly: "每周",
  monthly: "每月",
};

/** 星期中文标签（索引 = 周一为 0 的星期号，与 Python datetime.weekday() 一致） */
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// ============================ 内部状态 ============================

/** toast 自动隐藏定时器句柄 */
let toastTimer = null;
/** 自动同步防抖定时器句柄 */
let autoSyncTimer = null;

// ============================ 基础工具 ============================

/**
 * 生成唯一 id：优先 crypto.randomUUID（安全上下文），否则时间戳 + 随机串兜底。
 * @returns {string} 唯一标识
 */
function genId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 转义 HTML，防止用户内容破坏页面结构或被注入脚本（XSS 防护）。
 * 所有经 innerHTML 注入的用户数据都必须先过这里。
 * @param {string} str 原始字符串
 * @returns {string} 转义后的安全字符串
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
 * 将毫秒时间戳格式化为 "YYYY-MM-DD HH:MM:SS"。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 可读时间字符串
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
 * 弹出全局 toast 提示。
 * DOM 契约：页面需存在 id="toast" 的元素，初始带 hidden 属性。
 * @param {string} message 提示文案
 * @param {"info"|"success"|"error"} [type="info"] 提示类型
 * @returns {void}
 */
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast" + (type !== "info" ? ` toast-${type}` : "");
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

// ============================ 计划（Plan）数据层 ============================

/**
 * 读取计划列表，并对旧数据做字段补全（迁移）。
 * 计划模型：{id, name, freq:'daily'|'weekly'|'monthly', time:'HH:MM', day:Number, enabled:Boolean}
 * - weekly：day = 星期号 0~6（周一 = 0）
 * - monthly：day = 每月第几日 1~31
 * - daily：day 忽略
 * @returns {Array<{id:string,name:string,freq:string,time:string,day:number,enabled:boolean}>}
 */
function loadPlans() {
  let data = [];
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    data = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("读取计划失败，已重置：", e);
    data = [];
  }
  if (!Array.isArray(data)) return [];

  return data
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const freq =
        item.freq === "weekly" || item.freq === "monthly" ? item.freq : "daily";
      // day 缺省值随频率而定：每周默认周一(0)，每月默认 1 日，每日不关心
      let day = Number(item.day);
      if (!Number.isFinite(day)) {
        day = freq === "monthly" ? 1 : 0;
      }
      return {
        id: item.id || genId(),
        name: typeof item.name === "string" && item.name ? item.name : "未命名",
        freq,
        time: typeof item.time === "string" && item.time ? item.time : "08:00",
        day,
        enabled: item.enabled !== false,
      };
    });
}

/**
 * 写入计划列表。
 * @param {Array<Object>} list 计划数组
 * @returns {void}
 */
function savePlans(list) {
  localStorage.setItem(PLAN_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

/**
 * 新增一个计划。
 * @param {{name:string, freq:string, time:string, day:number, enabled:boolean}} plan 计划字段
 * @returns {Object} 新建的完整计划对象（含 id）
 */
function addPlan({ name, freq, time, day, enabled }) {
  const list = loadPlans();
  const item = {
    id: genId(),
    name: name || "未命名",
    freq: freq === "weekly" || freq === "monthly" ? freq : "daily",
    time: time || "08:00",
    day: Number.isFinite(Number(day)) ? Number(day) : 0,
    enabled: enabled !== false,
  };
  list.push(item);
  savePlans(list);
  return item;
}

/**
 * 按 id 更新计划（浅合并 patch）。
 * @param {string} id 计划 id
 * @param {Object} patch 要合并的字段
 * @returns {void}
 */
function updatePlan(id, patch) {
  const list = loadPlans().map((p) => (p.id === id ? { ...p, ...patch } : p));
  savePlans(list);
}

/**
 * 按 id 删除计划。
 * @param {string} id 计划 id
 * @returns {void}
 */
function deletePlan(id) {
  savePlans(loadPlans().filter((p) => p.id !== id));
}

/**
 * 切换计划的启用状态。
 * @param {string} id 计划 id
 * @returns {void}
 */
function togglePlan(id) {
  const list = loadPlans().map((p) =>
    p.id === id ? { ...p, enabled: !p.enabled } : p
  );
  savePlans(list);
}

// ============================ 台账（Checkin）数据层 ============================

/**
 * 读取打卡台账，并迁移 v1 旧记录。
 * v1 记录形如 {id, ts, content}（没有 planId / planName），
 * 迁移策略：planId = null，planName = content || "历史记录"，note = ""。
 * @returns {Array<{id:string, planId:(string|null), planName:string, ts:number, note:string}>}
 */
function loadCheckins() {
  let data = [];
  try {
    const raw = localStorage.getItem(CHECKIN_KEY);
    data = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("读取台账失败，已重置：", e);
    data = [];
  }
  if (!Array.isArray(data)) return [];

  return data
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      // 有 planName 说明已是 v2 结构；否则按 v1 的 content 字段迁移
      const planName =
        typeof item.planName === "string" && item.planName
          ? item.planName
          : (typeof item.content === "string" && item.content) || "历史记录";
      return {
        id: item.id || genId(),
        planId: item.planId || null,
        planName,
        ts: Number(item.ts) || Date.now(),
        note: typeof item.note === "string" ? item.note : "",
      };
    });
}

/**
 * 写入打卡台账。
 * @param {Array<Object>} list 台账数组
 * @returns {void}
 */
function saveCheckins(list) {
  localStorage.setItem(
    CHECKIN_KEY,
    JSON.stringify(Array.isArray(list) ? list : [])
  );
}

/**
 * 新增一条打卡记录（内容即计划名，不再有自由文本备注）。
 * @param {string|null} planId 关联的计划 id
 * @param {string} planName 计划名称（作为打卡内容展示）
 * @returns {Object} 新建的记录
 */
function addCheckin(planId, planName) {
  const list = loadCheckins();
  const item = {
    id: genId(),
    planId: planId || null,
    planName: planName || "未命名",
    ts: Date.now(),
    note: "",
  };
  list.push(item);
  saveCheckins(list);
  return item;
}

/**
 * 按 id 删除一条打卡记录。
 * @param {string} id 记录 id
 * @returns {void}
 */
function deleteCheckin(id) {
  saveCheckins(loadCheckins().filter((item) => item.id !== id));
}

/**
 * 清空全部打卡记录（只清台账，计划保留）。
 * @returns {void}
 */
function clearAll() {
  localStorage.removeItem(CHECKIN_KEY);
}

// ============================ 同步到 GitHub ============================

/**
 * 取回可用的 PAT：优先取管理页输入框的当前值（并持久化），否则读 localStorage。
 * 首页没有 #pat-input，此时直接读 localStorage。
 * @returns {string} token，取不到时为空字符串
 */
function resolveToken() {
  const input = document.getElementById("pat-input");
  if (input) {
    const typed = input.value.trim();
    if (typed) {
      localStorage.setItem(TOKEN_KEY, typed);
      return typed;
    }
  }
  return localStorage.getItem(TOKEN_KEY) || "";
}

/**
 * 纯粹的 repository_dispatch 调用：只发请求，不碰任何 UI。
 * 失败时抛出【可直接展示给用户】的错误信息，由调用方决定提示方式。
 * @param {Array<Object>} plans 计划数组
 * @param {Array<Object>} checkins 台账数组
 * @param {string} token GitHub Personal Access Token
 * @returns {Promise<void>}
 * @throws {Error} 网络异常或 HTTP 非 2xx 时抛出
 */
async function dispatchSync(plans, checkins, token) {
  const resp = await fetch(REPO_DISPATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      event_type: "sync-checkins",
      client_payload: { plans, checkins },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    if (resp.status === 401) {
      throw new Error(
        "同步失败（401）：GitHub Token 无效或权限不足。请确认：①Token 未过期；" +
          "②Classic Token 需勾选 repo 权限；" +
          "③Fine-grained Token 需在 Account/Repository 授予 Contents:read&write 与 Metadata:read。"
      );
    }
    if (resp.status === 403) {
      throw new Error(
        "同步失败（403）：Token 无权限或触发频率限制，请检查权限或稍后重试。"
      );
    }
    throw new Error("HTTP " + resp.status + " " + errText);
  }
}

/**
 * 数据变更后的自动同步（防抖 800ms，把连续操作合并成一次请求）。
 * 未配置 token 时静默跳过；只有失败才弹 toast，成功不打扰。
 * @returns {void}
 */
function scheduleAutoSync() {
  // 提前探测：拿不到 token 就完全不排期，保持静默
  if (!resolveToken()) return;

  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(async () => {
    // 延时到点后重新取一次 token 与数据，保证同步的是最终状态
    const token = resolveToken();
    if (!token) return;
    try {
      await dispatchSync(loadPlans(), loadCheckins(), token);
    } catch (err) {
      console.error("自动同步失败：", err);
      showToast(err.message, "error");
    }
  }, AUTO_SYNC_DELAY);
}

/**
 * 手动同步：点击「同步到仓库」按钮时触发，成功 / 失败都给 toast。
 * @returns {Promise<void>}
 */
async function syncToRepo() {
  const token = resolveToken();
  if (!token) {
    showToast("请先在管理页填写 Personal Access Token", "error");
    return;
  }

  const syncBtn = document.getElementById("sync-btn");
  const originalText = syncBtn ? syncBtn.textContent : "";
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.textContent = "同步中…";
  }

  try {
    await dispatchSync(loadPlans(), loadCheckins(), token);
    showToast("已触发同步，仓库稍后更新", "success");
  } catch (err) {
    console.error("同步失败：", err);
    showToast(err.message, "error");
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = originalText || "同步到仓库";
    }
  }
}

// ============================ 展示辅助 ============================

/**
 * 生成计划的频率 + 时间 + 日期的中文描述，用于列表展示。
 * @param {{freq:string, time:string, day:number}} plan 计划对象
 * @returns {string} 形如 "每周 · 周三 · 08:00"
 */
function describePlan(plan) {
  const parts = [];
  if (plan.freq === "weekly") {
    parts.push("每周", WEEKDAY_LABELS[Number(plan.day)] || "周一");
  } else if (plan.freq === "monthly") {
    // 「每月」已含在日期描述里，避免出现「每月 · 每月28日」这种重复
    parts.push(`每月${Number(plan.day) || 1}日`);
  } else {
    parts.push(FREQ_LABELS[plan.freq] || "每日");
  }
  parts.push(plan.time || "08:00");
  return parts.join(" · ");
}
