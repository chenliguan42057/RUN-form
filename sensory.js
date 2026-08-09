/**
 * 星河契约 · 感官内核（sensory.js，v6 · L3 交互层）
 *
 * 职责：把「声 / 振 / 光」三种感官反馈收进一个闸门里，全站只此一处。
 *   · 声 —— WebAudio 合成的清脆 chime，不引入任何音频文件（零请求、离线可用）
 *   · 振 —— navigator.vibrate 短脉冲
 *   · 光 —— #fx-layer canvas 上的星屑粒子
 *
 * 三条硬性红线：
 *   1. **静默总闸** isSilent()：为真时声/振/粒子全关，只留 CSS 脉冲。
 *      读的是裸字符串键 runform_silent（"1"/"0"），<head> 内联脚本零解析即可判断。
 *   2. **AudioContext 单例**：只有 ctx() 持有实例；unlock() 只在真实用户手势里调用且幂等。
 *      Safari / iOS 不给手势就 new AudioContext 会得到一个永远 suspended 的死实例。
 *   3. **粒子池上限 240**：超出直接丢弃新粒子；池空立即停 rAF，不空转烧电。
 *
 * 降级矩阵：
 *   isSilent()              → 声 ✗ 振 ✗ 粒子 ✗（页面只剩 CSS 脉冲）
 *   reduceMotion / 系统偏好 → 声 ✓ 振 ✓ 粒子 ✗（听得见但不晃眼）
 *
 * 加载顺序：store.js → …… → sensory.js → components.js
 * ⚠️ 本文件禁止声明 `$`；取元素一律 document.getElementById 全写。
 */
