/**
 * js/core/util.js —— 核心工具层（L1，无任何业务依赖）
 *
 * 职责：时间 / 日期、字符串转义、随机数、节流防抖、WebAudio 合成音效。
 *
 * 约定（全员必读，见设计文档 §8.3）：
 *   · 所有存储时间 = epoch 毫秒；日期键 dayKey = **本地时区** "YYYY-MM-DD"。
 *   · plan.day 沿用 Python 口径（周一=0，周日=6），JS 比较须 (plan.day + 1) % 7 === date.getDay()。
 *   · 任何进 innerHTML 的用户数据必须先过 RF.util.esc()。
 *   · 本文件不得引用 RF.bus / RF.store 等上层模块，依赖方向只能自上而下。
 *
 * 归属：地基（T01，已实现）。接口签名见设计文档 §5.1，不得擅自增删导出名。
 */
(function (RF) {
  "use strict";

  var DAY_MS = 86400000;
  var EMPTY = "";
  var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  /** @return {string} 两位补零 */
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /** @return {number} 当前 epoch 毫秒 */
  function nowMs() {
    return Date.now();
  }

  /**
   * 把数值限制在 [min, max] 内；非数字返回 min。
   * @param {number} v
   * @param {number} min
   * @param {number} max
   * @return {number}
   */
  function clamp(v, min, max) {
    v = Number(v);
    if (!isFinite(v)) return min;
    return v < min ? min : v > max ? max : v;
  }

  /**
   * 生成唯一 id：优先 crypto.randomUUID，回落时间戳 + 随机串。
   * @return {string}
   */
  function genId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
    } catch (e) {
      /* 部分浏览器在非安全上下文禁用 randomUUID，回落即可 */
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /**
   * HTML 转义。**所有**进 innerHTML 的用户数据必须先过这里（设计文档 §8.5 红线 3）。
   * @param {*} s
   * @return {string}
   */
  function esc(s) {
    if (s === null || s === undefined) return EMPTY;
    return String(s).replace(/[&<>"']/g, function (c) {
      return ESC_MAP[c];
    });
  }

  /**
   * 闭区间随机整数。
   * @param {number} a
   * @param {number} b
   * @return {number}
   */
  function randInt(a, b) {
    var lo = Math.ceil(Math.min(a, b));
    var hi = Math.floor(Math.max(a, b));
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /**
   * 随机挑一个元素。
   * @param {Array} arr
   * @return {*}
   */
  function pick(arr) {
    if (!arr || !arr.length) return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * FNV-1a 字符串哈希（用于稳定选取变体）。
   * @param {string} s
   * @return {number} 32 位无符号整数
   */
  function hashStr(s) {
    var h = 2166136261;
    var str = String(s === null || s === undefined ? EMPTY : s);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * 按种子稳定挑一个元素：同一种子刷新页面不跳变（精灵台词 / 推送变体用）。
   * @param {Array} arr
   * @param {string} seed
   * @return {*}
   */
  function pickSeeded(arr, seed) {
    if (!arr || !arr.length) return undefined;
    return arr[hashStr(seed) % arr.length];
  }

  /**
   * 本地时区日期键。
   * @param {number|Date=} input 省略表示现在
   * @return {string} "YYYY-MM-DD"
   */
  function dayKey(input) {
    var d;
    if (input === null || input === undefined) d = new Date();
    else if (input instanceof Date) d = input;
    else d = new Date(input);
    if (!d || isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /**
   * 日期键 → 当天 00:00:00.000 的 epoch 毫秒。
   * @param {string=} key 省略表示今天
   * @return {number}
   */
  function startOfDayMs(key) {
    var k = key || dayKey();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k));
    if (!m) return new Date(dayKey()).setHours(0, 0, 0, 0);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
  }

  /**
   * 日期键加减天数。
   * @param {string} key
   * @param {number} n 可为负
   * @return {string} 新日期键
   */
  function addDays(key, n) {
    return dayKey(startOfDayMs(key) + Number(n || 0) * DAY_MS);
  }

  /**
   * 两个日期键相差天数（bKey − aKey，可为负）。用 round 抵消夏令时漂移。
   * @param {string} aKey
   * @param {string} bKey
   * @return {number}
   */
  function diffDays(aKey, bKey) {
    return Math.round((startOfDayMs(bKey) - startOfDayMs(aKey)) / DAY_MS);
  }

  /**
   * "07:30" → 450（分钟）。
   * @param {string} hhmm
   * @return {number}
   */
  function hhmmToMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return 0;
    return clamp(parseInt(m[1], 10), 0, 23) * 60 + clamp(parseInt(m[2], 10), 0, 59);
  }

  /**
   * 450 → "07:30"；超过 24 小时自动取模。
   * @param {number} min
   * @return {string}
   */
  function minToHHMM(min) {
    var t = Math.floor(Number(min) || 0) % 1440;
    if (t < 0) t += 1440;
    return pad2(Math.floor(t / 60)) + ":" + pad2(t % 60);
  }

  /** @return {number} 当前小时 0-23（本地时区） */
  function hourOfDay() {
    return new Date().getHours();
  }

  /**
   * 毫秒 → "HH:MM:SS"（小时上限 99）。
   * @param {number} ms
   * @return {string}
   */
  function fmtDuration(ms) {
    var total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var h = Math.min(99, Math.floor(total / 3600));
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s);
  }

  /**
   * 节流：先立即执行一次，之后 ms 内最多再补一次尾部调用。
   * @param {Function} fn
   * @param {number} ms
   * @return {Function}
   */
  function throttle(fn, ms) {
    var wait = Number(ms) || 200;
    var last = 0;
    var timer = null;
    var lastArgs = null;
    var lastCtx = null;
    return function () {
      var now = nowMs();
      lastArgs = arguments;
      lastCtx = this;
      if (now - last >= wait) {
        last = now;
        fn.apply(lastCtx, lastArgs);
        return;
      }
      if (!timer) {
        timer = setTimeout(function () {
          timer = null;
          last = nowMs();
          fn.apply(lastCtx, lastArgs);
        }, wait - (now - last));
      }
    };
  }

  /**
   * 防抖：停止调用 ms 毫秒后才执行。
   * @param {Function} fn
   * @param {number} ms
   * @return {Function}
   */
  function debounce(fn, ms) {
    var wait = Number(ms) || 300;
    var timer = null;
    return function () {
      var ctx = this;
      var args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    };
  }

  /* ---------------- WebAudio 合成音效（无音频文件，零素材） ---------------- */

  /** 预置音序：f=频率(Hz) d=时长(s) delay=相对起始延迟(s) type=波形 gain=音量 */
  var TONES = {
    ding: [{ f: 880, d: 0.12 }, { f: 1320, d: 0.18, delay: 0.08 }],
    bloom: [{ f: 660, d: 0.14 }, { f: 880, d: 0.14, delay: 0.1 }, { f: 1100, d: 0.22, delay: 0.2 }],
    cheer: [
      { f: 523, d: 0.12 }, { f: 659, d: 0.12, delay: 0.1 },
      { f: 784, d: 0.12, delay: 0.2 }, { f: 1047, d: 0.26, delay: 0.3 }
    ],
    sad: [{ f: 440, d: 0.22, type: "triangle" }, { f: 330, d: 0.32, delay: 0.18, type: "triangle" }],
    warn: [{ f: 330, d: 0.14, type: "square", gain: 0.12 }, { f: 330, d: 0.14, delay: 0.2, type: "square", gain: 0.12 }]
  };

  var audioCtx = null;
  var muted = false;

  /** 懒创建 AudioContext；失败一律静默（不因此打断任何流程）。 @return {AudioContext|null} */
  function ensureAudio() {
    if (muted) return null;
    if (typeof window === "undefined") return null;
    if (audioCtx) {
      if (audioCtx.state === "suspended" && audioCtx.resume) {
        try { audioCtx.resume(); } catch (e) { /* 忽略 */ }
      }
      return audioCtx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  /** @param {AudioContext} ctx @param {number} at @param {number} freq @param {number} dur @param {string} type @param {number} gain */
  function playTone(ctx, at, freq, dur, type, gain) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  /**
   * 播放合成音效。任何异常都被吞掉——音效永远不该阻塞业务逻辑。
   * @param {"ding"|"bloom"|"cheer"|"sad"|"warn"} name
   * @return {void}
   */
  function sound(name) {
    try {
      var ctx = ensureAudio();
      if (!ctx) return;
      var seq = TONES[name] || TONES.ding;
      var t0 = ctx.currentTime;
      for (var i = 0; i < seq.length; i++) {
        playTone(
          ctx,
          t0 + (seq[i].delay || 0),
          seq[i].f,
          seq[i].d,
          seq[i].type || "sine",
          seq[i].gain === undefined ? 0.18 : seq[i].gain
        );
      }
    } catch (e) {
      /* 音效失败不影响主流程 */
    }
  }

  /** @param {boolean} v */
  function setMuted(v) {
    muted = !!v;
  }

  /** @return {boolean} */
  function isMuted() {
    return muted;
  }

  RF.util = {
    DAY_MS: DAY_MS,
    genId: genId,
    esc: esc,
    clamp: clamp,
    randInt: randInt,
    pick: pick,
    pickSeeded: pickSeeded,
    hashStr: hashStr,
    dayKey: dayKey,
    startOfDayMs: startOfDayMs,
    addDays: addDays,
    diffDays: diffDays,
    hhmmToMin: hhmmToMin,
    minToHHMM: minToHHMM,
    hourOfDay: hourOfDay,
    throttle: throttle,
    debounce: debounce,
    fmtDuration: fmtDuration,
    nowMs: nowMs,
    sound: sound,
    setMuted: setMuted,
    isMuted: isMuted
  };
})(window.RF = window.RF || {});
