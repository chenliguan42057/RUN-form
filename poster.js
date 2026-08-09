/**
 * poster.js — B4 星河海报（离屏 Canvas 2400×3600 PNG）
 *
 * 约定（白屏防御）：
 *  - 全文件 IIFE，只暴露 window.Poster 一个 PascalCase 命名空间
 *  - 本文件不声明顶层 const $（$ 只属于 app.js / app2.js / app3.js）
 *  - 画完立刻 canvas.width = 0 释放显存，绝不缓存大画布
 *  - 不含二维码；右下角固定文字「RUN-form 星河契约」
 *  - 颜色一律从 CSS 变量读取，跟随四季主题
 */
(function (g) {
  "use strict";

  var W = 2400;
  var H = 3600;

  // 海报安全边距（左右对称）
  var PAD = 180;

  /* ============================================================
   * 工具
   * ========================================================== */

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function two(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function fmtDate(d) {
    return d.getFullYear() + "." + two(d.getMonth() + 1) + "." + two(d.getDate());
  }

  /** 圆角矩形路径（不依赖 roundRect，兼容旧内核） */
  function roundPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /** 简易折行（按字符宽度，中文友好） */
  function wrapText(ctx, text, maxW) {
    var lines = [];
    var cur = "";
    var arr = String(text || "").split("");
    for (var i = 0; i < arr.length; i++) {
      var t = cur + arr[i];
      if (ctx.measureText(t).width > maxW && cur) {
        lines.push(cur);
        cur = arr[i];
      } else {
        cur = t;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* ============================================================
   * 数据采集：全部走 store.js 现成读函数，不新增存储
   * ========================================================== */

  function collect() {
    var checkins = [];
    var plans = [];
    try {
      checkins = (g.loadCheckins && g.loadCheckins()) || [];
    } catch (e) {
      checkins = [];
    }
    try {
      plans = (g.loadPlans && g.loadPlans()) || [];
    } catch (e2) {
      plans = [];
    }

    var streak = 0;
    try {
      var gs = (g.globalStreak && g.globalStreak()) || { current: 0, best: 0 };
      streak = typeof gs.current === "number" ? gs.current : 0;
    } catch (e3) {
      streak = 0;
    }

    var actMap = {};
    try {
      actMap = (g.buildActivityMap && g.buildActivityMap()) || {};
    } catch (e4) {
      actMap = {};
    }

    var rank = null;
    try {
      rank = g.Rank && g.Rank.getRank ? g.Rank.getRank() : null;
    } catch (e5) {
      rank = null;
    }

    var contract = null;
    try {
      contract = g.Onboarding && g.Onboarding.contract ? g.Onboarding.contract() : null;
    } catch (e6) {
      contract = null;
    }

    var activeCount = 0;
    for (var i = 0; i < plans.length; i++) {
      if (plans[i] && plans[i].active !== false) activeCount++;
    }

    return {
      checkins: checkins,
      plans: plans,
      activePlans: activeCount,
      total: checkins.length,
      streak: streak,
      actMap: actMap,
      rank: rank,
      contract: contract
    };
  }

  /** 近 N 周星点矩阵（列 = 周，行 = 周一~周日） */
  function heatMatrix(actMap, weeks) {
    var today = g.startOfDay ? g.startOfDay(new Date()) : new Date();
    var wd = g.pyWeekday ? g.pyWeekday(today) : (today.getDay() + 6) % 7;
    var monday = new Date(today.getTime() - wd * 86400000);
    var start = new Date(monday.getTime() - (weeks - 1) * 7 * 86400000);

    var cols = [];
    for (var w = 0; w < weeks; w++) {
      var col = [];
      for (var d = 0; d < 7; d++) {
        var day = new Date(start.getTime() + (w * 7 + d) * 86400000);
        var key = g.dateKey ? g.dateKey(day) : "";
        // buildActivityMap() 返回的是 Map，值结构为 {count, manual, auto, plans}
        // 用 .get(key) 取值；兼容旧 store（普通对象）时退回下标
        var entry =
          actMap && typeof actMap.get === "function"
            ? actMap.get(key)
            : actMap
            ? actMap[key]
            : null;
        var n = entry
          ? entry.count != null
            ? entry.count
            : Array.isArray(entry)
            ? entry.length
            : 0
          : 0;
        if (typeof n !== "number") n = 0;
        col.push({ n: n, future: day.getTime() > today.getTime() });
      }
      cols.push(col);
    }
    return cols;
  }

  /* ============================================================
   * 绘制
   * ========================================================== */

  function paintBackground(ctx) {
    var deep = cssVar("--bg-deep", "#060a16");
    var mid = cssVar("--bg-mid", "#0d1730");
    var glow = cssVar("--rank-glow", "#f5c451");

    var lg = ctx.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0, deep);
    lg.addColorStop(0.55, mid);
    lg.addColorStop(1, deep);
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);

    // 顶部一团柔光，模拟星云
    var rg = ctx.createRadialGradient(W * 0.72, H * 0.14, 40, W * 0.72, H * 0.14, W * 0.7);
    rg.addColorStop(0, "rgba(255,255,255,0.10)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // 星尘：伪随机但稳定（不依赖 Math.random 的抖动感也无所谓，海报是静态图）
    var seed = 20260808;
    function rnd() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    for (var i = 0; i < 420; i++) {
      var x = rnd() * W;
      var y = rnd() * H;
      var r = rnd() * 3.4 + 0.6;
      var a = rnd() * 0.55 + 0.12;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
      ctx.fill();
    }

    // 四角描边框
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 3;
    roundPath(ctx, 70, 70, W - 140, H - 140, 48);
    ctx.stroke();

    // 顶部一道段位色的细线
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(PAD, 250);
    ctx.lineTo(W - PAD, 250);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function paintHeader(ctx, data, opts) {
    var ink = cssVar("--text-1", "#eef2ff");
    var dim = cssVar("--text-3", "#8b96b8");
    var glow = cssVar("--rank-glow", "#f5c451");

    ctx.textAlign = "left";
    ctx.fillStyle = dim;
    ctx.font = "500 46px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("R U N - F O R M   ·   星 河 契 约", PAD, 190);

    var id = data.contract && data.contract.id ? data.contract.id : "#0000";
    ctx.textAlign = "right";
    ctx.fillStyle = glow;
    ctx.font = "600 46px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(id, W - PAD, 190);

    // 主标题
    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = "700 168px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(opts.title || "我的星河", PAD, 430);

    var sub = opts.subtitle || "这些光，是我一天一天点起来的。";
    ctx.fillStyle = dim;
    ctx.font = "400 52px 'PingFang SC','Microsoft YaHei',sans-serif";
    var lines = wrapText(ctx, sub, W - PAD * 2);
    for (var i = 0; i < lines.length && i < 2; i++) {
      ctx.fillText(lines[i], PAD, 520 + i * 74);
    }
  }

  function paintRank(ctx, data, y) {
    var glow = cssVar("--rank-glow", "#f5c451");
    var ink = cssVar("--text-1", "#eef2ff");
    var dim = cssVar("--text-3", "#8b96b8");

    var r = data.rank || { name: "初见微光", icon: "✦", score: 0 };

    var boxH = 320;
    ctx.save();
    roundPath(ctx, PAD, y, W - PAD * 2, boxH, 40);
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 段位图标圆
    var cx = PAD + 150;
    var cy = y + boxH / 2;
    var rg = ctx.createRadialGradient(cx, cy, 6, cx, cy, 130);
    rg.addColorStop(0, glow);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "400 110px 'PingFang SC','Segoe UI Emoji',sans-serif";
    ctx.fillText(r.icon || "✦", cx, cy);

    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = "700 96px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(r.name || "初见微光", PAD + 300, cy - 40);

    ctx.fillStyle = dim;
    ctx.font = "400 46px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("契约值 " + (r.score || 0) + " · " + (r.tagline || "还在路上"), PAD + 300, cy + 52);

    ctx.textBaseline = "alphabetic";
    return y + boxH;
  }

  function paintStats(ctx, data, y) {
    var ink = cssVar("--text-1", "#eef2ff");
    var dim = cssVar("--text-3", "#8b96b8");
    var glow = cssVar("--rank-glow", "#f5c451");

    var items = [
      { v: String(data.total), k: "累计点亮" },
      { v: String(data.streak), k: "当前连续" },
      { v: String(data.activePlans), k: "缔结星数" }
    ];

    var gap = 40;
    var cw = (W - PAD * 2 - gap * 2) / 3;
    var chH = 300;

    for (var i = 0; i < items.length; i++) {
      var x = PAD + i * (cw + gap);
      roundPath(ctx, x, y, cw, chH, 36);
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = i === 1 ? glow : ink;
      ctx.font = "700 130px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillText(items[i].v, x + cw / 2, y + 170);

      ctx.fillStyle = dim;
      ctx.font = "400 44px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillText(items[i].k, x + cw / 2, y + 240);
    }
    ctx.textAlign = "left";
    return y + chH;
  }

  function paintHeat(ctx, data, y) {
    var dim = cssVar("--text-3", "#8b96b8");
    var glow = cssVar("--rank-glow", "#f5c451");

    ctx.fillStyle = dim;
    ctx.font = "500 48px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("近 26 周星点", PAD, y);

    var weeks = 26;
    var cols = heatMatrix(data.actMap, weeks);
    var avail = W - PAD * 2;
    var gap = 10;
    var cell = Math.floor((avail - gap * (weeks - 1)) / weeks);
    var top = y + 50;

    for (var w = 0; w < cols.length; w++) {
      for (var d = 0; d < 7; d++) {
        var it = cols[w][d];
        var x = PAD + w * (cell + gap);
        var yy = top + d * (cell + gap);
        roundPath(ctx, x, yy, cell, cell, 8);
        if (it.future) {
          ctx.fillStyle = "rgba(255,255,255,0.03)";
        } else if (it.n <= 0) {
          ctx.fillStyle = "rgba(255,255,255,0.07)";
        } else {
          var a = Math.min(1, 0.32 + it.n * 0.22);
          ctx.globalAlpha = a;
          ctx.fillStyle = glow;
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    return top + 7 * (cell + gap);
  }

  function paintOath(ctx, data, y, opts) {
    var ink = cssVar("--text-2", "#c8d2f0");
    var dim = cssVar("--text-3", "#8b96b8");

    var text =
      opts.oath ||
      "我不与谁比快慢，我只与昨天的自己续约。今夜也点亮一颗，明天再来。";

    ctx.fillStyle = ink;
    ctx.font = "400 56px 'PingFang SC','Microsoft YaHei',sans-serif";
    var lines = wrapText(ctx, text, W - PAD * 2 - 60);
    var ly = y;
    for (var i = 0; i < lines.length && i < 3; i++) {
      ctx.fillText(lines[i], PAD + 30, ly);
      ly += 80;
    }

    // 左侧引线
    ctx.strokeStyle = cssVar("--rank-glow", "#f5c451");
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(PAD, y - 50);
    ctx.lineTo(PAD, ly - 66);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = dim;
    return ly;
  }

  function paintFooter(ctx, data, opts) {
    var dim = cssVar("--text-3", "#8b96b8");

    // 左下：签署日期（可在设置里隐藏）
    if (!opts.hideDate) {
      var d = data.contract && data.contract.date ? data.contract.date : fmtDate(new Date());
      ctx.textAlign = "left";
      ctx.fillStyle = dim;
      ctx.font = "400 44px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillText("立约于 " + d, PAD, H - 180);
    }

    // 右下：固定署名（主理人拍板：不放二维码）
    ctx.textAlign = "right";
    ctx.fillStyle = dim;
    ctx.font = "500 44px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("RUN-form 星河契约", W - PAD, H - 180);
    ctx.textAlign = "left";
  }

  /* ============================================================
   * 对外 API
   * ========================================================== */

  /**
   * 生成海报 dataURL。同步返回字符串，调用方自行决定 <img> 预览还是下载。
   * @param {{title?:string,subtitle?:string,oath?:string,hideDate?:boolean}} opts
   * @returns {string} dataURL（失败时返回空串）
   */
  function build(opts) {
    var o = opts || {};
    if (typeof o.hideDate !== "boolean") {
      var p = null;
      try {
        p = g.loadPrefs ? g.loadPrefs() : null;
      } catch (e) {
        p = null;
      }
      o.hideDate = p ? p.posterHideDate !== false : true;
    }

    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    if (!ctx) return "";

    var url = "";
    try {
      var data = collect();

      paintBackground(ctx);
      paintHeader(ctx, data, o);

      var y = 660;
      y = paintRank(ctx, data, y) + 90;
      y = paintStats(ctx, data, y) + 130;
      y = paintHeat(ctx, data, y) + 170;
      paintOath(ctx, data, y, o);
      paintFooter(ctx, data, o);

      url = canvas.toDataURL("image/png");
    } catch (err) {
      url = "";
    } finally {
      // 立刻释放：2400×3600 的位图约 34MB，绝不留在内存里
      canvas.width = 0;
      canvas.height = 0;
    }
    return url;
  }

  /**
   * 生成并触发下载。
   * @returns {boolean} 是否成功
   */
  function download(opts) {
    var url = build(opts);
    if (!url) return false;
    try {
      var a = document.createElement("a");
      var d = new Date();
      a.href = url;
      a.download =
        "星河契约-" + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + ".png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** dataURL → File（用于系统分享） */
  function dataURLtoFile(dataURL, filename) {
    try {
      var arr = String(dataURL).split(",");
      var mime = (arr[0].match(/:(.*?);/) || [])[1] || "image/png";
      var bstr = atob(arr[1]);
      var n = bstr.length;
      var u8 = new Uint8Array(n);
      while (n--) u8[n] = bstr.charCodeAt(n);
      return new File([u8], filename, { type: mime });
    } catch (e) {
      return null;
    }
  }

  /**
   * 分享海报：能用系统分享（带文件）就用 navigator.share，
   * 否则降级为 a.download 直接下载（满足 C7 离线/不支持场景）。
   * @returns {Promise<boolean>} 是否成功唤起分享 / 下载
   */
  function share(opts) {
    var url = build(opts);
    if (!url) return Promise.resolve(false);
    var file = dataURLtoFile(url, "星河契约.png");
    try {
      if (
        file &&
        g.navigator &&
        typeof g.navigator.canShare === "function" &&
        g.navigator.canShare({ files: [file] })
      ) {
        return g.navigator
          .share({
            files: [file],
            title: (opts && opts.title) || "我的星河契约",
            text: "RUN-form 星河契约"
          })
          .then(function () {
            return true;
          })
          .catch(function () {
            return download(opts);
          });
      }
    } catch (e) {
      /* 落到下方降级 */
    }
    return Promise.resolve(download(opts));
  }

  g.Poster = {
    WIDTH: W,
    HEIGHT: H,
    build: build,
    download: download,
    share: share
  };
})(window);
