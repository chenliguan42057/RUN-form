/**
 * friendmap.js — D3 星图互鉴（短码导出 / 导入 / 对照）
 *
 * 设计取舍：
 *  - 短码只带「数字」：累计、当前连续、最佳连续、缔结星数、段位序号。
 *    不带计划名、不带备注、不带日期明细 —— 发给朋友不会泄露任何隐私。
 *  - 纯本地，不联网。复制粘贴就是全部的「社交」。
 *
 * 约定（白屏防御）：
 *  - 全文件 IIFE，只暴露 window.FriendMap
 *  - 不写任何进入 dispatchSync 的数据
 */
(function (g) {
  "use strict";

  var VER = 1;
  var PREFIX = "SR";

  /* ============================================================
   * 编解码
   * ========================================================== */

  function clampInt(n, max) {
    var v = Math.floor(Number(n) || 0);
    if (v < 0) v = 0;
    if (v > max) v = max;
    return v;
  }

  function b36(n, width) {
    var s = Number(n).toString(36).toUpperCase();
    while (s.length < width) s = "0" + s;
    return s;
  }

  /** 校验位：把所有字符码累加取 36 进制一位 */
  function checksum(body) {
    var sum = 0;
    for (var i = 0; i < body.length; i++) {
      sum = (sum * 31 + body.charCodeAt(i)) % 1296;
    }
    return b36(sum, 2);
  }

  function myStats() {
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

    var best = 0;
    var rankIdx = 0;
    var rankName = "初见微光";
    try {
      if (g.Rank && g.Rank.getRank) {
        var r = g.Rank.getRank();
        if (r) {
          rankIdx = typeof r.index === "number" ? r.index : 0;
          rankName = r.name || rankName;
          best = typeof r.bestStreak === "number" ? r.bestStreak : 0;
        }
      }
    } catch (e4) {
      /* 忽略 */
    }
    if (!best) best = streak;

    var active = 0;
    for (var i = 0; i < plans.length; i++) {
      if (plans[i] && plans[i].active !== false) active++;
    }

    return {
      total: checkins.length,
      streak: streak,
      best: best,
      plans: active,
      rankIdx: rankIdx,
      rankName: rankName
    };
  }

  /**
   * 生成我的短码，形如 SR1-0A2B-3C4D-XX
   * @returns {string}
   */
  function encode() {
    var s = myStats();
    var body =
      b36(clampInt(s.total, 46655), 3) +
      b36(clampInt(s.streak, 1295), 2) +
      b36(clampInt(s.best, 1295), 2) +
      b36(clampInt(s.plans, 1295), 2) +
      b36(clampInt(s.rankIdx, 35), 1);
    var code = PREFIX + VER + body + checksum(body);
    // 每 4 位一段，方便口头念和微信里换行不断
    return code.replace(/(.{4})(?=.)/g, "$1-");
  }

  /**
   * 解析别人的短码。
   * @param {string} code
   * @returns {{ok:boolean,reason?:string,total?:number,streak?:number,best?:number,plans?:number,rankIdx?:number,rankName?:string}}
   */
  function decode(code) {
    var raw = String(code || "")
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "");
    if (raw.length < 4) return { ok: false, reason: "短码太短了，是不是没复制全？" };
    if (raw.slice(0, 2) !== PREFIX) return { ok: false, reason: "这不像是星河契约的短码。" };

    var ver = parseInt(raw.charAt(2), 36);
    if (ver !== VER) return { ok: false, reason: "短码版本对不上，让对方更新一下。" };

    var body = raw.slice(3, 13);
    var sum = raw.slice(13, 15);
    if (body.length !== 10 || sum.length !== 2) {
      return { ok: false, reason: "短码长度不对，可能中间断了。" };
    }
    if (checksum(body) !== sum) return { ok: false, reason: "校验没过，短码像是被改过或漏了字符。" };

    var total = parseInt(body.slice(0, 3), 36);
    var streak = parseInt(body.slice(3, 5), 36);
    var best = parseInt(body.slice(5, 7), 36);
    var plans = parseInt(body.slice(7, 9), 36);
    var rankIdx = parseInt(body.slice(9, 10), 36);

    var rankName = "未知段位";
    try {
      if (g.Rank && g.Rank.RANK_TABLE && g.Rank.RANK_TABLE[rankIdx]) {
        rankName = g.Rank.RANK_TABLE[rankIdx].name;
      }
    } catch (e) {
      /* 忽略 */
    }

    return {
      ok: true,
      total: total,
      streak: streak,
      best: best,
      plans: plans,
      rankIdx: rankIdx,
      rankName: rankName
    };
  }

  /* ============================================================
   * 对照
   * ========================================================== */

  function verdict(mine, his) {
    // 有意不做「谁赢了」的判定，只给一句不刺人的话
    if (his.streak > mine.streak + 6) return "他现在的火比你旺，去问问他怎么撑住的。";
    if (mine.streak > his.streak + 6) return "你现在走在前面，别回头，顺手拉他一把。";
    if (Math.abs(mine.total - his.total) <= 3) return "你们几乎踩在同一格上，这种同行很难得。";
    return "各有各的节奏，能一起亮着就已经够了。";
  }

  /**
   * 我 vs 他，返回可直接渲染的行数据。
   * @param {Object} his - decode() 的结果
   */
  function compare(his) {
    if (!his || !his.ok) return { ok: false, reason: (his && his.reason) || "短码无效" };
    var mine = myStats();
    var rows = [
      { label: "累计点亮", mine: mine.total, his: his.total, unit: "次" },
      { label: "当前连续", mine: mine.streak, his: his.streak, unit: "天" },
      { label: "最佳连续", mine: mine.best, his: his.best, unit: "天" },
      { label: "缔结星数", mine: mine.plans, his: his.plans, unit: "颗" }
    ];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var m = Math.max(r.mine, r.his, 1);
      r.minePct = Math.round((r.mine / m) * 100);
      r.hisPct = Math.round((r.his / m) * 100);
      r.lead = r.mine === r.his ? "tie" : r.mine > r.his ? "mine" : "his";
    }
    return {
      ok: true,
      mine: mine,
      his: his,
      rows: rows,
      word: verdict(mine, his)
    };
  }

  /** 复制到剪贴板；失败返回 false 让调用方降级成手选文本 */
  function copy(text) {
    var s = String(text || "");
    try {
      if (g.navigator && g.navigator.clipboard && g.navigator.clipboard.writeText) {
        g.navigator.clipboard.writeText(s);
        return true;
      }
    } catch (e) {
      /* 往下走降级 */
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (e2) {
      return false;
    }
  }

  g.FriendMap = {
    VER: VER,
    encode: encode,
    decode: decode,
    compare: compare,
    stats: myStats,
    copy: copy
  };
})(window);
