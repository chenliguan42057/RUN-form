/**
 * 星河自律 · RUN-form v3 —— 共享数据层 / 计算层 / 同步层（store.js）
 *
 * 三个页面（index.html + app.js / manage.html + app2.js / stats.html + app3.js）共用本文件，
 * 加载顺序固定为：store.js → components.js → appN.js。
 *
 * 设计约束（v2 沿用，不可违背）：
 * - 纯全局函数，不使用任何模块系统（无 import/export），直接挂在全局作用域；
 * - 业务数据存于浏览器 localStorage，无后端；
 * - Token 只存本机 localStorage，只通过 Authorization 头发给 GitHub；
 * - 本文件负责定义 showToast / formatTime / genId / escapeHtml，
 *   页面脚本只能【使用】它们，绝不能重复声明（否则会 "already declared" 报错）。
 *
 * ⚠️ 三条最容易写错的约定（v3 强化）：
 * 1. weekday 双体系：plan.day 永远是 Python 口径（周一=0, 周日=6）。
 *    JS 侧比较必须换算：jsDow = (plan.day + 1) % 7，再与 date.getDay() 比较。
 * 2. 本文件【禁止】声明 `const $`（那是页面脚本的名字，重复声明会白屏）。
 * 3. 任何进 innerHTML 的用户数据必须先过 escapeHtml()。
 *
 * ⚠️ 数据流单向性：
 *    localStorage ──写──> data/plans.json / data/checkins.json （经 sync.yml）
 *    data/reminder-state.json ──只读──> 前端渲染
 *    前端【永不写】reminder-state.json。
 */

// ============================ 常量：存储键与端点 ============================

/** 计划列表在 localStorage 中的键名（v2 沿用，不可改） */
const PLAN_KEY = "runform_plans";
/** 打卡台账在 localStorage 中的键名（沿用 v1/v2，保证老数据不丢） */
const CHECKIN_KEY = "runform_checkins";
/** Personal Access Token 在 localStorage 中的键名（v2 沿用，不可改） */
const TOKEN_KEY = "runform_pat";
/** UI 偏好设置在 localStorage 中的键名（v3 新增） */
const PREFS_KEY = "runform_prefs";
/** 提醒状态的本地缓存键（fetch 失败时降级读它，v3 新增） */
const REMINDER_CACHE_KEY = "runform_reminder_cache";
/** 提醒状态文件的【同源相对路径】——前端只读，绝不写 */
const REMINDER_STATE_URL = "data/reminder-state.json";
/** GitHub repository_dispatch 接口地址 */
const REPO_DISPATCH_URL =
  "https://api.github.com/repos/chenliguan42057/RUN-form/dispatches";
/** 自动同步防抖窗口（毫秒）：连续操作只在最后一次后统一同步 */
const AUTO_SYNC_DELAY = 800;
/** 一天的毫秒数 */
const DAY_MS = 86400000;

// ============================ 常量：文案与色板 ============================

/** 频率中文标签映射 */
const FREQ_LABELS = {
  daily: "每日",
  weekly: "每周",
  monthly: "每月",
};

/** 星期中文标签（索引 = 周一为 0 的星期号，与 Python datetime.weekday() 一致） */
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/**
 * 主题色板：key → 渐变与光晕。与 styles.css 的 .theme-<key> 一一对应。
 * glow 存的是 "R,G,B" 裸值，方便在 CSS 里写 rgba(var(--t-glow), .5)。
 */
const COLOR_THEMES = {
  gold: { label: "麦田金", from: "#f2c14e", to: "#e0a82e", glow: "242,193,78" },
  blue: { label: "星夜蓝", from: "#4a86d8", to: "#1b3a6b", glow: "74,134,216" },
  teal: { label: "海潮青", from: "#2a9d8f", to: "#1d6f74", glow: "42,157,143" },
  violet: { label: "暮夜紫", from: "#8b7ae8", to: "#4b3f9e", glow: "139,122,232" },
  rose: { label: "杏花粉", from: "#e58ba6", to: "#a13b5e", glow: "229,139,166" },
  amber: { label: "落日橙", from: "#f0954a", to: "#b4551a", glow: "240,149,74" },
};

/** 主题色 key 列表，用于按 id 哈希稳定派生配色 */
const COLOR_KEYS = Object.keys(COLOR_THEMES);

/**
 * emoji 图标预设（管理页选择器用，32 个，4 组 × 8）。
 * ⚠️ 与 .github/workflows/dingtalk-reminder.yml 无关（那边不用图标预设），
 *    但与 components.js 的 uiIconPicker 共用，改动只需改这里。
 */
const ICON_PRESETS = [
  "🏃", "🚶", "🏋️", "🧘", "🚴", "🏊", "⛹️", "🤸", // 运动
  "📖", "✍️", "💻", "🎨", "🎹", "🎸", "🧠", "🌱", // 学习创作
  "💧", "🍎", "🥗", "💊", "😴", "☕", "🦷", "🧴", // 健康
  "🧹", "🧺", "💰", "📞", "🐕", "⏰", "🎯", "🌙", // 生活
];

/**
 * 梵高书信风格鼓励语（仪表盘与钉钉消息共用）。
 * ⚠️ 与 .github/workflows/dingtalk-reminder.yml 里的 QUOTES 保持一致，改动必须两边同步。
 */
const VAN_GOGH_QUOTES = [
  "我梦见我的画，然后我画我的梦。",
  "伟大的事，由一系列小事汇聚而成。",
  "如果心里有个声音说「你做不到」，那就去做，那个声音自会沉默。",
  "我总在追寻，却从不到达；我总在跋涉，却从不停息。",
  "星星让我做梦。",
  "我宁愿死于热情，也不愿死于无聊。",
  "普通的日子里，也藏着值得画下来的光。",
  "别灰心，明天太阳照常升起，而我们照常出发。",
  "去爱尽可能多的事物，真正的力量就藏在那里。",
  "我心中有一团火，路过的人只看到烟。",
  "画家不该被画布上的空白吓倒。",
  "只要还在走，路就没有尽头。",
];

/** 热力图分档阈值：count >= 阈值 即进入该档（从高到低匹配）→ level 0/1/2/3/4 */
const HEATMAP_LEVELS = [0, 1, 2, 4, 6];

/** 里程碑徽章定义（统计页用） */
const MILESTONES = [
  { days: 7, icon: "🌱", name: "破土", desc: "连续 7 天" },
  { days: 21, icon: "🌿", name: "成习", desc: "连续 21 天" },
  { days: 30, icon: "🌻", name: "向日葵", desc: "连续 30 天" },
  { days: 100, icon: "🌌", name: "星河", desc: "连续 100 天" },
  { days: 365, icon: "👑", name: "岁轮", desc: "连续 365 天" },
];

/**
 * 时段问候（仪表盘与钉钉消息共用），按本地时间小时取。
 * from > to 表示跨零点区间（22:00 ~ 次日 04:59）。
 */
const GREETINGS = [
  { from: 5, to: 8, emoji: "🌅", text: "早安" },
  { from: 9, to: 11, emoji: "☀️", text: "上午好" },
  { from: 12, to: 13, emoji: "🌻", text: "午安" },
  { from: 14, to: 17, emoji: "🌤", text: "下午好" },
  { from: 18, to: 21, emoji: "🌌", text: "晚上好" },
  { from: 22, to: 4, emoji: "🌙", text: "夜深了" },
];

