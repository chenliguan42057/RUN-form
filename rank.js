/**
 * 星河契约 · 段位（rank.js，v6 · L1 计算层）
 *
 * 职责：把「坚持」折算成一个能看见的位阶。纯计算，不碰 DOM、不写 localStorage。
 *
 * 计分公式（主理人拍板，不可单边改）：
 *   score = totalActive × 1 + bestStreak × 2 + currentStreak × 1
 *   · totalActive   有活动的自然日总数（广度：你来过多少天）
 *   · bestStreak    历史最佳连续（深度：你最狠的时候有多狠，权重 ×2）
 *   · currentStreak 当前连续（现状：你现在还在不在）
 *   三项相加而非取大：广度、深度、现状缺一不可，只刷一项上不去。
 *
 * 门槛（needBest / needActive）的意义：
 *   光靠「天天来但从不连着」堆分数，最高只能停在星匠。
 *   星帅要求最佳连续 ≥ 30，星河之主 ≥ 100，长明 ≥ 365 且累计 500 天。
 *
 * 「长明」是隐藏最高阶：未达成前不在任何列表里出现，达成才现身。
 *
 * 依赖：store.js 的 globalStreak() / overviewStats()
 * ⚠️ 本文件禁止声明 `$`。
 */
(function (g) {
  "use strict";

  /**
   * 段位表。**必须按 min 升序**，getRank() 依赖这个顺序逐级校验。
   *   key       稳定标识（写进 UI class / 数据都用它）
   *   name      显示名
   *   tier      罗马数字级次，同名段位内部的小阶
   *   min       分数门槛
   *   needBest  最佳连续门槛（可选）
   *   needActive 累计活跃天门槛（可选）
   *   hidden    true = 未达成时不出现在段位列表里（隐藏最高阶）
   */
  var RANK_TABLE = [
    { key: "novice1", name: "星徒", tier: "Ⅰ", min: 0, icon: "✧", desc: "第一次抬头看天" },
    { key: "novice2", name: "星徒", tier: "Ⅱ", min: 15, icon: "✧", desc: "开始记得回来" },
    { key: "novice3", name: "星徒", tier: "Ⅲ", min: 40, icon: "✧", desc: "习惯有了雏形" },
    { key: "smith1", name: "星匠", tier: "Ⅰ", min: 80, icon: "✦", desc: "会自己修补节奏了" },
    { key: "smith2", name: "星匠", tier: "Ⅱ", min: 150, icon: "✦", desc: "断了也能接回来" },
    { key: "smith3", name: "星匠", tier: "Ⅲ", min: 260, icon: "✦", desc: "手艺稳了" },
    { key: "marshal1", name: "星帅", tier: "Ⅰ", min: 400, needBest: 30, icon: "★", desc: "连续 30 天以上的人" },
    { key: "marshal2", name: "星帅", tier: "Ⅱ", min: 600, needBest: 30, icon: "★", desc: "长线作战者" },
    { key: "marshal3", name: "星帅", tier: "Ⅲ", min: 850, needBest: 30, icon: "★", desc: "节奏由你定" },
    { key: "sovereign", name: "星河之主", tier: "", min: 1200, needBest: 100, icon: "👑", desc: "百日不断的人" },
    {
      key: "eternal",
      name: "长明",
      tier: "",
      min: 2000,
      needBest: 365,
      needActive: 500,
      icon: "🕯",
      desc: "整年零断。灯没灭过。",
      hidden: true,
    },
  ];

  /**
   * 读一次统计快照。集中在这里，避免每个函数各自 loadCheckins 造成重复计算。
   * @returns {{totalActive:number, best:number, current:number}}
   */
  function snapshot() {
    var streak = { current: 0, best: 0 };
    var totalActive = 0;
    try {
      if (typeof g.globalStreak === "function") streak = g.globalStreak() || streak;
    } catch (e) {
      console.error("读取连续记录失败：", e);
    }
    try {
      if (typeof g.buildActivityMap === "function") {
        var map = g.buildActivityMap();
        totalActive = map && typeof map.size === "number" ? map.size : 0;
      }
    } catch (e) {
      console.error("读取活跃天数失败：", e);
    }
    return {
      totalActive: totalActive,
      best: Number(streak.best) || 0,
      current: Number(streak.current) || 0,
    };
  }

  /**
   * 当前分数。
   * @returns {number} 非负整数
   */
  function score() {
    var s = snapshot();
    return s.totalActive + s.best * 2 + s.current;
  }

  /**
   * 判断某一档是否达成。
   * @param {Object} row RANK_TABLE 的一项
   * @param {number} sc 当前分数
   * @param {Object} s 统计快照
   * @returns {boolean}
   */
  function qualifies(row, sc, s) {
    if (sc < row.min) return false;
    if (row.needBest !== undefined && s.best < row.needBest) return false;
    if (row.needActive !== undefined && s.totalActive < row.needActive) return false;
    return true;
  }

  /**
   * 取当前段位。
   * 逐级向上校验，**遇到第一个不达标的档就停**——段位不能跳级，
   * 「分数够了但连续不够」的人应当卡在门槛前，而不是被更高档的分数线捞过去。
   * @returns {Object} 段位对象（含 score / stats / index / full 展示名）
   */
  function getRank() {
    var s = snapshot();
    var sc = s.totalActive + s.best * 2 + s.current;
    var idx = 0;
    for (var i = 0; i < RANK_TABLE.length; i++) {
      if (qualifies(RANK_TABLE[i], sc, s)) idx = i;
      else break;
    }
    var row = RANK_TABLE[idx];
    return {
      key: row.key,
      name: row.name,
      tier: row.tier,
      full: row.tier ? row.name + " " + row.tier : row.name,
      icon: row.icon,
      desc: row.desc,
      index: idx,
      min: row.min,
      hidden: row.hidden === true,
      score: sc,
      stats: s,
    };
  }

  /**
   * 到下一档的进度。
   * 已在顶阶（长明）时 next 为 null，percent 恒 1。
   * @returns {{current:Object, next:(Object|null), percent:number, need:number, blockedBy:(string|null)}}
   */
  function rankProgress() {
    var cur = getRank();
    var s = cur.stats;
    var nextRow = RANK_TABLE[cur.index + 1] || null;
    if (!nextRow) {
      return { current: cur, next: null, percent: 1, need: 0, blockedBy: null };
    }

    var span = nextRow.min - cur.min;
    var gained = cur.score - cur.min;
    var percent = span > 0 ? Math.min(1, Math.max(0, gained / span)) : 1;

    // 分数够了但被连续门槛卡住时，明确告诉用户卡在哪，不要让进度条骗人
    var blockedBy = null;
    if (cur.score >= nextRow.min) {
      if (nextRow.needBest !== undefined && s.best < nextRow.needBest) {
        blockedBy = "最佳连续还差 " + (nextRow.needBest - s.best) + " 天";
      } else if (nextRow.needActive !== undefined && s.totalActive < nextRow.needActive) {
        blockedBy = "累计亮着的日子还差 " + (nextRow.needActive - s.totalActive) + " 天";
      }
      if (blockedBy) percent = 1;
    }

    return {
      current: cur,
      next: {
        key: nextRow.key,
        name: nextRow.name,
        tier: nextRow.tier,
        full: nextRow.tier ? nextRow.name + " " + nextRow.tier : nextRow.name,
        icon: nextRow.icon,
        min: nextRow.min,
        hidden: nextRow.hidden === true,
      },
      percent: percent,
      need: Math.max(0, nextRow.min - cur.score),
      blockedBy: blockedBy,
    };
  }

  /**
   * 可展示的段位列表：隐藏阶未达成时不出现。
   * @returns {Array<Object>} 每项含 reached:boolean
   */
  function visibleTable() {
    var cur = getRank();
    return RANK_TABLE.filter(function (row, i) {
      return row.hidden !== true || i <= cur.index;
    }).map(function (row, i) {
      return Object.assign({}, row, {
        full: row.tier ? row.name + " " + row.tier : row.name,
        reached: i <= cur.index,
      });
    });
  }

  g.Rank = {
    RANK_TABLE: RANK_TABLE,
    score: score,
    getRank: getRank,
    rankProgress: rankProgress,
    visibleTable: visibleTable,
  };
})(window);