(function (g) {
  "use strict";

  /** 粒子池硬上限。超过这个数就丢弃新粒子，宁可少几颗也不掉帧 */
  var MAX_PARTICLES = 240;
  /** 单次 burst 默认粒子数 */
  var BURST_COUNT = 18;
  /** 全屏星爆默认粒子数（受 MAX_PARTICLES 二次夹紧） */
  var FULL_COUNT = 140;
  /** 粒子重力（px/s²），让星屑有一点下坠的重量感 */
  var GRAVITY = 220;

  /** AudioContext 单例。除 ctx() 外任何地方都不许 new */
  var audioCtx = null;
  /** 是否已在用户手势里解锁过音频（幂等标记） */
  var unlocked = false;
  /** #fx-layer canvas 与 2d 上下文缓存 */
  var canvas = null;
  var canvasCtx = null;
  /** 活跃粒子数组 */
  var particles = [];
  /** rAF 句柄；为 0 表示当前没有在跑循环 */
  var rafId = 0;
  /** 上一帧时间戳，用于算 dt */
  var lastFrame = 0;
  /** 缓存的 devicePixelRatio，resize 时重算 */
  var dpr = 1;

  // ============================ 静默总闸 ============================

  /**
   * 读裸字符串键 runform_silent。
   * 用裸串而不是 JSON，是为了让 <head> 内联脚本能零解析、零异常地判断。
   * @returns {boolean} true = 静默模式（声/振/粒子全关）
   */
  function isSilent() {
    try {
      return localStorage.getItem("runform_silent") === "1";
    } catch (e) {
      // 隐私模式下读不到 → 按「不静默」处理，体验完整度优先
      return false;
    }
  }

  /**
   * 设置静默总闸。
   * @param {boolean} on true = 开启静默
   * @returns {boolean} 设置后的状态
   */
  function setSilent(on) {
    var v = on ? "1" : "0";
    try {
      localStorage.setItem("runform_silent", v);
    } catch (e) {
      console.error("写入静默开关失败：", e);
    }
    if (on) {
      // 立刻掐断正在响的声音与正在飞的粒子，别让用户等它自己停
      stopAll();
    }
    return Boolean(on);
  }

  /**
   * 动效是否可用（粒子 / rAF 类效果的统一判据）。
   * 静默、系统 reduce、手动 no-motion 三者任一命中即关。
   * @returns {boolean}
   */
  function canAnimate() {
    if (isSilent()) return false;
    try {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return false;
      }
    } catch (e) {
      /* matchMedia 不可用时不拦 */
    }
    return !document.documentElement.classList.contains("no-motion");
  }

  // ============================ 音频 ============================

  /**
   * 取 AudioContext 单例。
   * ⚠️ 只有本函数可以 new。不可用时返回 null，调用方必须判空。
   * @returns {AudioContext|null}
   */
  function ctx() {
    if (audioCtx) return audioCtx;
    var Ctor = g.AudioContext || g.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch (e) {
      console.warn("AudioContext 创建失败，声音降级为静默：", e);
      audioCtx = null;
    }
    return audioCtx;
  }

  /**
   * 在真实用户手势里解锁音频（幂等）。
   * iOS / Safari 只认手势里同步创建或 resume 的上下文，晚一拍就永远 suspended。
   * @returns {boolean} 是否处于可发声状态
   */
  function unlock() {
    if (unlocked && audioCtx && audioCtx.state === "running") return true;
    var ac = ctx();
    if (!ac) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      try {
        ac.resume();
      } catch (e) {
        /* resume 失败就保持静默，不抛给上层 */
      }
    }
    unlocked = true;
    return ac.state !== "closed";
  }

  /** chime 音色表：kind → {freq:[主频, 泛音], dur, gain, type} */
  var CHIMES = {
    /** 打卡：一颗星亮起，短促上扬 */
    star: { freq: [880, 1320], dur: 0.42, gain: 0.16, type: "sine" },
    /** 升段：更厚的双音，带一点庄重 */
    rank: { freq: [523.25, 783.99], dur: 0.9, gain: 0.18, type: "triangle" },
    /** 里程碑：低频鼓 + 高频亮片，仪式感 */
    drum: { freq: [110, 165], dur: 1.1, gain: 0.22, type: "sine" },
    /** 专注结束：温和的两声 */
    focus: { freq: [659.25, 987.77], dur: 0.7, gain: 0.14, type: "sine" },
    /** 签约：最沉的一记，像盖章 */
    oath: { freq: [196, 293.66], dur: 1.3, gain: 0.2, type: "triangle" },
  };

  /**
   * 播放一枚合成 chime。
   * 用 WebAudio 现场合成而非加载音频文件：零网络请求、离线可用、体积为 0。
   * @param {string} kind CHIMES 的键，未知值回落 "star"
   * @returns {boolean} 是否真的发出了声音
   */
  function playChime(kind) {
    if (isSilent()) return false;
    var spec = CHIMES[kind] || CHIMES.star;
    var ac = ctx();
    if (!ac) return false;
    // 后台标签页会把上下文挂起，发声前必须先唤醒
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      try {
        ac.resume();
      } catch (e) {
        return false;
      }
    }
    try {
      var now = ac.currentTime;
      var master = ac.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(spec.gain, now + 0.012);
      master.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);
      master.connect(ac.destination);

      spec.freq.forEach(function (f, i) {
        var osc = ac.createOscillator();
        var gain = ac.createGain();
        osc.type = spec.type;
        osc.frequency.setValueAtTime(f, now);
        // 泛音略微下滑，避免两个纯音叠出电子味
        osc.frequency.exponentialRampToValueAtTime(f * 0.985, now + spec.dur);
        // 第二个泛音压低音量，只做染色
        gain.gain.setValueAtTime(i === 0 ? 1 : 0.42, now);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now + i * 0.03);
        osc.stop(now + spec.dur + 0.05);
      });
      return true;
    } catch (e) {
      console.warn("chime 播放失败：", e);
      return false;
    }
  }

  // ============================ 触觉 ============================

  /**
   * 振动。静默时直接吞掉；不支持 vibrate 的设备（iOS Safari）静默失败。
   * @param {number|Array<number>} pat 时长或 [振,停,振…] 模式
   * @returns {boolean} 是否成功下发
   */
  function vibrate(pat) {
    if (isSilent()) return false;
    if (!g.navigator || typeof g.navigator.vibrate !== "function") return false;
    try {
      return Boolean(g.navigator.vibrate(pat));
    } catch (e) {
      return false;
    }
  }

  // ============================ 粒子层 ============================

  /**
   * 惰性拿到 #fx-layer canvas 并按 dpr 校准尺寸。
   * 页面没有这个节点时返回 null（例如某些精简页面），调用方静默降级。
   * @returns {HTMLCanvasElement|null}
   */
  function ensureCanvas() {
    if (canvas && canvas.isConnected !== false) return canvas;
    canvas = document.getElementById("fx-layer");
    if (!canvas || typeof canvas.getContext !== "function") {
      canvas = null;
      return null;
    }
    canvasCtx = canvas.getContext("2d");
    resizeCanvas();
    return canvas;
  }

  /**
   * 按 devicePixelRatio 重设 canvas 位图尺寸。
   * dpr 上限压到 2：高分屏上 3x 位图对星屑毫无观感增益，只白烧填充率。
   * @returns {void}
   */
  function resizeCanvas() {
    if (!canvas || !canvasCtx) return;
    dpr = Math.min(g.devicePixelRatio || 1, 2);
    var w = g.innerWidth || document.documentElement.clientWidth || 360;
    var h = g.innerHeight || document.documentElement.clientHeight || 640;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * 从 CSS 变量读粒子色，保证主题切换后星屑颜色跟着变。
   * @param {string} name CSS 变量名
   * @param {string} fallback 读不到时的兜底色
   * @returns {string}
   */
  function cssColor(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /**
   * 生成一批粒子并推进池子（池满即丢弃，不扩容）。
   * @param {number} x 起点 x（CSS 像素，视口坐标）
   * @param {number} y 起点 y
   * @param {Object} o 配置
   * @returns {number} 实际生成数量
   */
  function spawn(x, y, o) {
    var count = Math.max(1, Math.floor(o.count || BURST_COUNT));
    var speed = o.speed || 190;
    var spread = o.spread === undefined ? Math.PI * 2 : o.spread;
    var baseAngle = o.angle === undefined ? 0 : o.angle;
    var life = o.life || 900;
    var color = o.color || cssColor("--fx-spark", "#f2c14e");
    var trail = o.trail || cssColor("--fx-trail", "rgba(242,193,78,0.5)");
    var made = 0;

    for (var i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTICLES) break;
      var a = baseAngle + (spread === Math.PI * 2 ? Math.random() * spread : (Math.random() - 0.5) * spread);
      // 速度按平方根分布，视觉上外圈不会太空
      var v = speed * (0.35 + Math.sqrt(Math.random()) * 0.75);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (o.lift || 0),
        r: 1.1 + Math.random() * 1.9,
        life: life * (0.6 + Math.random() * 0.6),
        age: 0,
        color: Math.random() < 0.7 ? color : trail,
        gravity: o.gravity === undefined ? GRAVITY : o.gravity,
      });
      made++;
    }
    if (made > 0) startLoop();
    return made;
  }

  /**
   * 启动渲染循环（幂等）。池空时 step() 会自行停下，无需外部干预。
   * @returns {void}
   */
  function startLoop() {
    if (rafId) return;
    lastFrame = 0;
    rafId = g.requestAnimationFrame(step);
  }

  /**
   * 单帧推进：更新 → 绘制 → 池空则停。
   * @param {number} ts rAF 时间戳
   * @returns {void}
   */
  function step(ts) {
    rafId = 0;
    if (!canvasCtx) return;
    // dt 夹在 50ms 内：标签页切回来时时间戳会跳一大截，不夹就会「瞬移」
    var dt = lastFrame ? Math.min((ts - lastFrame) / 1000, 0.05) : 0.016;
    lastFrame = ts;

    var w = canvas.width / dpr;
    var h = canvas.height / dpr;
    canvasCtx.clearRect(0, 0, w, h);

    var alive = [];
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.age += dt * 1000;
      if (p.age >= p.life) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > h + 40 || p.x < -40 || p.x > w + 40) continue;

      var t = 1 - p.age / p.life;
      canvasCtx.globalAlpha = t * t;
      canvasCtx.fillStyle = p.color;
      canvasCtx.beginPath();
      canvasCtx.arc(p.x, p.y, p.r * (0.4 + t * 0.6), 0, Math.PI * 2);
      canvasCtx.fill();
      alive.push(p);
    }
    canvasCtx.globalAlpha = 1;
    particles = alive;

    if (particles.length > 0) {
      rafId = g.requestAnimationFrame(step);
    } else {
      // 池空：擦干净并停循环，绝不空转
      canvasCtx.clearRect(0, 0, w, h);
    }
  }

  /**
   * 定点星屑：以某个屏幕坐标为中心炸开一小簇。
   * @param {number} x 视口 x
   * @param {number} y 视口 y
   * @param {Object} [opts] {count, speed, life, color, gravity}
   * @returns {number} 实际生成的粒子数（0 = 被降级拦下）
   */
  function burst(x, y, opts) {
    if (!canAnimate()) return 0;
    if (!ensureCanvas()) return 0;
    return spawn(Number(x) || 0, Number(y) || 0, opts || {});
  }

  /**
   * 全屏星爆：从屏幕下缘多点向上喷发，用于里程碑 / 升段这类大事件。
   * @param {Object} [opts] {count, color}
   * @returns {number} 实际生成的粒子数
   */
  function fullBurst(opts) {
    if (!canAnimate()) return 0;
    if (!ensureCanvas()) return 0;
    var o = opts || {};
    var w = g.innerWidth || 360;
    var h = g.innerHeight || 640;
    var total = Math.min(o.count || FULL_COUNT, MAX_PARTICLES);
    var origins = 3;
    var made = 0;
    for (var i = 0; i < origins; i++) {
      made += spawn(w * (i + 1) / (origins + 1), h * 0.92, {
        count: Math.ceil(total / origins),
        speed: 420,
        spread: Math.PI * 0.75,
        angle: -Math.PI / 2,
        life: 1500,
        lift: 120,
        gravity: 300,
        color: o.color,
      });
    }
    return made;
  }

  /**
   * 立刻掐断一切感官输出（开启静默时调用）。
   * @returns {void}
   */
  function stopAll() {
    particles = [];
    if (rafId) {
      g.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (canvasCtx && canvas) {
      canvasCtx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
    if (audioCtx && audioCtx.state === "running" && typeof audioCtx.suspend === "function") {
      try {
        audioCtx.suspend();
      } catch (e) {
        /* 挂起失败无所谓，声音本来就是一次性的 */
      }
    }
  }

  // ============================ 生命周期 ============================

  g.addEventListener("resize", function () {
    if (canvas) resizeCanvas();
  });

  // 页面切到后台：停粒子省电（回到前台时下一次 burst 会自动重启）
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && rafId) {
      g.cancelAnimationFrame(rafId);
      rafId = 0;
      particles = [];
      if (canvasCtx && canvas) {
        canvasCtx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      }
    }
  });

  // 首次真实手势自动解锁音频（capture + once，绝不重复绑）
  ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
    document.addEventListener(
      evt,
      function () {
        if (!isSilent()) unlock();
      },
      { once: true, capture: true, passive: true }
    );
  });

  g.Sensory = {
    isSilent: isSilent,
    setSilent: setSilent,
    unlock: unlock,
    ctx: ctx,
    playChime: playChime,
    vibrate: vibrate,
    burst: burst,
    fullBurst: fullBurst,
    canAnimate: canAnimate,
    stopAll: stopAll,
  };
})(window);
