/**
 * 星河契约 · 四时天色（theme.js，v6 · L3 交互层）
 *
 * 职责：按时辰给整站换天色，让「什么时候来看」也成为体验的一部分。
 *   origin   原初（默认）—— 不写任何覆盖块，即 styles.css 的原始配色（白天 08:00–17:59）
 *   midnight 子夜        —— 18:00–23:59，最冷最暗，星最亮
 *   polar    极昼        —— 00:00–04:59，青白冷光
 *   dawn     破晓        —— 05:00–07:59，暖金压紫
 *
 * 契约：
 *   · **只覆盖既有 CSS 变量**，一个新 UI 变量都不许发明（新增的只有 v6 的 4 个 --fx-* / --rank-glow / --oath-veil）；
 *   · 选择器统一 :root[data-theme="xxx"]，origin 不写覆盖块（默认即原初）；
 *   · 值写在 <html data-theme>，<head> 内联脚本先行设置，防止刷新闪白。
 *
 * ⚠️ 本文件禁止声明 `$`；取元素一律 document.getElementById 全写。
 */
(function (g) {
  "use strict";

  /** 全部主题键。origin 永远排第一，作为「不覆盖」的默认态 */
  var THEMES = ["origin", "midnight", "polar", "dawn"];

  /** 主题的中文名与一句话说明，供设定面板展示 */
  var META = {
    origin: { name: "原初", hint: "梵高的那片海，任何时候都对", icon: "🌌" },
    midnight: { name: "子夜", hint: "23:00 起，最冷最暗，星最亮", icon: "🌑" },
    polar: { name: "极昼", hint: "清晨到上午，青白冷光", icon: "🧊" },
    dawn: { name: "破晓", hint: "傍晚到深夜前，暖金压紫", icon: "🌆" },
  };

  /** auto 模式的自动看守句柄 */
  var watchTimer = 0;

  /**
   * 按时辰挑主题。
   * 区间刻意留了 08:00–17:59 归 origin：白天没有特别的天色，回到原初最舒服。
   * @param {Date} [date] 参考时间，缺省取现在
   * @returns {string} 主题键
   */
  function autoPick(date) {
    var d = date instanceof Date ? date : new Date();
    var h = d.getHours();
    if (h < 5) return "polar";
    if (h < 8) return "dawn";
    if (h < 18) return "origin";
    return "midnight";
  }

  /**
   * 读主题设置（含读时净化）。
   * @returns {{mode:"auto"|"manual", value:string}}
   */
  function get() {
    var raw = null;
    try {
      var text = localStorage.getItem("runform_theme");
      raw = text ? JSON.parse(text) : null;
    } catch (e) {
      raw = null;
    }
    var src = raw && typeof raw === "object" ? raw : {};
    var mode = src.mode === "manual" ? "manual" : "auto";
    var value = THEMES.indexOf(src.value) >= 0 ? src.value : "origin";
    return { mode: mode, value: value };
  }

  /**
   * 把主题落到 <html data-theme>。origin 也照常写，方便 CSS 里做兜底选择器。
   * @param {string} value 主题键，非法值回落 origin
   * @returns {string} 实际生效的主题键
   */
  function applyTheme(value) {
    var v = THEMES.indexOf(value) >= 0 ? value : "origin";
    try {
      document.documentElement.dataset.theme = v;
    } catch (e) {
      document.documentElement.setAttribute("data-theme", v);
    }
    return v;
  }

  /**
   * 当前应当生效的主题（auto 走时辰，manual 走用户选择）。
   * @returns {string}
   */
  function resolved() {
    var cfg = get();
    return cfg.mode === "manual" ? cfg.value : autoPick(new Date());
  }

  /**
   * 设置模式并立即生效。
   * @param {"auto"|"manual"} mode 模式
   * @param {string} [value] manual 模式下的主题键
   * @returns {{mode:string, value:string, applied:string}}
   */
  function setMode(mode, value) {
    var m = mode === "manual" ? "manual" : "auto";
    var v = THEMES.indexOf(value) >= 0 ? value : get().value;
    var cfg = { mode: m, value: v };
    try {
      localStorage.setItem("runform_theme", JSON.stringify(cfg));
    } catch (e) {
      console.error("写入主题设置失败：", e);
    }
    var applied = applyTheme(m === "manual" ? v : autoPick(new Date()));
    return { mode: m, value: v, applied: applied };
  }

  /**
   * 启动 auto 模式看守：每 5 分钟检查一次时辰是否跨区间。
   * manual 模式下什么都不做（但看守仍在跑，切回 auto 时立即接管）。
   * 只用一个 setInterval，切页面就随页面销毁，不留后台任务。
   * @returns {void}
   */
  function startAutoWatch() {
    if (watchTimer) return;
    watchTimer = g.setInterval(function () {
      var cfg = get();
      if (cfg.mode !== "auto") return;
      var want = autoPick(new Date());
      var now = document.documentElement.getAttribute("data-theme");
      if (want !== now) applyTheme(want);
    }, 300000);

    // 从后台切回时立刻校一次，别等下一个 5 分钟
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      var cfg = get();
      if (cfg.mode === "auto") applyTheme(autoPick(new Date()));
    });
  }

  // 脚本一加载就把主题落地：<head> 内联脚本已经防了闪白，这里做二次校准
  applyTheme(resolved());

  g.Theme = {
    THEMES: THEMES,
    META: META,
    autoPick: autoPick,
    get: get,
    resolved: resolved,
    applyTheme: applyTheme,
    setMode: setMode,
    startAutoWatch: startAutoWatch,
  };
})(window);