/** UI 偏好默认值 */
const DEFAULT_PREFS = {
  /** 是否显示「标记完成」二级按钮（Q1：默认显示，管理页可关） */
  showManualCheckin: true,
  /** 热力图数据源：'all' 叠加 | 'auto' 仅提醒送达 | 'manual' 仅手动完成 */
  heatmapSource: "all",
  /** 手动关闭动效（等同系统的 prefers-reduced-motion: reduce） */
  reduceMotion: false,
};

// ============================ 内部状态 ============================

/** toast 自动隐藏定时器句柄 */
let toastTimer = null;
/** 自动同步防抖定时器句柄 */
let autoSyncTimer = null;
/** 提醒状态原始对象：{ "YYYY-MM-DD|planId": epochSeconds } */
let reminderSentRaw = {};
/** 提醒状态倒排索引：dateKey → Set<planId> */
let reminderLogMap = new Map();
/** 提醒状态元信息 */
let reminderMeta = { loaded: false, fromCache: false, fetchedAt: 0 };

// ============================ 基础工具（v2 签名不变） ============================

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

/**
 * 安全写 localStorage：隐私模式 / 配额满时不抛错，只提示，页面仍可只读浏览。
 * @param {string} key 键名
 * @param {string} value 值（已序列化）
 * @returns {boolean} 是否写入成功
 */
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.error("写入本地存储失败：", e);
    showToast("浏览器存储不可用，本次改动未能保存", "error");
    return false;
  }
}

/**
 * 安全读 localStorage：任何异常都返回 null，不让页面崩掉。
 * @param {string} key 键名
 * @returns {string|null}
 */
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error("读取本地存储失败：", e);
    return null;
  }
}

// ============================ v3 工具函数 ============================

/**
 * 简易 DJB2 哈希，返回非负整数。用于按 id 稳定派生主题色。
 * 同一个 id 每次调用结果恒定，老计划因此获得固定不跳变的配色。
 * @param {string} str 输入字符串
 * @returns {number} 非负整数
 */
function hashString(str) {
  const s = String(str == null ? "" : str);
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    // hash * 33 + charCode，用 |0 保持 32 位整数运算
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * 归一到当天 00:00:00.000（本地时区）。
 * 支持 Date / 毫秒时间戳 / 'YYYY-MM-DD' 字符串三种输入。
 * ⚠️ 'YYYY-MM-DD' 必须手工解析：new Date('2026-08-06') 会被当成 UTC，导致时区偏移一天。
 * @param {Date|number|string} [input] 输入，缺省为当前时间
 * @returns {Date} 当天零点的 Date 对象
 */
function startOfDay(input) {
  let d;
  if (input instanceof Date) {
    d = new Date(input.getTime());
  } else if (typeof input === "number" && Number.isFinite(input)) {
    d = new Date(input);
  } else if (typeof input === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
    d = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(input);
  } else {
    d = new Date();
  }
  if (isNaN(d.getTime())) d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 任意 Date / 时间戳 / 日期串 → 本地时区 'YYYY-MM-DD'。
 * 全站日期归一化的唯一入口，热力图 / streak / 完成率都靠它对齐。
 * @param {Date|number|string} [input] 输入，缺省为今天
 * @returns {string} 'YYYY-MM-DD'
 */
function dateKey(input) {
  const d = startOfDay(input);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 解析 'HH:MM' 时间串。
 * @param {string} time 形如 '07:30'
 * @returns {{h:number, m:number}} 非法输入兜底 {h:8, m:0}
 */
function parseHHMM(time) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(time || "").trim());
  if (!m) return { h: 8, m: 0 };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return { h: 8, m: 0 };
  }
  return { h, m: min };
}

/**
 * 两个日期相差的整天数（按 startOfDay 计，b - a）。
 * @param {Date|number|string} a 起始日期
 * @param {Date|number|string} b 结束日期
 * @returns {number} 整天数，b 早于 a 时为负
 */
function daysBetween(a, b) {
  const t1 = startOfDay(a).getTime();
  const t2 = startOfDay(b).getTime();
  return Math.round((t2 - t1) / DAY_MS);
}

/**
 * 取某个 Date 的「Python 口径星期号」：周一 = 0，周日 = 6。
 * ⚠️ JS 原生 getDay() 是周日 = 0，两者差一位，务必用本函数或 (plan.day + 1) % 7 换算。
 * @param {Date|number|string} input 日期
 * @returns {number} 0~6
 */
function pyWeekday(input) {
  return (startOfDay(input).getDay() + 6) % 7;
}

/**
 * 取计划的主题配色。plan.color 非法时按 hashString(plan.id) 稳定派生。
 * ⚠️ 这是唯一取色入口，页面脚本禁止直接读 plan.color。
 * @param {Object} plan 计划对象
 * @returns {{key:string, label:string, from:string, to:string, glow:string}}
 */
function themeOf(plan) {
  const p = plan || {};
  let key = typeof p.color === "string" ? p.color : "";
  if (!Object.prototype.hasOwnProperty.call(COLOR_THEMES, key)) {
    key = COLOR_KEYS[hashString(p.id || p.name || "") % COLOR_KEYS.length];
  }
  const theme = COLOR_THEMES[key];
  return { key, label: theme.label, from: theme.from, to: theme.to, glow: theme.glow };
}

/**
 * 按小时返回时段问候。
 * @param {Date} [date] 参考时间，缺省为现在
 * @returns {{emoji:string, text:string}}
 */
function greetingNow(date) {
  const d = date instanceof Date ? date : new Date();
  const hour = d.getHours();
  for (const g of GREETINGS) {
    if (g.from <= g.to) {
      if (hour >= g.from && hour <= g.to) return { emoji: g.emoji, text: g.text };
    } else if (hour >= g.from || hour <= g.to) {
      // 跨零点区间，例如 22 ~ 4
      return { emoji: g.emoji, text: g.text };
    }
  }
  return { emoji: "🌙", text: "夜深了" };
}

/**
 * 从 VAN_GOGH_QUOTES 取一条语录。
 * @param {string} [seed] 传入 seed（如 dateKey()）时当天恒定；不传则真随机
 * @returns {string} 语录文本
 */
function randomQuote(seed) {
  if (seed === undefined || seed === null || seed === "") {
    return VAN_GOGH_QUOTES[Math.floor(Math.random() * VAN_GOGH_QUOTES.length)];
  }
  return VAN_GOGH_QUOTES[hashString(seed) % VAN_GOGH_QUOTES.length];
}

/**
 * 把毫秒差格式化成人类可读的倒计时。
 * @param {number} ms 毫秒差
 * @returns {string} "3 小时 12 分" / "18 分钟" / "已到时间"
 */
function formatCountdown(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return "已到时间";
  const totalMin = Math.floor(v / 60000);
  if (totalMin < 1) return "不到 1 分钟";
  if (totalMin < 60) return `${totalMin} 分钟`;
  const totalHour = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (totalHour < 24) {
    return min > 0 ? `${totalHour} 小时 ${min} 分` : `${totalHour} 小时`;
  }
  const days = Math.floor(totalHour / 24);
  const hour = totalHour % 24;
  return hour > 0 ? `${days} 天 ${hour} 小时` : `${days} 天`;
}

// ============================ 偏好设置（v3） ============================

/**
 * 读取 UI 偏好，缺失字段用 DEFAULT_PREFS 补全。
 * @returns {{showManualCheckin:boolean, heatmapSource:string, reduceMotion:boolean}}
 */
