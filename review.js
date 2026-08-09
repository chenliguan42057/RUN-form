/**
 * 星河契约 · 回顾叙事（review.js，v6 · L1 计算层）
 *
 * 职责：把一段时间的数据讲成一段人话。不出图、不碰 DOM，只产出结构化叙事对象，
 *       由 components.js 的 uiReviewBlock 负责渲染。
 *
 * 设计原则：
 *   · **不说教**。只陈述发生了什么，不写「要继续加油哦」这类话。
 *   · **空态体面**。没有数据的那一周不该是一片「0」，而是一句「这一周天是暗的」。
 *   · 所有数字都从 store.js 现成的口径里取，不另立统计标准。
 *
 * 依赖：store.js 的 loadCheckins / loadPlans / dateKey / startOfDay / buildActivityMap /
 *       globalStreak / WEEKDAY_LABELS / pyWeekday；rank.js 的 Rank；mood.js 的 MoodStore
 * ⚠️ 本文件禁止声明 `$`。
 */
(function (g) {
  "use strict";

  var DAY = 86400000;

  /**
   * 算出某个 scope 的时间窗。
   * @param {"week"|"month"|"year"} scope 粒度
   * @param {Date|number|string} [ref] 参考日期，缺省今天
   * @returns {{from:Date, to:Date, title:string, spanDays:number}}
   */
  function windowOf(scope, ref) {
    var base =
      typeof g.startOfDay === "function" ? g.startOfDay(ref || new Date()) : new Date();
    var from;
    var to;
    var title;

    if (scope === "year") {
      from = new Date(base.getFullYear(), 0, 1);
      to = new Date(base.getFullYear(), 11, 31);
      title = base.getFullYear() + " 年星历";
    } else if (scope === "month") {
      from = new Date(base.getFullYear(), base.getMonth(), 1);
      to = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      title = base.getFullYear() + " 年 " + (base.getMonth() + 1) + " 月";
    } else {
      // 周一为一周之首（与 pyWeekday 口径一致）
      var wd = typeof g.pyWeekday === "function" ? g.pyWeekday(base) : 0;
      from = new Date(base.getFullYear(), base.getMonth(), base.getDate() - wd);
      to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
      title =
        from.getMonth() + 1 + " 月 " + from.getDate() + " 日 — " +
        (to.getMonth() + 1) + " 月 " + to.getDate() + " 日";
    }

    // 未来的日子不算进分母：本周才过到周三，不能按 7 天算完成度
    var todayEnd = typeof g.startOfDay === "function" ? g.startOfDay(new Date()) : new Date();
    var effectiveTo = to.getTime() > todayEnd.getTime() ? todayEnd : to;
    var spanDays = Math.max(1, Math.round((effectiveTo - from) / DAY) + 1);

    return { from: from, to: effectiveTo, title: title, spanDays: spanDays };
  }

  /**
   * 统计窗口内的原始数据。
   * @param {Date} from 起（含）
   * @param {Date} to 止（含）
   * @returns {Object}
   */
  function collect(from, to) {
    var checkins = [];
    try {
      checkins = typeof g.loadCheckins === "function" ? g.loadCheckins() : [];
    } catch (e) {
      checkins = [];
    }
    var lo = from.getTime();
    var hi = to.getTime() + DAY - 1;

    var inRange = checkins.filter(function (c) {
      return c.ts >= lo && c.ts <= hi;
    });

    var byDay = {};
    var byPlan = {};
    var byHour = new Array(24).fill(0);
    inRange.forEach(function (c) {
      var k = typeof g.dateKey === "function" ? g.dateKey(c.ts) : "";
      byDay[k] = (byDay[k] || 0) + 1;
      var pname = c.planName || "未命名";
      if (!byPlan[pname]) byPlan[pname] = { name: pname, icon: c.planIcon || "✅", count: 0 };
      byPlan[pname].count += 1;
      byHour[new Date(c.ts).getHours()] += 1;
    });

    var planRows = Object.keys(byPlan)
      .map(function (k) {
        return byPlan[k];
      })
      .sort(function (a, b) {
        return b.count - a.count || (a.name < b.name ? -1 : 1);
      });

    // 最亮的一天
    var bestDay = null;
    Object.keys(byDay).forEach(function (k) {
      if (!bestDay || byDay[k] > bestDay.count) bestDay = { date: k, count: byDay[k] };
    });

    // 最常动手的时辰
    var peakHour = -1;
    for (var h = 0; h < 24; h++) {
      if (byHour[h] > 0 && (peakHour < 0 || byHour[h] > byHour[peakHour])) peakHour = h;
    }

    return {
      total: inRange.length,
      activeDays: Object.keys(byDay).length,
      byDay: byDay,
      planRows: planRows,
      bestDay: bestDay,
      peakHour: peakHour,
      hourCounts: byHour,
    };
  }

  /**
   * 把时辰翻译成人话。
   * @param {number} h 小时 0~23
   * @returns {string}
   */
  function hourWord(h) {
    if (h < 0) return "";
    if (h < 5) return "凌晨";
    if (h < 9) return "清早";
    if (h < 12) return "上午";
    if (h < 14) return "正午";
    if (h < 18) return "下午";
    if (h < 22) return "夜里";
    return "深夜";
  }

  /**
   * 生成一段收束的诗句。数据越好句子越亮，但不吹捧。
   * @param {string} scope 粒度
   * @param {Object} data collect() 结果
   * @param {number} spanDays 窗口天数
   * @returns {string}
   */
  function poemOf(scope, data, spanDays) {
    var unit = scope === "year" ? "这一年" : scope === "month" ? "这个月" : "这一周";
    if (data.total === 0) {
      return unit + "，天是暗的。没关系，星图还在，随时可以重新点。";
    }
    var ratio = data.activeDays / spanDays;
    if (ratio >= 0.95) {
      return unit + "几乎没有暗过一天——" + data.activeDays + " 天里，每一夜都有光。";
    }
    if (ratio >= 0.7) {
      return unit + "亮了 " + data.activeDays + " 天，暗了 " + (spanDays - data.activeDays) + " 天。这个比例已经很难得。";
    }
    if (ratio >= 0.4) {
      return unit + "有 " + data.activeDays + " 天亮着。断续也是一种节奏，星轨本来就不是直线。";
    }
    return unit + "只亮了 " + data.activeDays + " 天。记录下来了，就不算白过。";
  }

  /**
   * 生成回顾叙事。
   * @param {"week"|"month"|"year"} scope 粒度
   * @param {Date|number|string} [ref] 参考日期
   * @returns {{scope:string, title:string, subtitle:string, empty:boolean,
   *            sections:Array<Object>, poem:string, rank:(Object|null), stats:Object}}
   */
  function renderReview(scope, ref) {
    var sc = scope === "month" || scope === "year" ? scope : "week";
    var win = windowOf(sc, ref);
    var data = collect(win.from, win.to);

    var rank = null;
    try {
      if (g.Rank && typeof g.Rank.getRank === "function") rank = g.Rank.getRank();
    } catch (e) {
      rank = null;
    }

    var streak = { current: 0, best: 0 };
    try {
      if (typeof g.globalStreak === "function") streak = g.globalStreak();
    } catch (e) {
      /* 保持零值 */
    }

    var stats = {
      total: data.total,
      activeDays: data.activeDays,
      spanDays: win.spanDays,
      rate: win.spanDays > 0 ? data.activeDays / win.spanDays : 0,
      streak: streak.current,
      best: streak.best,
      planCount: data.planRows.length,
    };

    var sections = [];

    // —— 段落 1：这段时间的骨架数字 ——
    sections.push({
      key: "shape",
      title: "轮廓",
      lines: data.total === 0
        ? ["窗口内没有任何点亮记录。"]
        : [
            "亮了 " + data.activeDays + " 天 / 共 " + win.spanDays + " 天（" +
              Math.round(stats.rate * 100) + "%）",
            "累计点亮 " + data.total + " 次，涉及 " + data.planRows.length + " 颗星",
          ],
    });

    // —— 段落 2：哪颗星最亮 ——
    if (data.planRows.length > 0) {
      var top = data.planRows.slice(0, 3);
      sections.push({
        key: "stars",
        title: "最亮的星",
        lines: top.map(function (p, i) {
          return (i + 1) + ". " + p.icon + " " + p.name + " · " + p.count + " 次";
        }),
      });
    }

    // —— 段落 3：节律（最亮的一天 + 惯常时辰）——
    var rhythm = [];
    if (data.bestDay) {
      rhythm.push("最满的一天是 " + data.bestDay.date + "，点亮 " + data.bestDay.count + " 次");
    }
    if (data.peakHour >= 0) {
      rhythm.push("你最常在" + hourWord(data.peakHour) + "（" + data.peakHour + " 点前后）动手");
    }
    if (rhythm.length > 0) {
      sections.push({ key: "rhythm", title: "节律", lines: rhythm });
    }

    // —— 段落 4：状态（情绪光谱，没填过就整段不出现）——
    try {
      if (g.MoodStore && typeof g.MoodStore.spectrum === "function") {
        var spec = g.MoodStore.spectrum(win.spanDays);
        if (spec.total > 0 && spec.dominant) {
          var moodLines = ["这段时间最常出现的状态是「" + spec.dominant.name + "」"];
          var low = (spec.counts.low || 0) + (spec.counts.edge || 0);
          if (low > 0) {
            moodLines.push("其中有 " + low + " 次是在「将熄 / 焦躁」里完成的——那几次最值钱");
          }
          sections.push({ key: "mood", title: "状态", lines: moodLines });
        }
      }
    } catch (e) {
      /* 情绪层不可用不影响回顾主体 */
    }

    // —— 段落 5：位阶 ——
    if (rank) {
      sections.push({
        key: "rank",
        title: "位阶",
        lines: [rank.icon + " " + rank.full + " · " + rank.desc, "当前积分 " + rank.score],
      });
    }

    return {
      scope: sc,
      title: win.title,
      subtitle:
        sc === "week" ? "周回顾" : sc === "month" ? "月回顾" : "年回顾",
      empty: data.total === 0,
      sections: sections,
      poem: poemOf(sc, data, win.spanDays),
      rank: rank,
      stats: stats,
    };
  }

  g.Review = {
    renderReview: renderReview,
    windowOf: windowOf,
  };
})(window);
