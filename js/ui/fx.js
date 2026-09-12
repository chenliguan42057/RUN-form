/**
 * js/ui/fx.js —— 粒子 / 花瓣雨 / 数字跳动 / 音效 / toast / 全屏庆祝
 *
 * 归属：B 组（T03）。签名冻结（设计文档 §5.12）。
 *
 * 硬要求（主理人明确提过，见 §8.6 第 4 条）：
 *   打卡后 0.5 秒内必须出视听反馈 —— sound() 与 particles() 同步触发，不等网络。
 *
 * 性能：粒子复用 DOM，动画只动 transform/opacity；受 runform_fx.muted 与
 *   profile.settings.reduceMotion 控制。整站只有一个 rAF 主循环（scene.js 持有），
 *   本文件通过 RF.scene.onFrame 注册唯一回调驱动所有粒子与数字 tween。
 */
(function (RF) {
  "use strict";

  var SIX = ["#87CEEB", "#98FB98", "#FFE66D", "#FFB6C1", "#E6E6FA", "#FFA07A"];

  var particles = [];      // 活跃粒子
  var tweens = [];         // 活跃数字 tween
  var lastTs = 0;
  var loopRegistered = false;

  function layer() {
    try { return document.getElementById("particle-layer"); } catch (e) { return null; }
  }

  /** 注册唯一帧回调到 scene 主循环（scene.js 先加载，onFrame 已存在） */
  function ensureLoop() {
    if (loopRegistered) return;
    if (RF.scene && typeof RF.scene.onFrame === "function") {
      RF.scene.onFrame(fxTick);
      loopRegistered = true;
    }
  }

  function fxTick(ts) {
    var dt = lastTs ? (ts - lastTs) : 16;
    if (dt > 80) dt = 80; // 切后台回来时夹一下，避免瞬移
    lastTs = ts;
    stepParticles(dt);
    stepTweens(ts);
  }

  /* ---------------- 粒子 ---------------- */
  function stepParticles(dt) {
    var l = layer();
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
        particles.splice(i, 1);
        continue;
      }
      p.vy += 0.0006 * dt; // 轻微重力
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var op = 1 - p.age / p.life;
      if (p.el) {
        p.el.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px) scale(" + (0.6 + op * 0.6).toFixed(2) + ")";
        p.el.style.opacity = (op * 0.95).toFixed(2);
      }
    }
  }

  function spawnParticle(cx, cy, color) {
    var l = layer();
    if (!l) return;
    var el = document.createElement("span");
    el.className = "g-particle";
    el.style.left = cx + "px";
    el.style.top = cy + "px";
    el.style.background = color;
    l.appendChild(el);
    var ang = (Math.random() * Math.PI * 2);
    var spd = 0.04 + Math.random() * 0.06;
    particles.push({
      el: el, x: 0, y: 0,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 0.05,
      age: 0, life: 700 + Math.random() * 500
    });
  }

  /**
   * 在元素位置爆一簇粒子。
   * @param {HTMLElement} el 锚点元素（取其中心）
   * @param {{count?:number, colors?:string[]}=} opts
   */
  function particlesAt(el, opts) {
    if (!el) return;
    ensureLoop();
    if (RF.scene && RF.scene.isReduced && RF.scene.isReduced()) return; // 降级：不放粒子
    var o = opts || {};
    var count = o.count || 12;
    var colors = o.colors && o.colors.length ? o.colors : SIX;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    for (var i = 0; i < count; i++) {
      spawnParticle(cx, cy, colors[i % colors.length]);
    }
  }

  /**
   * 花瓣雨。
   * @param {number=} durationMs 默认 3000
   */
  function petalRain(durationMs) {
    ensureLoop();
    if (RF.scene && RF.scene.isReduced && RF.scene.isReduced()) return;
    var l = layer();
    if (!l) return;
    var dur = durationMs || 3000;
    var end = Date.now() + dur;
    var iv = setInterval(function () {
      if (Date.now() > end) { clearInterval(iv); return; }
      if (countInLayer(l, "g-petal-rain") >= 20) return; // 常驻上限 20
      var el = document.createElement("span");
      el.className = "g-petal-rain";
      el.style.left = RF.util.randInt(0, 96) + "%";
      el.style.setProperty("--pr-dur", RF.util.randInt(2600, 4200) + "ms");
      el.style.setProperty("--pr-x", RF.util.randInt(-60, 60) + "px");
      el.textContent = RF.util.pick(["🌸", "🌼", "🌺", "🍃"]) || "🌸";
      l.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4600);
    }, 180);
  }

  function countInLayer(l, cls) {
    if (!l) return 0;
    return l.querySelectorAll("." + cls).length;
  }

  /* ---------------- 数字跳动 ---------------- */
  function stepTweens(ts) {
    for (var i = tweens.length - 1; i >= 0; i--) {
      var t = tweens[i];
      var p = ts - t.start;
      var k = t.dur <= 0 ? 1 : Math.min(1, p / t.dur);
      var eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
      var val = Math.round(t.from + (t.to - t.from) * eased);
      if (t.el) t.el.textContent = String(val);
      if (k >= 1) {
        tweens.splice(i, 1);
        if (t.onDone) { try { t.onDone(); } catch (e) { /* ignore */ } }
      }
    }
  }

  /**
   * 数字滚动（积分 / 连续天数）。
   * @param {HTMLElement} el
   * @param {number} from
   * @param {number} to
   */
  function numberPop(el, from, to) {
    if (!el) return;
    ensureLoop();
    if (RF.scene && RF.scene.isReduced && RF.scene.isReduced()) { el.textContent = String(to); return; }
    tweens.push({ el: el, from: Number(from) || 0, to: Number(to) || 0, start: 0, dur: 600,
      onStep: null, onDone: null });
    // start 在第一次 tick 时对齐（用 ts）
    // 修正：把 start 设为「下一个 ts」（用一个标记）
    tweens[tweens.length - 1].start = -1;
  }

  // 让 tween 在首个 tick 对齐起始时间
  var _origStep = stepTweens;
  stepTweens = function (ts) {
    for (var i = 0; i < tweens.length; i++) {
      if (tweens[i].start === -1) tweens[i].start = ts;
    }
    _origStep(ts);
  };

  /* ---------------- 音效 ---------------- */
  function soundAllowed() {
    if (RF.util && RF.util.isMuted && RF.util.isMuted()) return false;
    try {
      var fx = RF.storage.getJSON(RF.storage.KEYS.FX, {});
      if (fx && fx.muted) return false;
    } catch (e) { /* ignore */ }
    try {
      if (RF.store && RF.store.loadProfile) {
        var p = RF.store.loadProfile();
        if (p && p.settings && p.settings.sound === false) return false;
      }
    } catch (e) { /* ignore */ }
    return true;
  }

  /**
   * 播放合成音效（底层是 RF.util.sound 的 WebAudio 合成，无音频文件）。
   * @param {"ding"|"bloom"|"cheer"|"sad"|"warn"} name
   */
  function sound(name) {
    if (!soundAllowed()) return;
    if (RF.util && RF.util.sound) RF.util.sound(name);
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  /**
   * 轻提示。
   * @param {string} msg
   * @param {"info"|"success"|"warning"|"error"=} type
   */
  function toast(msg, type) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = RF.util.esc(msg); // 文本用 esc 兜底，绝不直接 innerHTML
    el.className = "g-toast" + (type ? " g-toast--" + type : "");
    el.hidden = false;
    // 强制重排以触发过渡
    void el.offsetWidth;
    el.classList.add("is-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("is-show");
      setTimeout(function () { el.hidden = true; }, 320);
    }, 2400);
  }

  /**
   * 通过内容层解析提示文案（主理人可在 manage.html 改 ui.toasts.*）。
   * @param {string} key ui.toasts.<key>
   * @param {Object=} vars 占位符替换，如 { name: "x" }
   * @param {"info"|"success"|"warning"|"error"=} type
   */
  function toastKey(key, vars, type) {
    var tpl = (RF.content && RF.content.get) ? RF.content.get("ui.toasts." + key, key) : key;
    if (vars && typeof vars === "object") {
      tpl = String(tpl).replace(/\{\w+\}/g, function (m) {
        var k = m.slice(1, -1);
        return (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : m;
      });
    }
    toast(tpl, type);
  }

  /* ---------------- 全屏庆祝 ---------------- */
  /**
   * 全屏庆祝。
   * @param {"full"|"rank"|"coupon"|"achievement"} kind
   */
  function celebrate(kind) {
    if (kind === "full") {
      petalRain(2600);
      sound("cheer");
    } else if (kind === "rank") {
      petalRain(1600);
      sound("cheer");
    } else if (kind === "coupon") {
      petalRain(1400);
      sound("bloom");
    } else if (kind === "achievement") {
      petalRain(1800);
      sound("cheer");
    }
  }

  /* ---------------- 订阅玩法事件（模块加载即挂，bus 已先加载） ---------------- */
  if (RF.bus) {
    var E = RF.bus.EVENTS;
    // 事件名以 bus.js 的「冒号」冻结名为准；保留 || 兜底串作防御（避免键名再被写错成下划线时静默失效）
    RF.bus.on(E["garden:bloom"] || "garden:bloom", function (p) { sound("bloom"); petalRain((p && p.duration) || 1800); });
    RF.bus.on(E["pet:stageUp"] || "pet:stageUp", function (p) { if (p && p.silent) return; sound("bloom"); toastKey("petStageUp", null, "success"); });
    RF.bus.on(E["coupon:granted"] || "coupon:granted", function (p) {
      sound("cheer"); toastKey("couponGranted", null, "success"); if (p && p.el) particlesAt(p.el, { count: 10 });
    });
    RF.bus.on(E["coupon:theft"] || "coupon:theft", function () { sound("warn"); toastKey("couponTheft", null, "error"); });
    RF.bus.on(E["rank:up"] || "rank:up", function (p) { celebrate("rank"); if (p && p.name) toastKey("rankUp", { name: p.name }, "success"); });
    RF.bus.on(E["achievement:unlocked"] || "achievement:unlocked", function (p) {
      celebrate("achievement");
      if (p && p.name) toastKey("achievement", { name: p.name }, "success");
    });
    RF.bus.on(E["day:perfect"] || "day:perfect", function () { sound("cheer"); petalRain(2200); toastKey("dayPerfect", null, "success"); });
  }

  RF.fx = {
    particles: particlesAt,
    petalRain: petalRain,
    numberPop: numberPop,
    sound: sound,
    toast: toast,
    toastKey: toastKey,
    celebrate: celebrate
  };
})(window.RF = window.RF || {});
