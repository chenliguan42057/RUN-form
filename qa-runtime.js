/**
 * qa-runtime.js —— RUN-form v4「星河契约」运行时行为检查 · 执行器（QA / Edward 自建）
 *
 * ⚠️ 这是测试脚本，不是站点源文件。发布前可连同 qa-static.js / qa-runtime-tests.js 一起删除。
 *
 * 设计要点（避开 vm 常见坑）：
 *   store.js / components.js 顶层用的是 `const` / `let` 声明。在 Node 的 vm 里，
 *   顶层 const/let **不会**挂到 context 对象上 —— 分两次 runInContext 就取不到
 *   PLAN_KEY、STAR_MARGIN_X 这类常量（这正是「vm 顶层 const 取不到」的经典坑）。
 *   ⇒ 解决办法：把 store.js + components.js + qa-runtime-tests.js 拼成【同一个脚本】
 *     一次性执行，测试代码与被测代码共享同一份顶层词法作用域，常量与函数全都可见。
 *
 * 运行：node qa-runtime.js
 * 退出码：0 = 全过，1 = 有 FAIL
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const readSrc = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ============================ 浏览器环境替身 ============================

/**
 * 构造够用的 DOM / localStorage 替身。
 * 只实现被测代码真正会碰到的 API。
 * @returns {Object} vm sandbox
 */
function makeSandbox() {
  const storeMap = new Map();

  const localStorage = {
    getItem: (k) => (storeMap.has(String(k)) ? storeMap.get(String(k)) : null),
    setItem: (k, v) => storeMap.set(String(k), String(v)),
    removeItem: (k) => storeMap.delete(String(k)),
    clear: () => storeMap.clear(),
  };

  /** 极简元素替身 */
  function makeEl(tag) {
    const set = new Set();
    return {
      tagName: String(tag || "div").toUpperCase(),
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: true,
      style: {},
      dataset: {},
      children: [],
      classList: {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        toggle: (c, on) => {
          if (on === undefined) return set.has(c) ? (set.delete(c), false) : (set.add(c), true);
          return on ? (set.add(c), true) : (set.delete(c), false);
        },
        contains: (c) => set.has(c),
      },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      focus() {},
      click() {},
      getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    };
  }

  const document = {
    documentElement: makeEl("html"),
    body: makeEl("body"),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  let uuidSeq = 0;
  const window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    crypto: { randomUUID: () => "uuid-" + String(++uuidSeq).padStart(6, "0") },
    addEventListener: () => {},
    removeEventListener: () => {},
    confirm: () => true,
    location: { href: "http://localhost/manage.html", origin: "http://localhost" },
    localStorage,
    document,
  };
  window.window = window;

  const sandbox = {
    window,
    document,
    localStorage,
    navigator: { userAgent: "qa-runtime", onLine: true },
    fetch: () => Promise.reject(new Error("qa-runtime: 网络已禁用")),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    URL: { createObjectURL: () => "blob:qa", revokeObjectURL: () => {} },
    Blob: class { constructor(parts) { this.parts = parts; } },
    FileReader: class { readAsText() {} },
  };
  sandbox.globalThis = sandbox;

  // —— 测试桥接：断言收集 / 环境重置，供拼进来的测试代码调用 ——
  sandbox.__results = [];
  sandbox.__section = "";
  sandbox.__setSection = (n) => { sandbox.__section = n; };
  sandbox.__assert = (id, ok, desc, evidence) => {
    sandbox.__results.push({
      section: sandbox.__section,
      id,
      ok: Boolean(ok),
      desc,
      evidence: String(evidence == null ? "" : evidence).slice(0, 240),
    });
  };
  sandbox.__reset = () => storeMap.clear();

  return sandbox;
}

// ============================ 组装并执行 ============================

const sandbox = makeSandbox();
vm.createContext(sandbox);

const parts = [
  "/* ==== store.js ==== */",
  readSrc("store.js"),
  "/* ==== components.js ==== */",
  readSrc("components.js"),
  "/* ==== qa-runtime-tests.js ==== */",
  readSrc("qa-runtime-tests.js"),
];

let fatal = null;
try {
  vm.runInContext(parts.join("\n"), sandbox, {
    filename: "runform-bundle.js",
    timeout: 30000,
  });
} catch (err) {
  fatal = err;
}

// ============================ 输出 ============================

const results = sandbox.__results || [];

if (fatal) {
  console.error("\n✗ 运行时装载/执行失败（这通常意味着源码有语法或引用错误）：");
  console.error(fatal && fatal.stack ? fatal.stack : String(fatal));
  console.error(`\n已完成 ${results.length} 条断言后中断。\n`);
}

const bySection = new Map();
for (const r of results) {
  if (!bySection.has(r.section)) bySection.set(r.section, []);
  bySection.get(r.section).push(r);
}

let failCount = 0;
console.log("\n══════════ RUN-form v4 运行时行为检查（qa-runtime.js）══════════\n");
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
