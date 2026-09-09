/**
 * js/ui/scene.js —— 时段联动背景 / 云 / 彩虹 / 蝴蝶 / 花瓣 / 萤火虫 / 天气覆盖
 *
 * 归属：B 组（T03）。签名冻结（设计文档 §5.11）。
 *
 * 跨组约定（§9.3 耦合点 3）：
 *   · 订阅 bus 的 "garden:wither"，载荷 { ratio }（0-1 一个数），据此调 setWeather()。
 *     发布方是 C 组的 punishment，两边都不 import 对方。
 *   · 时段切换时 emit("scene:periodChange", {period})，pet / garden 订阅。
 *
 * 性能红线（§8.6）：
 *   · 全局只允许 1 个 requestAnimationFrame 主循环，由本文件持有；
 *     其余模块（countdown.tick / fx 粒子）注册回调，禁止各开各的。
 *   · 常驻粒子：蝴蝶 ≤ 6、花瓣 ≤ 20、萤火虫 ≤ 15；屏宽 < 480 减半。
 *   · 只动 transform / opacity，绝不动 width / top / box-shadow。
 *   · prefers-reduced-motion 或 profile.settings.reduceMotion 时全部降级为瞬时切换。
 */
(function (RF) {
  "use strict";

  /** 6 个时段（from 含，to 不含；night 跨 20→6） */
  var PERIODS = [
    { from: 6, to: 9, key: "sunrise", sky: ["#FFD1B3", "#FFB6C1"], note: "精灵打哈欠 / 露水" },
    { from: 9, to: 12, key: "morning", sky: ["#87CEEB", "#BFEFFF"], note: "" },
    { from: 12, to: 14, key: "noon", sky: ["#FFE66D", "#FFF3B0"], note: "精灵午睡" },
    { from: 14, to: 18, key: "golden", sky: ["#FFE9A8", "#98FB98"], note: "" },
    { from: 18, to: 20, key: "dusk", sky: ["#FFA07A", "#E6E6FA"], note: "" },
    { from: 20, to: 6, key: "night", sky: ["#1B2A5B", "#3D5A98"], note: "萤火虫 + 月亮" }
  ];

  var reduced = false;        // profile.settings.reduceMotion 或系统偏好
  var curKey = "";            // 当前生效时段 key
  var curWeather = "clear";   // 当前天气 kind
  var rafId = null;
  var frameCbs = [];          // 注册到唯一主循环的回调

  /* ---------------- DOM 助手（缺失即安全跳过） ---------------- */
  function layer(id) {
    try { return document.getElementById(id); } catch (e) { return null; }
  }
  function decorLayer() { return layer("decor-layer"); }
  function particleLayer() { return layer("particle-layer"); }
  function weatherLayer() { return layer("weather-layer"); }
  function cloudLayer() { return layer("cloud-layer"); }

  function countClass(parent, cls) {
    if (!parent) return 0;
    return parent.querySelectorAll("." + cls).length;
  }

  /** 屏宽 < 480 时粒子上限减半（性能红线） */
  function cap(base) {
    try {
      if (window.innerWidth < 480) return Math.ceil(base / 2);
    } catch (e) { /* ignore */ }
    return base;
  }

  function shouldReduce() {
    if (reduced) return true;
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ---------------- 唯一 rAF 主循环 ---------------- */
  function onFrame(cb) {
    if (typeof cb === "function" && frameCbs.indexOf(cb) === -1) frameCbs.push(cb);
  }
  function loop(ts) {
    for (var i = 0; i < frameCbs.length; i++) {
      try { frameCbs[i](ts); } catch (e) { /* 隔离：单个回调出错不影响其余 */ }
    }
    rafId = window.requestAnimationFrame(loop);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    // 同步 profile 的 reduceMotion 偏好
    try {
      if (RF.store && RF.store.loadProfile) {
        var p = RF.store.loadProfile();
        reduced = !!(p && p.settings && p.settings.reduceMotion);
      }
    } catch (e) { /* ignore */ }

    buildClouds();
    applyPeriod();

    // 订阅 C 组 punishment 经 bus 驱动的断签天气
    if (RF.bus) {
      RF.bus.on("garden:wither", function (payload) {
        var ratio = payload && typeof payload.ratio === "number" ? payload.ratio : 0;
        setWeather(ratioToKind(ratio));
      });
      RF.bus.on("scene:weather", function (payload) {
        try { setWeather(payload && payload.weather); } catch (e) {}
      });
    }

    // 每 60s 重算时段（让夜间自动开萤火虫、白天自动关）
    try {
      setInterval(function () { applyPeriod(); }, 60000);
    } catch (e) { /* ignore */ }

    if (rafId == null) rafId = window.requestAnimationFrame(loop);
  }

  /** 建几朵静态飘云（仅装饰层存在时） */
  function buildClouds() {
    var cl = cloudLayer();
    if (!cl) return;
    cl.innerHTML = "";
    var n = 3;
    for (var i = 0; i < n; i++) {
      var c = document.createElement("div");
      c.className = "g-cloud";
      c.style.top = (8 + i * 14) + "%";
      c.style.left = (i * 33) + "%";
      c.style.setProperty("--cloud-dur", (38 + i * 12) + "s");
      c.style.setProperty("--cloud-delay", (-i * 10) + "s");
      cl.appendChild(c);
    }
  }

  /* ---------------- 时段 ---------------- */
  function findPeriod(hour) {
    var h = typeof hour === "number" ? hour : new Date().getHours();
    for (var i = 0; i < PERIODS.length; i++) {
      var p = PERIODS[i];
      if (p.from < p.to) {
        if (h >= p.from && h < p.to) return p;
      } else {
        // 跨夜（night: 20→6）
        if (h >= p.from || h < p.to) return p;
      }
    }
    return PERIODS[1];
  }

  function applyPeriod(hour) {
    var p = findPeriod(hour);
    var root = document.documentElement;
    root.style.setProperty("--g-sky-from", "var(--g-sky-" + p.key + "-from)");
    root.style.setProperty("--g-sky-to", "var(--g-sky-" + p.key + "-to)");
    if (p.key !== curKey) {
      curKey = p.key;
      root.setAttribute("data-period", p.key);
      // 夜间自动开萤火虫，其余时段关
      fireflies(p.key === "night");
      if (RF.bus) {
        try { RF.bus.emit("scene:periodChange", { period: p }); } catch (e) { /* ignore */ }
      }
    }
    return p;
  }

  /* ---------------- 天气（断签灰度，由 punishment 经 bus 驱动） ---------------- */
  function ratioToKind(ratio) {
    if (ratio <= 0) return "clear";
    if (ratio < 0.3) return "cloudy";
    if (ratio < 0.6) return "gray";
    if (ratio < 1) return "fallen";
    return "bw";
  }

  function setWeather(kind) {
    if (kind === curWeather) return;
    curWeather = kind;
    var wl = weatherLayer();
    if (wl) {
      wl.className = "g-scene__weather g-scene__weather--" + kind;
    }
    try { document.documentElement.setAttribute("data-weather", kind); } catch (e) { /* ignore */ }
  }

  /* ---------------- 蝴蝶 ---------------- */
  function spawnButterfly() {
    if (shouldReduce()) return;
    var l = decorLayer();
    if (!l) return;
    if (countClass(l, "g-butterfly") >= cap(6)) return;
    var el = document.createElement("div");
    el.className = "g-butterfly";
    el.style.left = RF.util.randInt(0, 92) + "%";
    el.style.setProperty("--bf-dur", RF.util.randInt(16, 28) + "s");
    el.style.setProperty("--bf-delay", (-RF.util.randInt(0, 20)) + "s");
    el.style.setProperty("--bf-top", RF.util.randInt(18, 60) + "%");
    l.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 32000);
  }

  /* ---------------- 花瓣（常驻装饰层，上限 20） ---------------- */
  function spawnPetal() {
    if (shouldReduce()) return;
    var l = decorLayer();
    if (!l) return;
    if (countClass(l, "g-petal") >= cap(20)) return;
    var el = document.createElement("div");
    el.className = "g-petal";
    el.style.left = RF.util.randInt(0, 96) + "%";
    el.style.setProperty("--pt-dur", RF.util.randInt(9, 16) + "s");
    el.style.setProperty("--pt-delay", (-RF.util.randInt(0, 12)) + "s");
    el.style.setProperty("--pt-x", RF.util.randInt(-40, 40) + "px");
    el.textContent = RF.util.pick(["🌸", "🌼", "🍃", "🌺"]) || "🌸";
    l.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 18000);
  }

  /* ---------------- 萤火虫（夜间自动开） ---------------- */
  function fireflies(on) {
    var l = decorLayer();
    if (!l) return;
    if (!on) {
      var old = l.querySelectorAll(".g-firefly");
      for (var i = 0; i < old.length; i++) {
        if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
      }
      return;
    }
    if (shouldReduce()) return;
    var max = cap(15);
    var have = countClass(l, "g-firefly");
    for (var k = have; k < max; k++) {
      var el = document.createElement("div");
      el.className = "g-firefly";
      el.style.left = RF.util.randInt(2, 96) + "%";
      el.style.top = RF.util.randInt(30, 86) + "%";
      el.style.setProperty("--ff-dur", (RF.util.randInt(22, 40) / 10) + "s");
      el.style.setProperty("--ff-delay", (-RF.util.randInt(0, 30) / 10) + "s");
      l.appendChild(el);
    }
  }

  /* ---------------- 外部接口 ---------------- */
  /** 由页面在 store.init 之后调用，同步 profile 的 reduceMotion。 */
  function setReduceMotion(v) {
    reduced = !!v;
    if (reduced) fireflies(false);
  }
  function isReduced() { return shouldReduce(); }
  function currentPeriod() { return findPeriod(); }

  RF.scene = {
    PERIODS: PERIODS,
    init: init,
    applyPeriod: applyPeriod,
    setWeather: setWeather,
    spawnButterfly: spawnButterfly,
    spawnPetal: spawnPetal,
    fireflies: fireflies,
    onFrame: onFrame,
    setReduceMotion: setReduceMotion,
    isReduced: isReduced,
    currentPeriod: currentPeriod
  };
})(window.RF = window.RF || {});
