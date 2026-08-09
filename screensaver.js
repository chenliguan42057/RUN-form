/**
 * screensaver.js — D5 星河屏保（默认关闭 + 能力门控）
 *
 * 主理人拍板：默认 OFF。不支持 WakeLock 的浏览器直接隐藏入口，而不是灰着。
 *
 * 场景：把手机横过来立在桌上，屏幕不熄，看时间和自己的连续天数。
 *
 * 约定（白屏防御）：
 *  - 全文件 IIFE，只暴露 window.Screensaver
 *  - 覆盖层 z-index 走 overlay 层（80），toast 仍在它之上
 *  - 静默 / reduce-motion → 只留静态排版，不跑 rAF
 *  - 任意点击 / 按键 / 触摸退出；退出必须释放 WakeLock
 */
(function (g) {
  "use strict";

  var KEY = "runform_screensaver";
  var IDLE_DEFAULT = 5 * 60 * 1000; // 5 分钟无操作

  var overlay = null;
  var canvas = null;
  var ctx = null;
  var raf = 0;
  var clockTimer = 0;
  var idleTimer = 0;
  var idleMs = IDLE_DEFAULT;
  var lock = null;
  var active = false;
  var stars = [];
  var armed = false;

  var LINES = [
    "夜还长，你已经比昨天多亮了一点。",
    "不用赶路，星星本来就走得慢。",
    "把手机放下吧，光留在这儿替你亮着。",
    "今天这颗，也算数。",
    "睡前看一眼，明天还能接上。"
  ];

  /* ============================================================
   * 能力门控
   * ========================================================== */

  /** 只有支持 WakeLock（屏幕常亮）才算「能做屏保」，否则入口直接不出现 */
  function isSupported() {
    try {
      if (!g.requestAnimationFrame) return false;
      if (!g.navigator || !g.navigator.wakeLock) return false;
      if (typeof g.navigator.wakeLock.request !== "function") return false;
      var c = document.createElement("canvas");
      return !!(c.getContext && c.getContext("2d"));
    } catch (e) {
      return false;
    }
  }

  function isEnabled() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setEnabled(on) {
    try {
      if (on) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch (e) {
      /* 忽略 */
    }
    if (!on) {
      disarm();
      if (active) exit();
    } else {
      armIdle(idleMs);
    }
    return !!on;
  }

  /* ============================================================
   * WakeLock
   * ========================================================== */

  function acquireLock() {
    try {
      if (!g.navigator || !g.navigator.wakeLock) return;
      g.navigator.wakeLock.request("screen").then(
        function (l) {
          lock = l;
          try {
            l.addEventListener("release", function () {
              lock = null;
            });
          } catch (e) {
            /* 忽略 */
          }
        },
        function () {
          lock = null;
        }
      );
    } catch (e) {
      lock = null;
    }
  }

  function releaseLock() {
    try {
      if (lock && lock.release) lock.release();
    } catch (e) {
      /* 忽略 */
    }
    lock = null;
  }

  /* ============================================================
   * 画面
   * ========================================================== */

  function two(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function cssColor(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function canAnimate() {
    try {
      if (g.Sensory && g.Sensory.canAnimate) return g.Sensory.canAnimate();
    } catch (e) {
      /* 忽略 */
    }
    return true;
  }

  function resize() {
    if (!canvas) return;
    var dpr = Math.min(2, g.devicePixelRatio || 1);
    var w = g.innerWidth || 360;
    var h = g.innerHeight || 640;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    var w = g.innerWidth || 360;
    var h = g.innerHeight || 640;
    stars = [];
    for (var i = 0; i < 60; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.4 + 0.4,
        vy: 0.08 + Math.random() * 0.16,
        ph: Math.random() * Math.PI * 2
      });
    }
  }

  function frame(ts) {
    if (!active) return;
    raf = g.requestAnimationFrame(frame);
    var w = g.innerWidth || 360;
    var h = g.innerHeight || 640;
    ctx.clearRect(0, 0, w, h);
    var col = cssColor("--fx-spark", "#f5c451");
    var t = ts / 1000;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y += s.vy;
      if (s.y > h + 4) {
        s.y = -4;
        s.x = Math.random() * w;
      }
      ctx.globalAlpha = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.7 + s.ph));
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function tickClock() {
    var el = document.getElementById("ss-clock");
    if (!el) return;
    var d = new Date();
    el.textContent = two(d.getHours()) + ":" + two(d.getMinutes());
    var sec = document.getElementById("ss-sec");
    if (sec) sec.textContent = two(d.getSeconds());
  }

  function statLine() {
    var streak = 0;
    var total = 0;
    try {
      var gs = (g.globalStreak && g.globalStreak()) || { current: 0, best: 0 };
      streak = typeof gs.current === "number" ? gs.current : 0;
    } catch (e) {
      streak = 0;
    }
    try {
      total = ((g.loadCheckins && g.loadCheckins()) || []).length;
    } catch (e2) {
      total = 0;
    }
    var rank = "";
    try {
      if (g.Rank && g.Rank.getRank) {
        var r = g.Rank.getRank();
        if (r) rank = (r.icon || "") + " " + (r.name || "");
      }
    } catch (e3) {
      rank = "";
    }
    return { streak: streak, total: total, rank: rank };
  }

  /* ============================================================
   * 进入 / 退出
   * ========================================================== */

  function onExitEvent() {
    exit();
  }

  function enter() {
    if (active) return false;
    if (!isSupported()) return false;
    active = true;
    disarm();

    var root = document.getElementById("overlay-root") || document.body;
    overlay = document.createElement("div");
    overlay.id = "screensaver";
    overlay.className = "ss-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "星河屏保");

    var s = statLine();
    var line = LINES[Math.floor(Math.random() * LINES.length)];

    overlay.innerHTML =
      '<canvas class="ss-canvas" id="ss-canvas" aria-hidden="true"></canvas>' +
      '<div class="ss-inner">' +
      '<div class="ss-time"><span id="ss-clock">--:--</span><sup id="ss-sec">00</sup></div>' +
      '<div class="ss-streak"><b>' +
      s.streak +
      "</b><span>天连续</span></div>" +
      (s.rank ? '<div class="ss-rank">' + s.rank + "</div>" : "") +
      '<p class="ss-line">' +
      line +
      "</p>" +
      '<p class="ss-hint">轻触任意处退出</p>' +
      "</div>";

    root.appendChild(overlay);
    document.body.classList.add("ss-on");

    canvas = document.getElementById("ss-canvas");
    if (canvas && canvas.getContext) {
      ctx = canvas.getContext("2d");
      resize();
      if (canAnimate()) {
        seed();
        raf = g.requestAnimationFrame(frame);
      }
    }

    tickClock();
    clockTimer = g.setInterval(tickClock, 1000);
    acquireLock();

    overlay.addEventListener("click", onExitEvent);
    overlay.addEventListener("touchstart", onExitEvent, { passive: true });
    document.addEventListener("keydown", onExitEvent);
    try {
      g.addEventListener("resize", resize, { passive: true });
    } catch (e) {
      /* 忽略 */
    }
    return true;
  }

  function exit() {
    if (!active) return false;
    active = false;

    if (raf) {
      g.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (clockTimer) {
      g.clearInterval(clockTimer);
      clockTimer = 0;
    }
    releaseLock();

    document.removeEventListener("keydown", onExitEvent);
    try {
      g.removeEventListener("resize", resize);
    } catch (e) {
      /* 忽略 */
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    canvas = null;
    ctx = null;
    stars = [];

    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.body.classList.remove("ss-on");

    if (isEnabled()) armIdle(idleMs);
    return true;
  }

  /* ============================================================
   * 空闲自动进入
   * ========================================================== */

  function resetIdle() {
    if (!armed || active) return;
    if (idleTimer) g.clearTimeout(idleTimer);
    idleTimer = g.setTimeout(function () {
      if (isEnabled() && !document.hidden) enter();
    }, idleMs);
  }

  function armIdle(ms) {
    if (!isSupported() || !isEnabled()) return false;
    if (typeof ms === "number" && ms >= 30000) idleMs = ms;
    if (!armed) {
      armed = true;
      var evts = ["pointerdown", "keydown", "touchstart", "scroll", "mousemove"];
      for (var i = 0; i < evts.length; i++) {
        document.addEventListener(evts[i], resetIdle, { passive: true });
      }
    }
    resetIdle();
    return true;
  }

  function disarm() {
    if (idleTimer) {
      g.clearTimeout(idleTimer);
      idleTimer = 0;
    }
  }

  g.Screensaver = {
    isSupported: isSupported,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    isActive: function () {
      return active;
    },
    enter: enter,
    exit: exit,
    armIdle: armIdle,
    disarm: disarm
  };
})(window);
