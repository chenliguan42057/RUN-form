/**
 * whitenoise.js — D2 星河白噪音（三场景，纯 WebAudio 合成，零音频文件）
 *
 * 场景：夜雨 / 潮汐 / 星尘
 *
 * 约定（白屏防御）：
 *  - 全文件 IIFE，只暴露 window.WhiteNoise
 *  - AudioContext 一律走 Sensory.ctx() 单例，绝不自己 new
 *  - 静默模式下拒绝播放；播放前若 suspended 先 resume()
 *  - 页面隐藏自动暂停，回来不自动恢复（避免后台偷偷响）
 */
(function (g) {
  "use strict";

  var SCENES = [
    {
      key: "rain",
      name: "夜雨",
      icon: "🌧",
      desc: "窗外一直在下，房间里只有你和台灯。",
      // 高频多一点，像雨打玻璃
      filter: { type: "bandpass", freq: 1200, q: 0.32 },
      lfo: { rate: 0.13, depth: 0.16 },
      gain: 0.075
    },
    {
      key: "tide",
      name: "潮汐",
      icon: "🌊",
      desc: "一涨一落，呼吸跟着它走就不慌了。",
      filter: { type: "lowpass", freq: 520, q: 0.7 },
      lfo: { rate: 0.075, depth: 0.42 },
      gain: 0.09
    },
    {
      key: "dust",
      name: "星尘",
      icon: "✦",
      desc: "极低的底噪，像宇宙一直在轻轻嗡着。",
      filter: { type: "lowpass", freq: 260, q: 0.4 },
      lfo: { rate: 0.045, depth: 0.2 },
      gain: 0.1
    }
  ];

  var nodes = null; // { src, filter, lfo, lfoGain, gain }
  var currentKey = "";
  var volume = 0.7; // 0~1 用户音量
  var noiseBuf = null;

  function sceneOf(key) {
    for (var i = 0; i < SCENES.length; i++) {
      if (SCENES[i].key === key) return SCENES[i];
    }
    return null;
  }

  function audio() {
    if (!g.Sensory || typeof g.Sensory.ctx !== "function") return null;
    return g.Sensory.ctx();
  }

  /** 生成 4 秒棕噪声循环缓冲（比纯白噪柔，长时间听不刺耳） */
  function buildNoise(ctx) {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 4);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    // 首尾交叉淡化，消除 loop 接缝的「哒」
    var fade = Math.floor(ctx.sampleRate * 0.12);
    for (var j = 0; j < fade; j++) {
      var k = j / fade;
      d[j] *= k;
      d[len - 1 - j] *= k;
    }
    noiseBuf = buf;
    return buf;
  }

  function teardown(fadeMs) {
    if (!nodes) return;
    var n = nodes;
    nodes = null;
    currentKey = "";
    var ctx = audio();
    var ms = typeof fadeMs === "number" ? fadeMs : 420;
    try {
      if (ctx && n.gain) {
        var t = ctx.currentTime;
        n.gain.gain.cancelScheduledValues(t);
        n.gain.gain.setValueAtTime(n.gain.gain.value, t);
        n.gain.gain.linearRampToValueAtTime(0.0001, t + ms / 1000);
      }
    } catch (e) {
      /* 忽略 */
    }
    setTimeout(function () {
      try {
        if (n.src) n.src.stop();
      } catch (e2) {
        /* 忽略 */
      }
      try {
        if (n.lfo) n.lfo.stop();
      } catch (e3) {
        /* 忽略 */
      }
      try {
        if (n.src) n.src.disconnect();
        if (n.filter) n.filter.disconnect();
        if (n.gain) n.gain.disconnect();
        if (n.lfoGain) n.lfoGain.disconnect();
      } catch (e4) {
        /* 忽略 */
      }
    }, ms + 60);
  }

  /**
   * 播放指定场景。
   * @returns {boolean} 是否真的开始播
   */
  function play(key) {
    var sc = sceneOf(key);
    if (!sc) return false;

    // 静默模式：一声不吭
    if (g.Sensory && g.Sensory.isSilent && g.Sensory.isSilent()) return false;

    var ctx = audio();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    } catch (e) {
      /* 忽略 */
    }

    if (currentKey === key && nodes) return true;
    teardown(180);

    try {
      var buf = buildNoise(ctx);

      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      var filter = ctx.createBiquadFilter();
      filter.type = sc.filter.type;
      filter.frequency.value = sc.filter.freq;
      filter.Q.value = sc.filter.q;

      var gain = ctx.createGain();
      var target = sc.gain * volume;
      gain.gain.value = 0.0001;

      // LFO 让音量缓慢起伏，模拟雨势 / 潮汐
      var lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = sc.lfo.rate;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = target * sc.lfo.depth;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      src.start();
      lfo.start();

      var t = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(target, t + 1.6);

      nodes = { src: src, filter: filter, gain: gain, lfo: lfo, lfoGain: lfoGain, base: target };
      currentKey = key;
      return true;
    } catch (err) {
      nodes = null;
      currentKey = "";
      return false;
    }
  }

  function stop() {
    teardown(420);
  }

  /** 点同一个 = 关，点别的 = 换。返回当前 key（空串表示关掉了） */
  function toggle(key) {
    if (currentKey === key) {
      stop();
      return "";
    }
    return play(key) ? key : "";
  }

  function isPlaying() {
    return !!nodes;
  }

  function current() {
    return currentKey;
  }

  /** @param {number} v 0~1 */
  function setVolume(v) {
    var nv = Number(v);
    if (!isFinite(nv)) return volume;
    volume = Math.max(0, Math.min(1, nv));
    if (nodes) {
      var sc = sceneOf(currentKey);
      var ctx = audio();
      if (sc && ctx) {
        try {
          var target = sc.gain * volume;
          var t = ctx.currentTime;
          nodes.gain.gain.cancelScheduledValues(t);
          nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, t);
          nodes.gain.gain.linearRampToValueAtTime(Math.max(0.0001, target), t + 0.25);
          nodes.lfoGain.gain.value = target * sc.lfo.depth;
          nodes.base = target;
        } catch (e) {
          /* 忽略 */
        }
      }
    }
    return volume;
  }

  function getVolume() {
    return volume;
  }

  // 切后台就停：后台还在响是最招人烦的
  try {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && nodes) stop();
    });
  } catch (e) {
    /* 忽略 */
  }

  g.WhiteNoise = {
    SCENES: SCENES,
    play: play,
    stop: stop,
    toggle: toggle,
    isPlaying: isPlaying,
    current: current,
    setVolume: setVolume,
    getVolume: getVolume
  };
})(window);
