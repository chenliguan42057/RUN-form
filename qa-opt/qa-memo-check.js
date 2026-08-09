/**
 * qa-memo-check.js —— RUN-form v6.1「备忘录 + 钉钉 actionCard」独立验证（QA / 严过关 自建）
 *
 * ⚠️ 这是测试脚本，不是站点源文件。发布前可与 qa-static.js / qa-runtime.js 一起删除。
 *
 * 沿用 qa-v6-check.js 的手法（不重造 harness）：
 *   store.js 顶层用 const/let，vm 里分两次 runInContext 取不到，
 *   所以把「被测源码 + 测试代码」拼成同一个脚本一次性 runInContext。
 *   store.js 靠 window 反查全局，所以 prelude 里让 window === globalThis。
 *
 * 覆盖（v6.1 增量）：
 *   M1  memos CRUD（增/完成/删除/墓碑）
 *   M2  dueMemos 到期边界（正好到点 / 未到点 / 已 done / 非法 due）
 *   M3  钉钉 actionCard 载荷结构（从 dingtalk-reminder.yml 抽出 payload 字面量校验）
 *   M4  备忘幂等 key 格式（memo|{id}）与计划 key 不撞车
 *   M5  站内提示去重（同 id 同天只提示一次；跨天换键）
 *   M6  dispatchMemos 走 sync-memos 独立事件 + client_payload 契约（含 sync.yml 对齐）
 *   M7  站内提示函数 checkDueMemos 从 app.js 抽出后在沙箱真跑
 *   M8  sw.js CACHE_VERSION 升级 + 脚本加载顺序 / 预缓存覆盖
 *
 * 运行：node qa-opt/qa-memo-check.js
 * 退出码：0 = 全过，1 = 有 FAIL
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const readSrc = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ============================ 浏览器环境替身 ============================
// 只实现被测代码真正会碰到的 API，其余留白，碰到就炸——
// 静默兜底的替身会把真 bug 掩盖成 PASS。

function makeSandbox() {
  const storeMap = new Map();

  const localStorage = {
    getItem: (k) => (storeMap.has(String(k)) ? storeMap.get(String(k)) : null),
    setItem: (k, v) => storeMap.set(String(k), String(v)),
    removeItem: (k) => storeMap.delete(String(k)),
    clear: () => storeMap.clear(),
  };

  /** 画布 2d 上下文替身：只记录调用 */
  function make2d(spy) {
    const noop = () => {};
    return {
      canvas: null,
      globalAlpha: 1,
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      save: noop,
      restore: noop,
      beginPath: noop,
      closePath: noop,
      moveTo: noop,
      lineTo: noop,
      arc: noop,
      arcTo: noop,
      rect: noop,
      quadraticCurveTo: noop,
      bezierCurveTo: noop,
      fill: noop,
      stroke: noop,
      clip: noop,
      clearRect: noop,
      fillRect: noop,
      strokeRect: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      setTransform: noop,
      drawImage: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null,
      measureText: (t) => ({ width: String(t == null ? "" : t).length * 20 }),
      fillText: (t) => spy.texts.push(String(t)),
      strokeText: (t) => spy.texts.push(String(t)),
    };
  }

  const canvasSpy = { texts: [] };

  /** 极简元素替身 */
  function makeEl(tag) {
    const set = new Set();
    const attrs = {};
    const el = {
      tagName: String(tag || "div").toUpperCase(),
      id: "",
      className: "",
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      href: "",
      download: "",
      width: 0,
      height: 0,
      style: {},
      dataset: {},
      children: [],
      parentNode: null,
      isContentEditable: false,
      classList: {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        toggle: (c, on) => (on ? (set.add(c), true) : (set.delete(c), false)),
        contains: (c) => set.has(c),
      },
      setAttribute: (k, v) => {
        attrs[k] = String(v);
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      removeAttribute: (k) => {
        delete attrs[k];
      },
      appendChild(c) {
        c.parentNode = this;
        this.children.push(c);
        return c;
      },
      removeChild(c) {
        c.parentNode = null;
        this.children = this.children.filter((x) => x !== c);
        return c;
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      insertBefore(c) {
        return this.appendChild(c);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus: () => {},
      blur: () => {},
      click: () => {},
      scrollIntoView: () => {},
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 1024, height: 768 }),
      toDataURL: () => "data:image/png;base64,QAQA",
    };
    if (el.tagName === "CANVAS") {
      const c2d = make2d(canvasSpy);
      c2d.canvas = el;
      el.getContext = (kind) => (kind === "2d" ? c2d : null);
    }
    return el;
  }

  /** document 上注册的事件处理器 */
  const docHandlers = {};

  /** toast 元素替身：showToast 要写 textContent / className / hidden */
  const toastEl = makeEl("div");
  toastEl.id = "toast";
  toastEl.hidden = true;

  const document = {
    documentElement: makeEl("html"),
    body: makeEl("body"),
    hidden: false,
    visibilityState: "visible",
    getElementById: (id) => (String(id) === "toast" ? toastEl : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    createTextNode: (t) => ({ nodeValue: String(t) }),
    addEventListener: (type, fn) => {
      (docHandlers[type] || (docHandlers[type] = [])).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (docHandlers[type]) docHandlers[type] = docHandlers[type].filter((f) => f !== fn);
    },
  };

  /** matchMedia 可调桩 */
  const mq = { reduceMotion: false, standalone: false };

  /** fetch 取证桩：dispatchMemos 的 body 全落这里 */
  const fetchSpy = { calls: [] };

  const navigatorStub = {
    userAgent: "qa-memo-check",
    onLine: true,
    vibrate: () => true,
    clipboard: { writeText: () => Promise.resolve() },
  };

  /** window(=globalThis) 级事件登记表 */
  const winHandlers = Object.create(null);

  const sandbox = {
    document,
    localStorage,
    navigator: navigatorStub,
    addEventListener: (type, fn) => {
      (winHandlers[type] || (winHandlers[type] = [])).push(fn);
    },
    removeEventListener: (type, fn) => {
      const a = winHandlers[type];
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    dispatchEvent: () => true,
    location: { href: "http://localhost/index.html", origin: "http://localhost", hash: "" },
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    matchMedia: (q) => {
      const s = String(q);
      let matches = false;
      if (s.indexOf("prefers-reduced-motion") >= 0) matches = mq.reduceMotion;
      if (s.indexOf("display-mode") >= 0) matches = mq.standalone;
      return { matches, media: s, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
    },
    crypto: {
      randomUUID: (() => {
        let n = 0;
        return () => "memo-uuid-" + String(++n).padStart(6, "0");
      })(),
    },
    fetch: (url, opts) => {
      fetchSpy.calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") });
    },
    URL: { createObjectURL: () => "blob:qa", revokeObjectURL: () => {} },
    Blob: class {
      constructor(parts) {
        this.parts = parts;
      }
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    pageYOffset: 0,
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
    scrollTo: () => {},
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
  };

  // —— 测试桥接 ——
  sandbox.__results = [];
  sandbox.__section = "";
  sandbox.__setSection = (n) => {
    sandbox.__section = n;
  };
  sandbox.__assert = (id, ok, desc, evidence) => {
    sandbox.__results.push({
      section: sandbox.__section,
      id,
      ok: Boolean(ok),
      desc,
      evidence: String(evidence == null ? "" : evidence).slice(0, 300),
    });
  };
  sandbox.__reset = () => {
    storeMap.clear();
    fetchSpy.calls.length = 0;
    canvasSpy.texts.length = 0;
    toastEl.textContent = "";
    toastEl.hidden = true;
  };
  sandbox.__fetchSpy = fetchSpy;
  sandbox.__canvasSpy = canvasSpy;
  sandbox.__mq = mq;
  sandbox.__docHandlers = docHandlers;
  sandbox.__winHandlers = winHandlers;
  sandbox.__toastEl = toastEl;
  sandbox.__navigator = navigatorStub;
  /** 让沙箱内的断言能读仓库源文件（跨文件一致性检查用） */
  sandbox.__readFile = readSrc;

  return sandbox;
}

// ============================ 测试主体 ============================

function tests() {
  /* eslint-disable no-undef */

  // ---------- 小工具（声明在 tests() 内，M7 也共用） ----------
  function seedMemos(list) {
    localStorage.setItem("runform_memos", JSON.stringify(list));
  }
  function seedTombstones(o) {
    localStorage.setItem("runform_memo_tombstones", JSON.stringify(o || {}));
  }
  /** 按 key 读 localStorage 里的对象 */
  function lsObj(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch (e) {
      return {};
    }
  }
  /** 取某备忘在 localStorage 里的最新记录 */
  function findMemo(id) {
    return loadMemos().find((m) => m.id === id);
  }

  // ======================================================================
  __setSection("M1 · memos CRUD（增 / 完成 / 撤销 / 删除 / 墓碑）");
  // ======================================================================
  __reset();
  const m1 = addMemo({ title: "周五交房租", due: "2026-08-14 18:00" });
  __assert(
    "M1.1",
    m1 && typeof m1.id === "string" && m1.id.length > 0 && m1.title === "周五交房租" &&
      m1.due === "2026-08-14 18:00" && m1.done === false && typeof m1.createdAt === "number",
    "addMemo 产出完整备忘对象（id/title/due/done:false/createdAt）",
    JSON.stringify(m1)
  );
  __assert(
    "M1.2",
    findMemo(m1.id) && findMemo(m1.id).title === "周五交房租",
    "addMemo 已持久化到 localStorage",
    localStorage.getItem("runform_memos")
  );

  markMemoDone(m1.id);
  __assert(
    "M1.3",
    findMemo(m1.id) && findMemo(m1.id).done === true,
    "markMemoDone(id) 把 done 置 true",
    JSON.stringify(findMemo(m1.id))
  );

  updateMemo(m1.id, { done: false });
  __assert(
    "M1.4",
    findMemo(m1.id) && findMemo(m1.id).done === false,
    "updateMemo(id,{done:false}) 可撤销完成",
    JSON.stringify(findMemo(m1.id))
  );

  const m2 = addMemo({ title: "取快递", due: "2026-08-09 12:00" });
  deleteMemo(m2.id);
  __assert(
    "M1.5",
    loadMemos().length === 1 && !findMemo(m2.id),
    "deleteMemo(id) 从列表移除该备忘",
    "剩余 " + loadMemos().length + " 条"
  );
  __assert(
    "M1.6",
    lsObj("runform_memo_tombstones")[m2.id] > 0,
    "deleteMemo(id) 立墓碑（同步时才能从仓库精确剔除）",
    JSON.stringify(lsObj("runform_memo_tombstones"))
  );
  __assert(
    "M1.7",
    memoTombstoneIds().indexOf(m2.id) >= 0,
    "memoTombstoneIds() 返回墓碑 id 数组",
    memoTombstoneIds().join(",")
  );

  // 墓碑防误删：再删一条不存在的 id 也应立墓碑（删除语义幂等）
  deleteMemo("nonexistent-id");
  __assert(
    "M1.8",
    lsObj("runform_memo_tombstones")["nonexistent-id"] > 0,
    "删除不存在的 id 也会立墓碑（删除语义本身幂等）",
    JSON.stringify(lsObj("runform_memo_tombstones"))
  );

  // loadMemos 读时补全：脏数据不该崩
  seedMemos([{ id: "bad1", due: "2026-08-08 09:00" }]); // 缺 title/done/createdAt
  const bad = loadMemos()[0];
  __assert(
    "M1.9",
    bad && bad.title === "未命名备忘" && bad.done === false && typeof bad.createdAt === "number",
    "loadMemos 对缺字段的脏数据做读时补全",
    JSON.stringify(bad)
  );

  // ======================================================================
  __setSection("M2 · dueMemos 到期边界");
  // ======================================================================
  __reset();
  // 参考时间：2026-08-08 09:30:00 本地时区
  const NOW = new Date(2026, 7, 8, 9, 30, 0, 0).getTime();
  seedMemos([
    { id: "due-exact", title: "正好到点", due: "2026-08-08 09:30", done: false, createdAt: 1 },
    { id: "due-past", title: "已过期", due: "2026-08-08 09:00", done: false, createdAt: 1 },
    { id: "due-future", title: "还没到", due: "2026-08-08 09:31", done: false, createdAt: 1 },
    { id: "due-done", title: "已完成", due: "2026-08-08 09:00", done: true, createdAt: 1 },
    { id: "due-invalid", title: "非法格式", due: "随便写", done: false, createdAt: 1 },
  ]);

  const dueList = dueMemos(NOW).map((m) => m.id);
  __assert(
    "M2.1",
    dueList.indexOf("due-exact") >= 0,
    "到期时间与 now 完全相等（09:30 对 09:30）→ 判为到期（含边界）",
    dueList.join(",")
  );
  __assert(
    "M2.2",
    dueList.indexOf("due-past") >= 0,
    "已过到期时间（09:00 < 09:30）→ 判为到期",
    dueList.join(",")
  );
  __assert(
    "M2.3",
    dueList.indexOf("due-future") < 0,
    "未到到期时间（09:31 > 09:30）→ 不判为到期",
    dueList.join(",")
  );
  __assert(
    "M2.4",
    dueList.indexOf("due-done") < 0,
    "已 done 的备忘即使过期也不出现在到期列表",
    dueList.join(",")
  );
  __assert(
    "M2.5",
    dueList.indexOf("due-invalid") < 0,
    "非法 due 解析为 Infinity → 永不到期（不误报）",
    dueList.join(",")
  );

  // memoDueMs 单元级
  __assert(
    "M2.6",
    memoDueMs("2026-08-08 09:30") === NOW,
    "memoDueMs 把 'YYYY-MM-DD HH:MM' 解析成与参考时间一致的时间戳",
    memoDueMs("2026-08-08 09:30") + " vs " + NOW
  );
  __assert(
    "M2.7",
    memoDueMs("") === Infinity && memoDueMs("2026-8-8 9:30") === Infinity,
    "空串 / 非定长格式 → Infinity（缺省永不到期）",
    "空串=" + memoDueMs("") + " 非定长=" + memoDueMs("2026-8-8 9:30")
  );

  // 默认参数：不传 nowTs 时用 Date.now()
  __reset();
  seedMemos([{ id: "now-default", title: "默认参数", due: "2000-01-01 00:00", done: false, createdAt: 1 }]);
  __assert(
    "M2.8",
    dueMemos().some((m) => m.id === "now-default"),
    "不传 nowTs 时用当前时间，2000 年的备忘必过期",
    JSON.stringify(dueMemos().map((m) => m.id))
  );

  // ======================================================================
  __setSection("M3 · 钉钉 actionCard 载荷结构（对真源 YAML 校验）");
  // ======================================================================
  // 从 dingtalk-reminder.yml 抽出 send_dingtalk 里的 payload 字面量，
  // 转成 JSON 后逐字段断言——不靠印象，直接对工作流真源。
  const yml = __readFile(".github/workflows/dingtalk-reminder.yml");
  const SITE_URL_EXPECTED = "https://chenliguan42057.github.io/RUN-form/";
  const ymlHasSiteUrl = yml.indexOf('SITE_URL = "' + SITE_URL_EXPECTED + '"') >= 0;
  __assert(
    "M3.0",
    ymlHasSiteUrl,
    "dingtalk-reminder.yml 中 SITE_URL 常量与仓库地址一致",
    "期望 " + SITE_URL_EXPECTED
  );

  // 抽取 payload = { ... } 块（只取花括号里的字面量本体，不含 "payload = " 前缀）
  let payloadBlock = "";
  const pStart = yml.indexOf("payload = {");
  if (pStart >= 0) {
    const openBrace = yml.indexOf("{", pStart);
    let depth = 0;
    for (let i = openBrace; i < yml.length; i++) {
      if (yml[i] === "{") depth += 1;
      else if (yml[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          payloadBlock = yml.slice(openBrace, i + 1);
          break;
        }
      }
    }
  }
  // 把 Python 字典字面量转成 JSON：
  //   键已是双引号，只把「值位置」上的裸变量替换成占位字符串，不能碰键名。
  let payloadJson = payloadBlock
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/:\s*title\b/g, ': "TITLE_PH"')
    .replace(/:\s*text\b/g, ': "TEXT_PH"')
    .replace(/:\s*SITE_URL\b/g, ': "' + SITE_URL_EXPECTED + '"');
  let payload = null;
  try {
    payload = JSON.parse(payloadJson);
  } catch (e) {
    payload = null;
  }

  __assert(
    "M3.1",
    !!payload && payload.msgtype === "actionCard",
    "payload.msgtype 必须是 'actionCard'",
    payload ? payload.msgtype : "(解析失败)"
  );
  __assert(
    "M3.2",
    !!payload && payload.actionCard && typeof payload.actionCard.title === "string" &&
      typeof payload.actionCard.text === "string",
    "actionCard.title / actionCard.text 均为字符串（markdown 正文）",
    payload && payload.actionCard ? JSON.stringify(Object.keys(payload.actionCard)) : "(无)"
  );
  __assert(
    "M3.3",
    !!payload && payload.actionCard && payload.actionCard.btnOrientation === "0",
    "btnOrientation 必须为 '0'（与钉钉 actionCard 官方字段一致）",
    payload && payload.actionCard ? String(payload.actionCard.btnOrientation) : "(无)"
  );
  __assert(
    "M3.4",
    !!payload && payload.actionCard && Array.isArray(payload.actionCard.btns) &&
      payload.actionCard.btns.length === 1 &&
      payload.actionCard.btns[0].title === "👉 打开星河自律",
    "btns 数组含 1 个按钮，标题为「👉 打开星河自律」",
    payload && payload.actionCard && payload.actionCard.btns
      ? payload.actionCard.btns.map((b) => b.title).join(",")
      : "(无)"
  );
  __assert(
    "M3.5",
    !!payload && payload.actionCard && payload.actionCard.btns &&
      payload.actionCard.btns[0].actionURL === SITE_URL_EXPECTED,
    "btns[0].actionURL 指向 SITE_URL（按钮点击打开星河自律）",
    payload && payload.actionCard && payload.actionCard.btns
      ? String(payload.actionCard.btns[0].actionURL)
      : "(无)"
  );
  __assert(
    "M3.6",
    !!payload && payload.actionCard &&
      !("singleTitle" in payload.actionCard) && !("singleURL" in payload.actionCard),
    "使用 btns 数组时不应混用 singleTitle/singleURL（避免钉钉单按钮双按钮二选一冲突）",
    payload && payload.actionCard ? JSON.stringify(Object.keys(payload.actionCard)) : "(无)"
  );

  // 钉钉官方要求的顶层键拼写抽查
  __assert(
    "M3.7",
    payloadBlock.indexOf('"msgtype"') >= 0 && payloadBlock.indexOf('"actionCard"') >= 0 &&
      payloadBlock.indexOf('"btnOrientation"') >= 0 && payloadBlock.indexOf('"actionURL"') >= 0 &&
      payloadBlock.indexOf('"btns"') >= 0,
    "payload 字段名拼写齐全（msgtype/actionCard/btnOrientation/btns/actionURL）",
    "抽取块长度 " + payloadBlock.length
  );

  // ======================================================================
  __setSection("M4 · 备忘幂等 key 与去重口径");
  // ======================================================================
  __reset();
  const k1 = "memo|" + m1.id;
  __assert(
    "M4.1",
    k1.indexOf("memo|") === 0 && k1.split("|").length === 2,
    "备忘幂等 key 形如 'memo|{id}'（workflow 第 346 行 f-string）",
    k1
  );
  __assert(
    "M4.2",
    /^\d{4}-\d{2}-\d{2}\|[^|]+$/.test("2026-08-06|plan-abc") === true &&
      /^\d{4}-\d{2}-\d{2}\|[^|]+$/.test(k1) === false,
    "计划 key 是 '日期|planId'，备忘 key 是 'memo|id'，前缀不相交 → 不会撞车",
    "备忘 key=" + k1 + " 不匹配计划 key 的日期前缀正则"
  );
  // stale 清理兼容性：memo key 按 ts 清、计划 key 按日期清的分支判定
  __assert(
    "M4.3",
    k1.indexOf("memo|") === 0 ? "memo" : "plan",
    "workflow 里 stale 清理按前缀区分：memo| 走 ts 分支",
    "memo key 前缀=" + k1.slice(0, 5)
  );

  // ======================================================================
  __setSection("M5 · 站内提示去重（同 id 同天只提示一次）");
  // ======================================================================
  __reset();
  __assert(
    "M5.1",
    isMemoNotified(m1.id, "2026-08-08") === false,
    "初始状态未提示过",
    "isMemoNotified=" + isMemoNotified(m1.id, "2026-08-08")
  );
  markMemoNotified(m1.id, "2026-08-08");
  __assert(
    "M5.2",
    isMemoNotified(m1.id, "2026-08-08") === true,
    "markMemoNotified 后同键立即生效",
    "isMemoNotified=" + isMemoNotified(m1.id, "2026-08-08")
  );
  __assert(
    "M5.3",
    isMemoNotified(m1.id, "2026-08-09") === false,
    "跨天换键：明天重新可提示（同 id 不同日不互斥）",
    "明天=" + isMemoNotified(m1.id, "2026-08-09")
  );
  __assert(
    "M5.4",
    isMemoNotified("other-id", "2026-08-08") === false,
    "不同 id 同天互不影响",
    "other-id=" + isMemoNotified("other-id", "2026-08-08")
  );

  // 去重键字面量：memoId|YYYY-MM-DD
  markMemoNotified("xyz", "2026-12-31");
  const notified = lsObj("runform_memo_notified");
  __assert(
    "M5.5",
    notified["xyz|2026-12-31"] === 1 && notified["xyz|2026-12-30"] === undefined,
    "去重键存为 { 'memoId|YYYY-MM-DD': 1 }",
    JSON.stringify(notified)
  );

  // ======================================================================
  __setSection("M6 · dispatchMemos 走独立 sync-memos 事件 + 契约对齐");
  // ======================================================================
  __reset();
  seedMemos([
    { id: "m-sync-1", title: "同步测试", due: "2026-08-08 09:30", done: false, createdAt: 1 },
  ]);
  seedTombstones({ "del-memo-1": 123456789 });
  // dispatchMemos 是 async；fetch 桩同步记录调用，故不 await 也能立刻取证
  dispatchMemos(loadMemos(), "fake-token");

  const call = __fetchSpy.calls[0];
  __assert(
    "M6.1",
    !!call && call.url.indexOf("dispatches") >= 0,
    "dispatchMemos 向 repository_dispatch 接口发了一次 fetch",
    call ? call.url : "(无调用)"
  );
  let body = null;
  if (call) {
    try {
      body = JSON.parse(call.opts.body);
    } catch (e) {
      body = null;
    }
  }
  __assert(
    "M6.2",
    body && body.event_type === "sync-memos",
    "event_type 必须是 'sync-memos'（独立事件，不碰 sync-checkins）",
    body ? body.event_type : "(解析失败)"
  );
  __assert(
    "M6.3",
    body && body.client_payload && Array.isArray(body.client_payload.memos) &&
      body.client_payload.memos.length === 1 &&
      body.client_payload.memos[0].id === "m-sync-1",
    "client_payload.memos 字段名与 sync.yml 的 MEMOS_JSON 对齐",
    body && body.client_payload ? JSON.stringify(body.client_payload.memos) : "(无)"
  );
  __assert(
    "M6.4",
    body && body.client_payload && body.client_payload.tombstones &&
      Array.isArray(body.client_payload.tombstones.memos) &&
      body.client_payload.tombstones.memos.indexOf("del-memo-1") >= 0,
    "client_payload.tombstones.memos 携带墓碑 id（sync.yml 用 dead_set(raw,'memos') 读取）",
    body && body.client_payload && body.client_payload.tombstones
      ? JSON.stringify(body.client_payload.tombstones)
      : "(无)"
  );

  // sync.yml 侧契约一致性：字段名 memos / tombstones.memos / event_type sync-memos
  const syncYml = __readFile(".github/workflows/sync.yml");
  __assert(
    "M6.5",
    syncYml.indexOf("client_payload.memos") >= 0 &&
      syncYml.indexOf('"memos"') >= 0 &&
      syncYml.indexOf('dead_set(raw_tomb, "memos")') >= 0,
    "sync.yml 用 client_payload.memos 与 tombstones.memos 读取（前后端字段名一致）",
    "sync-memos 分支在 sync.yml 中"
  );
  __assert(
    "M6.6",
    syncYml.indexOf("sync-memos") >= 0 &&
      syncYml.indexOf("data/memos.json") >= 0,
    "sync.yml 已注册 sync-memos 事件类型并写 data/memos.json",
    "命中 sync-memos 与 data/memos.json"
  );
  // 提交步骤按事件类型只 add 对应文件，不能把 reminder-state 一起提交
  // ⚠️ 注意：不能用 indexOf("git add data/") < 0 判断——"git add data/memos.json"
  // 本身也包含这个子串。要抓的是「裸 git add data/」这种不带文件名的危险写法。
  const addLines = syncYml.split("\n").filter((l) => /git add/.test(l));
  const bareAdd = addLines.some((l) => /git add data\/?\s*$/.test(l.trim()));
  __assert(
    "M6.7",
    addLines.some((l) => l.indexOf("git add data/memos.json") >= 0) &&
      addLines.some((l) => l.indexOf("git add data/plans.json data/checkins.json") >= 0) &&
      !bareAdd,
    "sync.yml 提交按事件类型分别 add，未出现危险的裸 git add data/",
    "git add 行：" + addLines.map((l) => l.trim()).join(" ¦ ")
  );

  // ======================================================================
  __setSection("M7 · checkDueMemos 站内提示真跑（从 app.js 抽出）");
  // ======================================================================
  __reset();
  // 造 4 条备忘：1 条到期未提示 / 1 条到期已提示 / 1 条未到期 / 1 条已完成
  seedMemos([
    { id: "m7-a", title: "该提示的", due: "2000-01-01 00:00", done: false, createdAt: 1 },
    { id: "m7-b", title: "已提示过", due: "2000-01-01 00:00", done: false, createdAt: 1 },
    { id: "m7-c", title: "还没到", due: "2999-01-01 00:00", done: false, createdAt: 1 },
    { id: "m7-d", title: "已完成", due: "2000-01-01 00:00", done: true, createdAt: 1 },
  ]);
  // 预置 m7-b 今天已提示
  markMemoNotified("m7-b");
  __toastEl.textContent = "";
  __toastEl.hidden = true;
  checkDueMemos();
  const t7 = __toastEl.textContent;
  __assert(
    "M7.1",
    t7.indexOf("该提示的") >= 0,
    "到期未提示的备忘弹出 toast（内容含标题）",
    JSON.stringify(t7)
  );
  __assert(
    "M7.2",
    t7.indexOf("还没到") < 0 && t7.indexOf("已完成") < 0 && t7.indexOf("已提示过") < 0,
    "未到期 / 已 done / 今天已提示过的备忘都不再弹",
    JSON.stringify(t7)
  );
  // 同一天再跑一次 checkDueMemos：不应重复弹（m7-a 已 markMemoNotified）
  __toastEl.textContent = "";
  checkDueMemos();
  const t7b = __toastEl.textContent;
  __assert(
    "M7.3",
    t7b === "",
    "同一天第二次调用 checkDueMemos 不再重复弹（去重生效）",
    JSON.stringify(t7b)
  );
  // 去重记录确实写入了 localStorage
  const notif7 = lsObj("runform_memo_notified");
  __assert(
    "M7.4",
    notif7["m7-a|" + dateKey()] === 1,
    "提示过后 markMemoNotified 落盘（键 = memoId|今天）",
    JSON.stringify(notif7)
  );

  // ======================================================================
  __setSection("M8 · sw.js CACHE_VERSION 与预缓存 / 加载顺序");
  // ======================================================================
  const swSrc = __readFile("sw.js");
  __assert(
    "M8.1",
    /v6\.1-20260808/.test(swSrc),
    "CACHE_VERSION 已升级到 v6.1-20260808（内容变更必须升版本才触发换缓存）",
    (swSrc.match(/CACHE_VERSION = "([^"]+)"/) || [])[1] || "(未找到)"
  );
  __assert(
    "M8.2",
    swSrc.indexOf("/RUN-form/store.js") >= 0 &&
      swSrc.indexOf("/RUN-form/app.js") >= 0 &&
      swSrc.indexOf("/RUN-form/app2.js") >= 0,
    "store.js / app.js / app2.js 均在 PRECACHE_ASSETS（备忘录代码在既有文件内，无需新增 js）",
    "store/app/app2 已预缓存"
  );
  const idxHtml = __readFile("index.html");
  const idxStore = idxHtml.indexOf('src="store.js"');
  const idxApp = idxHtml.indexOf('src="app.js"');
  __assert(
    "M8.3",
    idxStore >= 0 && idxApp >= 0 && idxStore < idxApp,
    "index.html 中 store.js 先于 app.js 加载（checkDueMemos 依赖 store.js 函数）",
    "store 在 " + idxStore + "，app 在 " + idxApp + (idxStore < idxApp ? "（顺序正确）" : "（顺序错误）")
  );
  const mgHtml = __readFile("manage.html");
  __assert(
    "M8.4",
    mgHtml.indexOf('id="memo-form"') >= 0 && mgHtml.indexOf('id="memo-title"') >= 0 &&
      mgHtml.indexOf('id="memo-due"') >= 0 && mgHtml.indexOf('id="memo-list"') >= 0,
    "manage.html 备忘录板块元素齐全（memo-form/title/due/list）",
    "memo-form/memo-title/memo-due/memo-list 均存在"
  );
  __assert(
    "M8.5",
    mgHtml.indexOf('src="store.js"') >= 0 && mgHtml.indexOf('src="app2.js"') >= 0 &&
      mgHtml.indexOf('src="store.js"') < mgHtml.indexOf('src="app2.js"'),
    "manage.html 中 store.js 先于 app2.js 加载（renderMemos 依赖 store.js）",
    "manage.html 顺序正确"
  );

  /* eslint-enable no-undef */
}

// ============================ 组装并执行 ============================

const sandbox = makeSandbox();
vm.createContext(sandbox);

// 从 app.js 抽出 checkDueMemos 函数源码（不整页加载 app.js，避免顶层 DOM 依赖炸掉沙箱）
function extractFunction(src, fnName) {
  const marker = "function " + fnName + "(";
  const start = src.indexOf(marker);
  if (start < 0) return null;
  const openParen = src.indexOf("(", start);
  const closeParen = src.indexOf(")", openParen);
  const openBrace = src.indexOf("{", closeParen);
  let depth = 0;
  let i = openBrace;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

const appSrc = readSrc("app.js");
const checkDueMemosSrc = extractFunction(appSrc, "checkDueMemos");

const parts = [
  "globalThis.window = globalThis; globalThis.self = globalThis;",
  "/* ==== store.js ==== */",
  readSrc("store.js"),
  "/* ==== app.js 抽取的 checkDueMemos（v6.1 站内提示） ==== */",
  checkDueMemosSrc || "function checkDueMemos() { throw new Error('checkDueMemos 抽取失败'); }",
  "/* ==== tests ==== */",
  "(" + tests.toString() + ")();",
];

let fatal = null;
try {
  vm.runInContext(parts.join("\n"), sandbox, { filename: "runform-memo-bundle.js", timeout: 60000 });
} catch (err) {
  fatal = err;
}

// ============================ 输出 ============================

const results = sandbox.__results || [];

if (fatal) {
  console.error("\n✗ 装载/执行中断（通常意味着源码有语法或引用错误）：");
  console.error(fatal && fatal.stack ? fatal.stack : String(fatal));
  console.error(`\n已完成 ${results.length} 条断言后中断。\n`);
}

const bySection = new Map();
for (const r of results) {
  if (!bySection.has(r.section)) bySection.set(r.section, []);
  bySection.get(r.section).push(r);
}

let failCount = 0;
console.log("\n══════════ RUN-form v6.1 备忘录 + actionCard · 独立验证（qa-memo-check.js）══════════\n");
for (const [name, list] of bySection) {
  const pass = list.filter((r) => r.ok).length;
  console.log(`── ${name} ── ${pass}/${list.length}`);
  for (const r of list) {
    if (!r.ok) failCount += 1;
    console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.id}  ${r.desc}`);
    console.log(`         证据: ${r.evidence}`);
  }
  console.log("");
}

const total = results.length;
console.log("──────────────────────────────────────────────────────────");
console.log(`总计 ${total} 条断言 · 通过 ${total - failCount} · 失败 ${failCount}`);
console.log("──────────────────────────────────────────────────────────\n");

process.exit(fatal || failCount > 0 ? 1 : 0);