function loadPrefs() {
  let raw = null;
  try {
    const text = safeGetItem(PREFS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch (e) {
    console.error("读取偏好失败，已回退默认值：", e);
    raw = null;
  }
  const src = raw && typeof raw === "object" ? raw : {};
  const source = ["all", "auto", "manual"].indexOf(src.heatmapSource) >= 0
    ? src.heatmapSource
    : DEFAULT_PREFS.heatmapSource;
  return {
    showManualCheckin:
      src.showManualCheckin === undefined
        ? DEFAULT_PREFS.showManualCheckin
        : src.showManualCheckin !== false,
    heatmapSource: source,
    reduceMotion: src.reduceMotion === true,
  };
}

/**
 * 合并写入 UI 偏好（浅合并 patch）。
 * @param {Object} patch 要合并的字段
 * @returns {Object} 合并后的完整偏好
 */
function savePrefs(patch) {
  const next = Object.assign({}, loadPrefs(), patch && typeof patch === "object" ? patch : {});
  safeSetItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

// ============================ 计划（Plan）数据层 ============================

/**
 * 读取计划列表，并对旧数据做字段补全（读时迁移，不改写 localStorage）。
 * 计划模型（v3）：
 *   {id, name, freq:'daily'|'weekly'|'monthly', time:'HH:MM', day, enabled,   ← v2 六字段
 *    icon, color, desc, createdAt}                                           ← v3 新增
 * - weekly：day = 星期号 0~6（周一 = 0，Python 口径）
 * - monthly：day = 每月第几日 1~31
 * - daily：day 忽略
 * @returns {Array<Object>} 计划数组
 */
function loadPlans() {
  let data = [];
  try {
    const raw = safeGetItem(PLAN_KEY);
    data = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("读取计划失败，已重置：", e);
    data = [];
  }
  if (!Array.isArray(data)) return [];

  return data
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const freq =
        item.freq === "weekly" || item.freq === "monthly" ? item.freq : "daily";
      // day 缺省值随频率而定：每周默认周一(0)，每月默认 1 日，每日不关心
      let day = Number(item.day);
      if (!Number.isFinite(day)) {
        day = freq === "monthly" ? 1 : 0;
      }
      const id = item.id || genId();

      // ---- v3 新增字段的读时补全 ----
      const icon =
        typeof item.icon === "string" && item.icon.trim() ? item.icon.trim() : "🌟";
      const color = Object.prototype.hasOwnProperty.call(COLOR_THEMES, item.color)
        ? item.color
        : COLOR_KEYS[hashString(id) % COLOR_KEYS.length];
      const desc = typeof item.desc === "string" ? item.desc : "";
      let createdAt = Number(item.createdAt);
      if (!Number.isFinite(createdAt) || createdAt <= 0) {
        // 老计划没有创建时间：按数组顺序反推一个稳定的伪时间（越靠前越早）
        createdAt = Date.now() - (data.length - index) * DAY_MS;
      }

      return { id, name: typeof item.name === "string" && item.name ? item.name : "未命名", freq, time: typeof item.time === "string" && item.time ? item.time : "08:00", day, enabled: item.enabled !== false, icon, color, desc, createdAt };
    });
}

/**
 * 写入计划列表。
 * @param {Array<Object>} list 计划数组
 * @returns {void}
 */
function savePlans(list) {
  safeSetItem(PLAN_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

/**
 * 新增一个计划。v3 扩展了 icon / color / desc / createdAt，调用方式与 v2 完全兼容。
 * @param {Object} fields 计划字段 {name, freq, time, day, enabled, icon, color, desc}
 * @returns {Object} 新建的完整计划对象（含 id）
 */
function addPlan(fields) {
  const f = fields && typeof fields === "object" ? fields : {};
  const list = loadPlans();
  const id = genId();
  const item = {
    id,
    name: f.name || "未命名",
    freq: f.freq === "weekly" || f.freq === "monthly" ? f.freq : "daily",
    time: f.time || "08:00",
    day: Number.isFinite(Number(f.day)) ? Number(f.day) : 0,
    enabled: f.enabled !== false,
    icon: typeof f.icon === "string" && f.icon.trim() ? f.icon.trim() : "🌟",
    color: Object.prototype.hasOwnProperty.call(COLOR_THEMES, f.color)
      ? f.color
      : COLOR_KEYS[hashString(id) % COLOR_KEYS.length],
    desc: typeof f.desc === "string" ? f.desc : "",
    createdAt: Date.now(),
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
  const list = loadPlans().map((p) => (p.id === id ? Object.assign({}, p, patch) : p));
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
    p.id === id ? Object.assign({}, p, { enabled: !p.enabled }) : p
  );
  savePlans(list);
}

/**
 * 生成计划的频率 + 时间 + 日期的中文描述，用于列表展示。
 * ⚠️ v2 签名与输出格式不变。
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

// ============================ 台账（Checkin）数据层 ============================

/**
 * 读取打卡台账，并迁移 v1 旧记录。
 * v1 记录形如 {id, ts, content}（没有 planId / planName），
 * 迁移策略：planId = null，planName = content || "历史记录"，note = ""。
 * v3 新增：planIcon（快照，计划删掉后台账仍有图标）、source（'manual' | 'auto'）。
 * @returns {Array<Object>} 台账数组
 */
function loadCheckins() {
  let data = [];
  try {
    const raw = safeGetItem(CHECKIN_KEY);
    data = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("读取台账失败，已重置：", e);
    data = [];
  }
  if (!Array.isArray(data)) return [];

  // 为补全 planIcon 做一次计划索引（按 planId 反查现存计划的图标）
  const iconById = new Map();
  try {
    loadPlans().forEach((p) => iconById.set(p.id, p.icon));
  } catch (e) {
    console.error("构建计划图标索引失败：", e);
  }

  return data
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      // 有 planName 说明已是 v2 结构；否则按 v1 的 content 字段迁移
      const planName =
        typeof item.planName === "string" && item.planName
          ? item.planName
          : (typeof item.content === "string" && item.content) || "历史记录";
      const planId = item.planId || null;
      const planIcon =
        typeof item.planIcon === "string" && item.planIcon
          ? item.planIcon
          : iconById.get(planId) || "✅";
      return {
        id: item.id || genId(),
        planId,
        planName,
        ts: Number(item.ts) || Date.now(),
        note: typeof item.note === "string" ? item.note : "",
        planIcon,
        source: item.source === "auto" ? "auto" : "manual",
      };
    });
}

/**
 * 写入打卡台账。
 * @param {Array<Object>} list 台账数组
 * @returns {void}
 */
function saveCheckins(list) {
  safeSetItem(CHECKIN_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

/**
 * 新增一条打卡记录（内容即计划名，不再有自由文本备注）。
 * v3 会顺带记录计划图标快照与来源，调用方式与 v2 完全兼容。
 * @param {string|null} planId 关联的计划 id
 * @param {string} planName 计划名称（作为打卡内容展示）
 * @returns {Object} 新建的记录
 */
function addCheckin(planId, planName) {
  const list = loadCheckins();
  const plan = planId ? loadPlans().find((p) => p.id === planId) : null;
  const item = {
    id: genId(),
    planId: planId || null,
    planName: planName || (plan && plan.name) || "未命名",
    ts: Date.now(),
    note: "",
    planIcon: (plan && plan.icon) || "✅",
    source: "manual",
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
  try {
    localStorage.removeItem(CHECKIN_KEY);
  } catch (e) {
    console.error("清空台账失败：", e);
    showToast("浏览器存储不可用，清空失败", "error");
  }
}

// ============================ v3 计划调度计算 ============================

/**
 * 判断某个计划在给定日期是否「应当触发」。
 * 规则：daily 恒真；weekly 需星期匹配；monthly 需日期匹配（短月兜底到当月最后一天）。
 * plan.enabled === false 时恒假。
 * @param {Object} plan 计划对象
 * @param {Date|string|number} date 日期
 * @returns {boolean}
 */
function isPlanDueOn(plan, date) {
  if (!plan || plan.enabled === false) return false;
  const d = startOfDay(date);
  const freq = plan.freq === "weekly" || plan.freq === "monthly" ? plan.freq : "daily";

  if (freq === "daily") return true;

  if (freq === "weekly") {
    // ⚠️ weekday 双体系：plan.day 是 Python 口径（周一=0），
    //    JS 的 getDay() 是周日=0 → 换算 jsDow = (plan.day + 1) % 7
    const jsDow = ((Number(plan.day) || 0) + 1) % 7;
    return d.getDay() === jsDow;
  }

  // monthly：短月兜底。2 月的「31 日」按当月最后一天判定，避免静默漏推
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const wanted = Math.min(Math.max(Number(plan.day) || 1, 1), lastDay);
  return d.getDate() === wanted;
}

/**
 * 计算某计划从 fromTs 起的下一次提醒时刻。
 * 搜索范围与 Python 侧完全一致：daily 看 2 天 / weekly 看 8 天 / monthly 看 13 个月。
 * @param {Object} plan 计划对象
 * @param {number} [fromTs=Date.now()] 起算时间戳
 * @returns {{ts:number, dateKey:string, human:string, diffMs:number, isToday:boolean}|null}
 *          plan.enabled === false 或找不到时返回 null
 */
function nextReminder(plan, fromTs) {
  if (!plan || plan.enabled === false) return null;
  const from = Number.isFinite(Number(fromTs)) ? Number(fromTs) : Date.now();
  const hm = parseHHMM(plan.time);
  const base = startOfDay(from);
  const freq = plan.freq === "weekly" || plan.freq === "monthly" ? plan.freq : "daily";

  /**
   * 组装返回值。
   * @param {Date} target 目标时刻
   * @returns {Object}
   */
  const build = (target) => {
    const ts = target.getTime();
    const diffDays = daysBetween(from, target);
    const pad = (n) => String(n).padStart(2, "0");
    const hhmm = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
    let human;
    if (diffDays <= 0) {
      human = `今天 ${hhmm}`;
    } else if (diffDays === 1) {
      human = `明天 ${hhmm}`;
    } else if (diffDays < 7) {
      human = `${WEEKDAY_LABELS[pyWeekday(target)]} ${hhmm}（${diffDays} 天后）`;
    } else {
      human = `${target.getMonth() + 1} 月 ${target.getDate()} 日 ${hhmm}`;
    }
    return {
      ts,
      dateKey: dateKey(target),
      human,
      diffMs: ts - from,
      isToday: diffDays <= 0,
    };
  };

  if (freq === "monthly") {
    for (let k = 0; k <= 12; k++) {
      const y = base.getFullYear();
      const mo = base.getMonth() + k;
      const lastDay = new Date(y, mo + 1, 0).getDate();
      const dd = Math.min(Math.max(Number(plan.day) || 1, 1), lastDay);
      const target = new Date(y, mo, dd, hm.h, hm.m, 0, 0);
      if (target.getTime() > from) return build(target);
    }
    return null;
  }

  const span = freq === "weekly" ? 8 : 2;
  for (let i = 0; i < span; i++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (!isPlanDueOn(plan, day)) continue;
    const target = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hm.h,
      hm.m,
      0,
      0
    );
    if (target.getTime() > from) return build(target);
  }
  return null;
}

/**
 * 列出某计划在 [fromTs, toTs] 区间内所有「应当触发」的日期。
 * 用作完成率的分母、streak 的回溯序列。
 * ⚠️ 依赖 isPlanDueOn，因此 enabled === false 的计划返回空数组（停用即不计入统计）。
 * @param {Object} plan 计划对象
 * @param {number} fromTs 起始时间戳
 * @param {number} toTs 结束时间戳
 * @returns {string[]} 升序的 'YYYY-MM-DD' 数组
 */
function planDueDates(plan, fromTs, toTs) {
  const result = [];
  if (!plan) return result;
  const start = startOfDay(fromTs);
  const end = startOfDay(toTs);
  if (end.getTime() < start.getTime()) return result;

  // 安全阀：最多枚举 800 天，防止误传时间戳导致死循环
  const maxDays = Math.min(daysBetween(start, end), 800);
  for (let i = 0; i <= maxDays; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (isPlanDueOn(plan, d)) result.push(dateKey(d));
  }
  return result;
}

/**
 * 今日视图：今天应当触发的计划，按提醒时间升序，并附加运行时状态。
 * @returns {Array<Object>} 每项 = { ...plan, dueTs, dueTime, passed, done, doneAuto, doneManual, next, theme }
 */
function todayPlans() {
  const now = Date.now();
  const today = new Date();
  const tk = dateKey(today);

  const autoSet = getReminderLog().get(tk) || new Set();
  const manualSet = new Set(
    loadCheckins()
      .filter((c) => c.planId && dateKey(c.ts) === tk)
      .map((c) => c.planId)
  );

  return loadPlans()
    .filter((p) => isPlanDueOn(p, today))
    .map((p) => {
      const hm = parseHHMM(p.time);
      const dueTs = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        hm.h,
        hm.m,
        0,
        0
      ).getTime();
      const doneAuto = autoSet.has(p.id);
      const doneManual = manualSet.has(p.id);
      return Object.assign({}, p, {
        dueTs,
        dueTime: p.time || "08:00",
        passed: dueTs <= now,
        done: doneAuto || doneManual,
        doneAuto,
        doneManual,
        next: nextReminder(p, now),
        theme: themeOf(p),
      });
    })
    .sort((a, b) => a.dueTs - b.dueTs);
}

// ============================ v3 活动数据与统计 ============================

/**
 * 把 reminder-state 的 sent 对象重建成倒排索引 dateKey → Set<planId>。
 * @param {Object} sent 形如 {"2026-08-06|planId": 1754460000}
 * @returns {void}
 */
function rebuildReminderLog(sent) {
  reminderSentRaw = sent && typeof sent === "object" ? sent : {};
  reminderLogMap = new Map();
  Object.keys(reminderSentRaw).forEach((key) => {
    const sep = key.indexOf("|");
    if (sep <= 0) return;
    const d = key.slice(0, sep);
    const planId = key.slice(sep + 1);
    if (!planId) return;
    if (!reminderLogMap.has(d)) reminderLogMap.set(d, new Set());
    reminderLogMap.get(d).add(planId);
  });
}

// 页面加载时先用本地缓存把索引填上，保证首屏（fetch 未回来前）也有数据可渲染
(function initReminderCache() {
  try {
    const raw = safeGetItem(REMINDER_CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    if (cached && typeof cached === "object") {
      rebuildReminderLog(cached.sent);
      reminderMeta = {
        loaded: false,
        fromCache: true,
        fetchedAt: Number(cached.fetchedAt) || 0,
      };
    }
  } catch (e) {
    console.error("提醒状态缓存解析失败，已忽略：", e);
  }
})();

/**
 * 异步拉取 data/reminder-state.json（同源，只读）。
 * 成功后写入 localStorage 缓存并更新内存索引；
 * 失败（file:// / 404 / 网络）时静默降级读缓存，绝不抛错。
 * @returns {Promise<{sent:Object, fromCache:boolean, fetchedAt:number}>}
 */
async function loadReminderLog() {
  try {
    const resp = await fetch(`${REMINDER_STATE_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const sent = data && typeof data.sent === "object" && data.sent ? data.sent : {};
    rebuildReminderLog(sent);
    reminderMeta = { loaded: true, fromCache: false, fetchedAt: Date.now() };
    safeSetItem(
      REMINDER_CACHE_KEY,
      JSON.stringify({ sent, fetchedAt: reminderMeta.fetchedAt })
    );
    return { sent, fromCache: false, fetchedAt: reminderMeta.fetchedAt };
  } catch (e) {
    // 本地 file:// 预览、首次部署文件还不存在、断网……都会走到这里，属于预期降级
    console.warn("提醒状态获取失败，降级使用本地缓存：", e);
    reminderMeta = {
      loaded: true,
      fromCache: true,
      fetchedAt: reminderMeta.fetchedAt || 0,
    };
    return {
      sent: reminderSentRaw,
      fromCache: true,
      fetchedAt: reminderMeta.fetchedAt,
    };
  }
}

/**
 * 同步读取当前内存/缓存中的提醒记录，供渲染函数直接使用。
 * @returns {Map<string, Set<string>>} dateKey → Set<planId>
 */
function getReminderLog() {
  return reminderLogMap;
}

/**
 * 提醒数据的加载状态，供页面显示「本地预览模式 / 等待首次提醒」提示。
 * @returns {{loaded:boolean, fromCache:boolean, fetchedAt:number, size:number}}
 */
function reminderStatus() {
  return {
    loaded: reminderMeta.loaded,
    fromCache: reminderMeta.fromCache,
    fetchedAt: reminderMeta.fetchedAt,
    size: Object.keys(reminderSentRaw).length,
  };
}

/**
 * 汇总「活动日历」：手动打卡 + 自动提醒送达。
 * @param {{planId?:string, source?:'all'|'auto'|'manual'}} [opts] 过滤条件
 * @returns {Map<string, {count:number, manual:number, auto:number, plans:Set<string>}>}
 *          key = 'YYYY-MM-DD'
 */
function buildActivityMap(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const planId = o.planId || null;
  const source = ["auto", "manual"].indexOf(o.source) >= 0 ? o.source : "all";
  const map = new Map();

  /**
   * 往 map 里累加一条活动。
   * @param {string} key 日期键
   * @param {string} pid 计划 id
   * @param {'auto'|'manual'} kind 来源
   */
  const bump = (key, pid, kind) => {
    if (!map.has(key)) {
      map.set(key, { count: 0, manual: 0, auto: 0, plans: new Set() });
    }
    const cell = map.get(key);
    cell.count += 1;
    cell[kind] += 1;
    if (pid) cell.plans.add(pid);
  };

  // 自动：提醒送达
  if (source === "all" || source === "auto") {
    getReminderLog().forEach((planSet, key) => {
      planSet.forEach((pid) => {
        if (planId && pid !== planId) return;
        bump(key, pid, "auto");
      });
    });
  }

  // 手动：本地打卡记录
  if (source === "all" || source === "manual") {
    loadCheckins().forEach((c) => {
      if (c.source === "auto") return; // 理论上本地不会有 auto 记录，防御性跳过
      if (planId && c.planId !== planId) return;
      bump(dateKey(c.ts), c.planId, "manual");
    });
  }

  return map;
}

/**
 * 构建热力图数据（GitHub 风格：按周分列，周一在最上面一行）。
 * @param {number} [days=182] 回溯天数（仪表盘 84 ≈ 12 周；统计页 371 ≈ 53 周）
 * @param {{planId?:string, source?:string}} [opts] 过滤条件
 * @returns {Object} HeatmapData
 */
function buildHeatmap(days, opts) {
  const span = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.floor(Number(days)) : 182;
  const activity = buildActivityMap(opts);

  const end = startOfDay(new Date());
  const rawStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (span - 1));
  // 对齐到周一，保证每一列都是完整的一周
  const gridStart = new Date(
    rawStart.getFullYear(),
    rawStart.getMonth(),
    rawStart.getDate() - pyWeekday(rawStart)
  );

  const totalDays = daysBetween(gridStart, end) + 1;
  const weeks = Math.ceil(totalDays / 7);

  const cells = [];
  const monthTicks = [];
  let lastTickMonth = -1;
  let max = 0;
  let total = 0;
  let activeDays = 0;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = dateKey(d);
    const hit = activity.get(key);
    const count = hit ? hit.count : 0;
    const manual = hit ? hit.manual : 0;
    const auto = hit ? hit.auto : 0;

    // 从高到低匹配阈值：count>=6→4, >=4→3, >=2→2, >=1→1, 否则 0
    let level = 0;
    for (let li = HEATMAP_LEVELS.length - 1; li >= 0; li--) {
      if (count >= HEATMAP_LEVELS[li] && HEATMAP_LEVELS[li] > 0) {
        level = li;
        break;
      }
    }

    const col = Math.floor(i / 7);
    const row = i % 7; // gridStart 已对齐周一，因此 row 直接等于 pyWeekday

    if (count > 0) {
      activeDays += 1;
      total += count;
      if (count > max) max = count;
    }

    // 每月第一次出现（在周一那一行）时打一个月份刻度
    if (row === 0 && d.getMonth() !== lastTickMonth) {
      lastTickMonth = d.getMonth();
      monthTicks.push({ col, label: `${d.getMonth() + 1} 月` });
    }

    cells.push({
      date: key,
      ts: d.getTime(),
      count,
      level,
      manual,
      auto,
      col,
      row,
      future: d.getTime() > end.getTime(),
    });
  }

  return {
    cells,
    weeks,
    max,
    total,
    activeDays,
    startDate: dateKey(gridStart),
    endDate: dateKey(end),
    monthTicks,
  };
}

/**
 * 计算某计划的连续记录。
 * 语义：按「该计划的应触发日序列」回溯，而非自然日——
 *   daily 计「连续 N 天」，weekly 计「连续 N 周」，monthly 计「连续 N 月」。
 * 今日若尚未到点，从上一个应触发日开始回溯（不因「今天还没到」判断中断）。
 * @param {string} planId 计划 id
 * @returns {{current:number, best:number, unit:string, lastDate:(string|null)}}
 */
function computeStreak(planId) {
  const plan = loadPlans().find((p) => p.id === planId) || null;
  const unit = !plan
    ? "天"
    : plan.freq === "weekly"
    ? "周"
    : plan.freq === "monthly"
    ? "月"
    : "天";
  if (!plan) return { current: 0, best: 0, unit, lastDate: null };

  const now = Date.now();
  // 回溯上限：创建时间与 2 年前取较晚者，避免枚举过多天数
  const floor = now - 730 * DAY_MS;
  const from = Math.max(Number(plan.createdAt) || floor, floor);
  const dues = planDueDates(plan, from, now);
  if (dues.length === 0) return { current: 0, best: 0, unit, lastDate: null };

  const activity = buildActivityMap({ planId });
  const todayKey = dateKey(now);
  const seq = dues.slice();

  // 今天是应触发日但还没到点、且尚无活动 → 从序列里摘掉，不算「中断」
  if (seq[seq.length - 1] === todayKey && !activity.has(todayKey)) {
    const hm = parseHHMM(plan.time);
    const today = new Date();
    const dueTs = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      hm.h,
      hm.m,
      0,
      0
    ).getTime();
    if (dueTs > now) seq.pop();
  }

  let current = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (activity.has(seq[i])) current += 1;
    else break;
  }

  let best = 0;
  let run = 0;
  let lastDate = null;
  for (const key of dues) {
    if (activity.has(key)) {
      run += 1;
      if (run > best) best = run;
      lastDate = key;
    } else {
      run = 0;
    }
  }

  return { current, best: Math.max(best, current), unit, lastDate };
}

/**
 * 全站总连续天数（任意计划在某个自然日有活动，即算「这一天亮着」）。
 * 今天还没有任何活动时，从昨天开始回溯（当天进行中不算断）。
 * @returns {{current:number, best:number}}
 */
function globalStreak() {
  const map = buildActivityMap();
  if (map.size === 0) return { current: 0, best: 0 };

  const cursor = startOfDay(new Date());
  if (!map.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let current = 0;
  while (map.has(dateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const keys = Array.from(map.keys()).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of keys) {
    run = prev && daysBetween(prev, key) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = key;
  }

  return { current, best: Math.max(best, current) };
}

/**
 * 计算某计划在最近 days 天的完成率。
 * 分母是「应触发日」而非自然日；早于计划创建时间的日子不计入，避免新计划一上来就 0%。
 * @param {string} planId 计划 id
 * @param {number} [days=30] 统计窗口
 * @returns {{done:number, expected:number, missed:number, rate:number}}
 */
function completionRate(planId, days) {
  const span = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.floor(Number(days)) : 30;
  const plan = loadPlans().find((p) => p.id === planId) || null;
  if (!plan) return { done: 0, expected: 0, missed: 0, rate: 0 };

  const now = Date.now();
  const windowStart = startOfDay(now - (span - 1) * DAY_MS).getTime();
  const createdAt = Number(plan.createdAt);
  const from = Number.isFinite(createdAt)
    ? Math.max(windowStart, startOfDay(createdAt).getTime())
    : windowStart;

  const dues = planDueDates(plan, from, now);
  const activity = buildActivityMap({ planId });
  const todayKey = dateKey(now);
  const seq = dues.slice();

  // 今天还没到点的，不计入分母
  if (seq[seq.length - 1] === todayKey && !activity.has(todayKey)) {
    const hm = parseHHMM(plan.time);
    const today = new Date();
    const dueTs = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      hm.h,
      hm.m,
      0,
      0
    ).getTime();
    if (dueTs > now) seq.pop();
  }

  const expected = seq.length;
  const done = seq.filter((key) => activity.has(key)).length;
  return {
    done,
    expected,
    missed: Math.max(expected - done, 0),
    rate: expected > 0 ? done / expected : 0,
  };
}

/**
 * 仪表盘顶部概览指标。
 * @returns {Object} OverviewStats
 */
function overviewStats() {
  const plans = loadPlans();
  const active = plans.filter((p) => p.enabled !== false);
  const today = todayPlans();
  const streak = globalStreak();

  // 30 天完成率：所有启用计划的「应完成 / 已完成」总量之比（而非各计划百分比的平均）
  let doneSum = 0;
  let expectedSum = 0;
  active.forEach((p) => {
    const r = completionRate(p.id, 30);
    doneSum += r.done;
    expectedSum += r.expected;
  });

  // 下一个将要提醒的计划
  let nextUp = null;
  const now = Date.now();
  active.forEach((p) => {
    const info = nextReminder(p, now);
    if (!info) return;
    if (!nextUp || info.ts < nextUp.info.ts) nextUp = { plan: p, info };
  });

  return {
    planTotal: plans.length,
    planActive: active.length,
    todayDue: today.length,
    todayDone: today.filter((v) => v.done).length,
    streak: streak.current,
    streakBest: streak.best,
    rate30: expectedSum > 0 ? doneSum / expectedSum : 0,
    totalActive: buildActivityMap().size, // 有记录的自然日总数
    nextUp,
  };
}

/**
 * 近 N 天每日活动数，供统计页趋势折线使用。
 * @param {number} [days=30] 天数
 * @returns {Array<{date:string, count:number, label:string}>} 升序
 */
function dailyTrend(days) {
  const span = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.floor(Number(days)) : 30;
  const activity = buildActivityMap();
  const end = startOfDay(new Date());
  const out = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const key = dateKey(d);
    const hit = activity.get(key);
    out.push({
      date: key,
      count: hit ? hit.count : 0,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
    });
  }
  return out;
}

/**
 * 里程碑徽章解锁情况（按全站最佳连续天数判定）。
 * @returns {Array<Object>} 每项 = {...MILESTONES 项, unlocked:boolean, progress:number, reached:number}
 */
function milestones() {
  const streak = globalStreak();
  const reached = Math.max(streak.current, streak.best);
  return MILESTONES.map((m) =>
    Object.assign({}, m, {
      unlocked: reached >= m.days,
      progress: Math.min(1, m.days > 0 ? reached / m.days : 0),
      reached,
    })
  );
}

// ============================ 备份 / 恢复（v3） ============================

/**
 * 导出全量数据为 JSON 字符串（计划 + 台账 + 偏好，**不含 token**）。
 * @returns {string} 格式化后的 JSON 文本
 */
function exportData() {
  const payload = {
    version: 3,
    exportedAt: Date.now(),
    plans: loadPlans(),
    checkins: loadCheckins(),
    prefs: loadPrefs(),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 从 JSON 字符串导入并覆盖 / 合并本地数据。
 * @param {string} json 导入内容
 * @param {{merge?:boolean}} [opts] merge=true 时按 id 合并，false（默认）时整体覆盖
 * @returns {{plans:number, checkins:number}} 导入后本地的条数
 * @throws {Error} 解析失败或结构非法时抛出可直接展示给用户的错误
 */
function importData(json, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  let data;
  try {
    data = JSON.parse(String(json || ""));
  } catch (e) {
    throw new Error("导入失败：文件不是合法的 JSON。");
  }
  if (!data || typeof data !== "object") {
    throw new Error("导入失败：文件内容不是一个对象。");
  }
  const incomingPlans = Array.isArray(data.plans) ? data.plans.filter((x) => x && typeof x === "object") : null;
  const incomingCheckins = Array.isArray(data.checkins)
    ? data.checkins.filter((x) => x && typeof x === "object")
    : null;
  if (!incomingPlans && !incomingCheckins) {
    throw new Error("导入失败：文件里既没有 plans 也没有 checkins 字段。");
  }

  if (o.merge) {
    // 合并：以本地为底，同 id 用导入数据覆盖，新 id 追加
    if (incomingPlans) {
      const byId = new Map(loadPlans().map((p) => [p.id, p]));
      incomingPlans.forEach((p) => {
        const id = p.id || genId();
        byId.set(id, Object.assign({}, byId.get(id) || {}, p, { id }));
      });
      savePlans(Array.from(byId.values()));
    }
    if (incomingCheckins) {
      const byId = new Map(loadCheckins().map((c) => [c.id, c]));
      incomingCheckins.forEach((c) => {
        const id = c.id || genId();
        byId.set(id, Object.assign({}, byId.get(id) || {}, c, { id }));
      });
      saveCheckins(Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    }
  } else {
    if (incomingPlans) savePlans(incomingPlans);
    if (incomingCheckins) {
      saveCheckins(incomingCheckins.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)));
    }
  }

  if (data.prefs && typeof data.prefs === "object") savePrefs(data.prefs);

  return { plans: loadPlans().length, checkins: loadCheckins().length };
}

// ============================ 同步到 GitHub（v2 兼容，不改文案） ============================

/**
 * 取回可用的 PAT：优先取管理页输入框的当前值（并持久化），否则读 localStorage。
 * 首页 / 统计页没有 #pat-input，此时直接读 localStorage。
 * @returns {string} token，取不到时为空字符串
 */
function resolveToken() {
  const input = document.getElementById("pat-input");
  if (input) {
    const typed = input.value.trim();
    if (typed) {
      safeSetItem(TOKEN_KEY, typed);
      return typed;
    }
  }
  return safeGetItem(TOKEN_KEY) || "";
}

/**
 * 纯粹的 repository_dispatch 调用：只发请求，不碰任何 UI。
 * 失败时抛出【可直接展示给用户】的错误信息，由调用方决定提示方式。
 * ⚠️ event_type 与 client_payload 结构是 sync.yml 的输入契约，禁止改动。
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

/* =====================================================================
   v4「星河契约」增量层
   ---------------------------------------------------------------------
   本节【只新增】，不改动上面任何 v2/v3 的函数签名与行为。
   核心隐喻：每个计划都是夜空中的一颗星。
     · 位置  planStarPosition(id)  —— 由 id 哈希派生，同一计划永远在同一处；
     · 亮度  planBrightness(plan)  —— 由连续记录 + 完成率派生，坚持则明亮；
     · 星座  buildStarMap()        —— 按 createdAt 排序相邻连线，织成你的星座。
   ===================================================================== */

// ============================ v4 常量 ============================

/** 星图左右安全边距（百分比）：保证星点与名称不会贴边被裁 */
const STAR_MARGIN_X = 9;
/** 星图上下安全边距（百分比） */
const STAR_MARGIN_Y = 13;
/**
 * 宽高比补偿系数。
 * 星图容器通常「宽 ≫ 高」，若直接拿百分比算距离，横向会显得过疏、纵向过密。
 * 比较距离时把 x 分量乘上它，散布才符合视觉直觉。
 */
const STAR_ASPECT = 1.7;
/** 两颗星之间的最小视觉间距（以「纵向百分比」为单位） */
const STAR_MIN_GAP = 17;
/** 散开松弛的迭代上限。纯确定性算法，次数固定 → 每次打开位置完全一致 */
const STAR_RELAX_ITERATIONS = 30;
/** 亮度分档阈值（score 由高到低匹配），依次对应 level 4 / 3 / 2 / 1 */
const STAR_LEVEL_STEPS = [0.8, 0.56, 0.32, 0.02];

/** 里程碑祝贺语：连续天数 → 一句话 */
const MILESTONE_CHEERS = {
  7: "连续 7 天——你点亮了一颗北极星。",
  21: "连续 21 天——星轨已经稳定成型。",
  30: "连续 30 天——向日葵在夜里也朝着你。",
  100: "连续 100 天——这已经是一条完整的星河。",
  365: "连续 365 天——岁轮走完一整圈，你还在。",
};

/**
 * 天文台时段旁白（区间与 GREETINGS 一一对应）。
 * from > to 表示跨零点区间。
 */
const SKY_POEMS = [
  { from: 5, to: 8, text: "清晨，你的星域还未全部亮起。" },
  { from: 9, to: 11, text: "天光正盛，星星在白昼背后等你。" },
  { from: 12, to: 13, text: "正午，星轨仍在头顶悄悄推进。" },
  { from: 14, to: 17, text: "日头偏西了，先去点亮最近的那一颗。" },
  { from: 18, to: 21, text: "入夜，今晚该有几颗星要亮起来。" },
  { from: 22, to: 4, text: "夜深了，今日又有多少颗星被点亮。" },
];

/** 星图空状态诗句 */
const EMPTY_SKY_LINE = "你的星空还是一片暗区，缔结第一颗星吧。";

// ============================ v4 星图计算 ============================

/**
 * 依据当前时段返回一句诗意旁白。
 * @param {Date} [date] 参考时间，缺省为现在
 * @returns {string} 旁白文本
 */
function skyPoem(date) {
  const d = date instanceof Date ? date : new Date();
  const hour = d.getHours();
  for (const p of SKY_POEMS) {
    if (p.from <= p.to) {
      if (hour >= p.from && hour <= p.to) return p.text;
    } else if (hour >= p.from || hour <= p.to) {
      // 跨零点区间，例如 22 ~ 4
      return p.text;
    }
  }
  return SKY_POEMS[SKY_POEMS.length - 1].text;
}

/**
 * 计算某个计划在星图上的固定坐标（百分比）。
 * 用两条带不同 salt 的哈希分别派生 x / y，保证：
 *   1）同一计划每次打开位置完全相同（不会跳来跳去）；
 *   2）不同计划分布足够散乱，看起来像真实星空。
 * @param {string} planId 计划 id
 * @returns {{x:number, y:number}} 百分比坐标，已含安全边距
 */
function planStarPosition(planId) {
  const id = String(planId == null ? "" : planId);
  const hx = hashString(`starx:${id}`);
  const hy = hashString(`stary:${id}`);
  const spanX = 100 - STAR_MARGIN_X * 2;
  const spanY = 100 - STAR_MARGIN_Y * 2;
  return {
    x: STAR_MARGIN_X + ((hx % 10007) / 10007) * spanX,
    y: STAR_MARGIN_Y + ((hy % 10009) / 10009) * spanY,
  };
}

/**
 * 计算某个计划的「亮度」。
 * 语义：坚持得越久、完成率越高 → 星越亮、光环越大；停用则完全熄灭。
 *   score = 连续记录贡献（0~0.65） + 近 30 天完成率贡献（0~0.35）
 * @param {Object} plan 计划对象
 * @returns {{level:number, score:number, streak:Object, rate:Object}}
 *          level 0 = 熄灭 / 1 = 微光 / 2 = 常明 / 3 = 明亮 / 4 = 恒星
 */
function planBrightness(plan) {
  const p = plan && typeof plan === "object" ? plan : {};
  const emptyStreak = { current: 0, best: 0, unit: "天", lastDate: null };
  const emptyRate = { done: 0, expected: 0, missed: 0, rate: 0 };

  if (p.enabled === false) {
    return { level: 0, score: 0, streak: emptyStreak, rate: emptyRate };
  }

  const streak = p.id ? computeStreak(p.id) : emptyStreak;
  const rate = p.id ? completionRate(p.id, 30) : emptyRate;

  // 21 天封顶：到「成习」这个量级就算满分，再久也不会让别的星显得太暗
  const streakScore = Math.min(1, Math.max(0, streak.current / 21)) * 0.65;
  const rateScore = Math.min(1, Math.max(0, Number(rate.rate) || 0)) * 0.35;
  const score = streakScore + rateScore;

  let level = 1; // 启用中的计划至少保留一点微光，不至于完全看不见
  for (let i = 0; i < STAR_LEVEL_STEPS.length; i++) {
    if (score >= STAR_LEVEL_STEPS[i]) {
      level = 4 - i;
      break;
    }
  }
  return { level: Math.max(1, level), score, streak, rate };
}

/**
 * 构建完整星图数据：星点 + 星座连线。
 *
 * 位置先由哈希派生，再做一次【确定性松弛】把挨太近的星互相推开——
 * 因为迭代次数与比较顺序都固定，同一批计划每次得到的结果完全一致。
 *
 * @param {Array<Object>} [planList] 计划数组，缺省时自行 loadPlans()
 * @returns {{stars:Array<Object>, links:Array<Object>, total:number, lit:number, dim:number}}
 */
function buildStarMap(planList) {
  const plans = Array.isArray(planList) ? planList : loadPlans();
  const now = Date.now();

  const stars = plans.map((plan, index) => {
    const id = plan.id || `idx-${index}`;
    const pos = planStarPosition(id);
    const bright = planBrightness(plan);
    const theme = themeOf(plan);
    const enabled = plan.enabled !== false;
    const next = enabled ? nextReminder(plan, now) : null;
    const level = enabled ? bright.level : 0;

    // 星芯与光环尺寸（px）：亮度越高越大
    const size = 12 + level * 4.5;
    const halo = size * (2.3 + level * 0.55);

    const tipParts = [`${plan.icon || "🌟"} ${plan.name || "未命名"}`, describePlan(plan)];
    if (!enabled) {
      tipParts.push("已熄灭");
    } else if (next) {
      tipParts.push(`下次 ${next.human} · 还有 ${formatCountdown(next.diffMs)}`);
    }
    if (bright.streak.current > 0) {
      tipParts.push(`连续 ${bright.streak.current} ${bright.streak.unit}`);
    }
    if (bright.rate.expected > 0) {
      tipParts.push(`30 天完成率 ${Math.round(bright.rate.rate * 100)}%`);
    }
    const desc = String(plan.desc || "").trim();
    if (desc) tipParts.push(desc);

    return {
      id,
      name: plan.name || "未命名",
      icon: plan.icon || "🌟",
      desc,
      freq: plan.freq || "daily",
      time: plan.time || "08:00",
      day: Number(plan.day) || 0,
      color: plan.color || "",
      enabled,
      createdAt: Number(plan.createdAt) || 0,
      theme,
      level,
      score: bright.score,
      streak: bright.streak,
      rate: bright.rate,
      next,
      x: pos.x,
      y: pos.y,
      size,
      halo,
      // 闪烁相位错开，避免所有星整齐划一地一起眨眼
      delay: hashString(`tw:${id}`) % 4200,
      period: 3200 + (hashString(`pd:${id}`) % 2600),
      tip: tipParts.join(" · "),
      label: describePlan(plan),
    };
  });

  // —— 确定性松弛：把靠得太近的星星互相推开 ——
  for (let iter = 0; iter < STAR_RELAX_ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const a = stars[i];
        const b = stars[j];
        let dx = (b.x - a.x) * STAR_ASPECT;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.0001) {
          // 完全重合：按索引给一个固定方向的微小偏移，既避免除零又保持确定性
          dx = (i % 2 === 0 ? 1 : -1) * 0.6;
          dy = (j % 2 === 0 ? 1 : -1) * 0.6;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        if (dist >= STAR_MIN_GAP) continue;
        const push = (STAR_MIN_GAP - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= (ux * push) / STAR_ASPECT;
        a.y -= uy * push;
        b.x += (ux * push) / STAR_ASPECT;
        b.y += uy * push;
        moved = true;
      }
    }
    // 每轮结束都夹回安全区，防止被推出画布
    for (const s of stars) {
      s.x = Math.min(100 - STAR_MARGIN_X, Math.max(STAR_MARGIN_X, s.x));
      s.y = Math.min(100 - STAR_MARGIN_Y, Math.max(STAR_MARGIN_Y, s.y));
    }
    if (!moved) break;
  }

  // —— 星座连线：按缔结时间排序后相邻相连（id 兜底保证排序稳定）——
  const ordered = stars.slice().sort((a, b) => {
    const diff = a.createdAt - b.createdAt;
    if (diff !== 0) return diff;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
  const links = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    links.push({
      from: a.id,
      to: b.id,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      // 两端都够亮时连线也跟着亮一点，星座才有层次
      bright: a.level + b.level >= 5,
    });
  }

  const lit = stars.filter((s) => s.enabled).length;
  return { stars, links, total: stars.length, lit, dim: stars.length - lit };
}

/**
 * 构建某个月的日历网格（整周对齐，周一在第一列）。
 * 统计页「星历」用它把有活动的日子画成小星星。
 * @param {number} year 年份，例如 2026
 * @param {number} month 月份索引 0~11
 * @param {{planId?:string, source?:string}} [opts] 活动过滤条件
 * @returns {Object} MonthGrid
 */
function buildMonthGrid(year, month, opts) {
  const today = new Date();
  const y = Number.isFinite(Number(year)) ? Number(year) : today.getFullYear();
  const mo = Number.isFinite(Number(month)) ? Number(month) : today.getMonth();

  const first = new Date(y, mo, 1);
  const lead = pyWeekday(first); // 本月 1 号前面要补几个上月的格子
  const lastDay = new Date(y, mo + 1, 0).getDate();
  const totalCells = Math.ceil((lead + lastDay) / 7) * 7;
  const gridStart = new Date(y, mo, 1 - lead);

  const activity = buildActivityMap(opts);
  const todayKey = dateKey(today);
  const todayTs = startOfDay(today).getTime();

  const cells = [];
  let total = 0;
  let activeDays = 0;
  let maxCount = 0;

  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = dateKey(d);
    const hit = activity.get(key);
    const count = hit ? hit.count : 0;

    // 与热力图完全一致的分档逻辑，保证两处视觉口径统一
    let level = 0;
    for (let li = HEATMAP_LEVELS.length - 1; li >= 0; li--) {
      if (count >= HEATMAP_LEVELS[li] && HEATMAP_LEVELS[li] > 0) {
        level = li;
        break;
      }
    }

    const inMonth = d.getFullYear() === y && d.getMonth() === mo;
    if (inMonth && count > 0) {
      total += count;
      activeDays += 1;
      if (count > maxCount) maxCount = count;
    }

    cells.push({
      date: key,
      day: d.getDate(),
      count,
      manual: hit ? hit.manual : 0,
      auto: hit ? hit.auto : 0,
      level,
      inMonth,
      isToday: key === todayKey,
      future: startOfDay(d).getTime() > todayTs,
    });
  }

  return {
    year: y,
    month: mo,
    label: `${y} 年 ${mo + 1} 月`,
    cells,
    total,
    activeDays,
    maxCount,
    days: lastDay,
  };
}

/**
 * 里程碑祝贺 / 激励文案。
 * 已解锁时返回最高一档的祝贺；一个都没解锁时返回「还差多少天」的鼓励。
 * @returns {{unlocked:boolean, text:string, milestone:Object}}
 */
function milestoneCheer() {
  const all = milestones();
  const unlockedList = all.filter((m) => m.unlocked);

  if (unlockedList.length === 0) {
    const streak = globalStreak();
    const reached = Math.max(streak.current, streak.best);
    const next = MILESTONES.find((m) => m.days > reached) || MILESTONES[0];
    const gap = Math.max(next.days - reached, 0);
    return {
      unlocked: false,
      text: `再坚持 ${gap} 天，就能点亮「${next.name}」。`,
      milestone: next,
    };
  }

  const top = unlockedList[unlockedList.length - 1];
  return {
    unlocked: true,
    text: MILESTONE_CHEERS[top.days] || `连续 ${top.days} 天——「${top.name}」已达成。`,
    milestone: top,
  };
}
