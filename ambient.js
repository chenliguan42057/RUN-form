/**
 * ambient.js — D4 星轨呼吸背景（默认关闭 + 能力门控 + FPS 自降级）
 *
 * 主理人拍板：默认 OFF，只有用户手动打开、或「充电 + Wi-Fi」时才允许自动起。
 * Safari 没有 getBattery → canAuto() 恒为 false，只能手动开。
 *
 * 约定（白屏防御）：
 *  - 全文件 IIFE，只暴露 window.Ambient
 *  - canvas z-index = 0，pointer-events:none，永远在内容之下
 *  - 静默 / reduce-motion / 页面隐藏 → 立刻停 rAF
 *  - 帧率掉下去自己降级，降到底就自杀，绝不拖垮首页
 */
(function (g) {
  "use strict";

  var KEY = "runform_ambient";

  var canvas = null;
  var ctx = null;
  var raf = 0;
  var running = false;
  var stars = [];
  var dpr = 1;

  var BASE_COUNT = 70; // 初始星数
  var MIN_COUNT = 24; // 降级下限
  var count = BASE_COUNT;

  // FPS 采样
  var lastTs = 0;
  var acc = 0;
  var frames = 0;
  var lowRounds = 0;
  var degraded = false;

  /* ============================================================
   * 开关状态
   * ========================================================== */

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
    return !!on;
  }

  /* ============================================================
   * 能力门控
   * ========================================================== */

  var battery = null;
  var batteryProbed = false;

  function probeBattery() {
    if (batteryProbed) return;
    batteryProbed = true;
    try {
      if (g.navigator && typeof g.navigator.getBattery === "function") {
        g.navigator.getBattery().then(
          function (b) {
            battery = b;
          },
          function () {
            battery = null;
          }
        );
      }
    } catch (e) {
      battery = null;
    }
  }

  function onWifi() {
    try {
      var c = g.navigator.connection || g.navigator.mozConnection || g.navigator.webkitConnection;
      if (!c) return false;
      if (c.type === "wifi" || c.type === "ethernet") return true;
      // 没有 type 的实现退而求其次看 effectiveType
      if (!c.type && (c.effectiveType === "4g" || c.effectiveType === "5g")) return !c.saveData;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 是否允许「自动」开启。
   * 手动开过 → 直接 true；否则要求 充电中 && Wi-Fi。
   */
  function canAuto() {
    if (isEnabled()) return true;
    probeBattery();
    if (!battery) return false; // Safari 等没有 Battery API 的一律不自动
    if (!battery.charging) return false;
    return onWifi();
  }

  /** 是否支持（用于决定入口 DOM 显不显示） */
  function isSupported() {
    try {
      if (!g.requestAnimationFrame) return false;
      var c = document.createElement("canvas");
      return !!(c.getContext && c.getContext("2d"));
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
   * 画面
   * ========================================================== */

  function cssColor(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function ensureCanvas() {
    if (canvas && canvas.parentNode) return canvas;
    canvas = document.createElement("canvas");
    canvas.id = "ambient-layer";
    canvas.className = "ambient-layer";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    try {
      g.addEventListener("resize", resize, { passive: true });
    } catch (e) {
      g.addEventListener("resize", resize);
    }
    return canvas;
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, g.devicePixelRatio || 1);
    var w = g.innerWidth || document.documentElement.clientWidth || 360;
    var h = g.innerHeight || document.documentElement.clientHeight || 640;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed(n) {
    var w = g.innerWidth || 360;
    var h = g.innerHeight || 640;
    stars = [];
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.5 + 0.5,
        // 呼吸相位错开，整屏才不会一起明灭
        ph: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 0.8,
        drift: (Math.random() - 0.5) * 0.06
      });
    }
  }

  function frame(ts) {
    if (!running) return;
    raf = g.requestAnimationFrame(frame);

    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;

    // FPS 采样：每 1.5s 结算一次
    acc += dt;
    frames++;
    if (acc >= 1500) {
      var fps = (frames * 1000) / acc;
      acc = 0;
      frames = 0;
      if (fps < 32) {
        lowRounds++;
        if (lowRounds === 1 && count > MIN_COUNT) {
          count = Math.max(MIN_COUNT, Math.floor(count * 0.5));
          seed(count);
          degraded = true;
        } else if (lowRounds >= 2) {
          // 降过一次还是卡：这台机器不适合，直接收摊
          stop();
          return;
        }
      } else {
        lowRounds = 0;
      }
    }

    var w = g.innerWidth || 360;
    var h = g.innerHeight || 640;
    ctx.clearRect(0, 0, w, h);

    var col = cssColor("--fx-spark", "#f5c451");
    var t = ts / 1000;

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = 0.18 + 0.34 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      s.y -= s.drift;
      if (s.y < -4) s.y = h + 4;
      if (s.y > h + 4) s.y = -4;

      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ============================================================
   * 生命周期
   * ========================================================== */

  function allowedNow() {
    if (g.Sensory && g.Sensory.canAnimate && !g.Sensory.canAnimate()) return false;
    if (document.hidden) return false;
    return isSupported();
  }

  /** 真正开始跑（不改存储，调用方负责 setEnabled） */
  function start() {
    if (running) return true;
    if (!allowedNow()) return false;
    ensureCanvas();
    if (!ctx) return false;
    count = degraded ? Math.max(MIN_COUNT, Math.floor(BASE_COUNT * 0.5)) : BASE_COUNT;
    seed(count);
    running = true;
    lastTs = 0;
    acc = 0;
    frames = 0;
    raf = g.requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    running = false;
    if (raf) {
      g.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (ctx && canvas) {
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch (e) {
        /* 忽略 */
      }
    }
    stars = [];
  }

  function isOn() {
    return running;
  }

  /** 用户手动开关：会写存储 */
  function toggle(on) {
    var want = typeof on === "boolean" ? on : !isEnabled();
    setEnabled(want);
    if (want) {
      var ok = start();
      if (!ok) {
        // 开不起来就别骗用户说开了
        setEnabled(false);
        return false;
      }
      return true;
    }
    stop();
    return false;
  }

  /**
   * 页面加载时调用：默认关闭，只在 canAuto() 为真时才起。
   */
  function autoStart() {
    probeBattery();
    if (!isEnabled()) return false;
    if (!allowedNow()) return false;
    return start();
  }

  try {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (running) stop();
      } else if (isEnabled() && allowedNow()) {
        start();
      }
    });
  } catch (e) {
    /* 忽略 */
  }

  g.Ambient = {
    canAuto: canAuto,
    isSupported: isSupported,
    isEnabled: isEnabled,
    isOn: isOn,
    start: start,
    stop: stop,
    toggle: toggle,
    autoStart: autoStart
  };
})(window);
