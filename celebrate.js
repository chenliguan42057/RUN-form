/**
 * 星河契约 · 庆典编排（celebrate.js，v6 · L3 交互层）
 *
 * 职责：把「打卡成功」「升段」「破里程碑」三件事，编排成有层次的感官反馈。
 *   打卡    → 定点星屑 + 清脆 chime + 短振（日常，克制）
 *   升段    → 双音 chime + 双段振 + 中量星爆（少见，有分量）
 *   里程碑  → 低频鼓 + 全屏星爆 + 一句话横幅（罕见，要留得住）
 *
 * 去重：里程碑一辈子只庆祝一次，已庆祝的天数记在 runform_celebrated。
 *       重装 / 清缓存后会重复庆祝一次，这是可接受的——总比每次刷新都炸一遍强。
 *
 * 降级：一切感官输出都过 Sensory 的闸。静默时只保留 CSS 脉冲（给元素挂 .fx-pulse）。
 *
 * 依赖：sensory.js 的 Sensory；rank.js 的 Rank；store.js 的 globalStreak / MILESTONES
 * ⚠️ 本文件禁止声明 `$`。
 */
(function (g) {
  "use strict";

  /** CSS 脉冲类名的存活时长，须与 styles.css 里的 @keyframes fx-pulse 时长一致 */
  var PULSE_MS = 620;

  /**
   * 读已庆祝过的里程碑天数集合。
   * @returns {Array<number>}
   */
  function loadCelebrated() {
    try {
      var raw = localStorage.getItem("runform_celebrated");
      var arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr.filter(function (n) {
        return Number.isFinite(Number(n));
      }).map(Number) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 记下某个里程碑已庆祝。
   * @param {number} days 里程碑天数
   * @returns {void}
   */
  function markCelebrated(days) {
    var list = loadCelebrated();
    if (list.indexOf(days) >= 0) return;
    list.push(days);
    try {
      localStorage.setItem("runform_celebrated", JSON.stringify(list));
    } catch (e) {
      console.error("记录庆祝状态失败：", e);
    }
  }

  /**
   * 给元素挂一次性 CSS 脉冲。这是静默模式下唯一保留的反馈，必须始终可用。
   * @param {Element} el 目标元素
   * @returns {void}
   */
  function pulse(el) {
    if (!el || !el.classList) return;
    el.classList.remove("fx-pulse");
    // 强制重排，否则连续两次打卡时动画不会重播
    void el.offsetWidth;
    el.classList.add("fx-pulse");
    g.setTimeout(function () {
      el.classList.remove("fx-pulse");
    }, PULSE_MS);
  }

  /**
   * 取元素中心的视口坐标，供定点星屑使用。
   * @param {Element} el 目标元素
   * @returns {{x:number, y:number}}
   */
  function centerOf(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") {
      return { x: (g.innerWidth || 360) / 2, y: (g.innerHeight || 640) / 2 };
    }
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /**
   * 打卡仪式：一颗星亮起来的那一下。
   * @param {Element} el 触发元素（星屑从它的中心炸开）
   * @param {string} [id] 打卡记录 id，预留给情绪着色
   * @returns {{silent:boolean}}
   */
  function onCheckin(el, id) {
    // CSS 脉冲永远执行——它是静默模式下唯一的反馈
    pulse(el);

    if (!g.Sensory) return { silent: true };
    if (g.Sensory.isSilent()) return { silent: true };

    g.Sensory.playChime("star");
    g.Sensory.vibrate(18);

    var c = centerOf(el);
    g.Sensory.burst(c.x, c.y, { count: 20, speed: 200, life: 850 });
    return { silent: false, id: id || null };
  }

  /**
   * 升段庆典：比打卡重，比里程碑轻。
   * @param {Object} prev 升段前的段位对象
   * @param {Object} next 升段后的段位对象
   * @returns {boolean} 是否真的放了庆典
   */
  function celebrateRankUp(prev, next) {
    if (!next || !prev || prev.key === next.key) return false;

    banner("🎖 " + next.icon + " 位阶提升：" + next.full, next.desc || "");

    if (!g.Sensory || g.Sensory.isSilent()) return true;
    g.Sensory.playChime("rank");
    g.Sensory.vibrate([26, 60, 40]);
    g.Sensory.fullBurst({ count: 90 });
    return true;
  }

  /**
   * 里程碑庆典：全屏星爆 + 低频鼓。**一辈子只放一次**。
   * @param {number} days 里程碑天数
   * @returns {boolean} 是否真的放了庆典（已庆祝过返回 false）
   */
  function celebrateMilestone(days) {
    var d = Number(days);
    if (!Number.isFinite(d) || d <= 0) return false;
    if (loadCelebrated().indexOf(d) >= 0) return false;
    markCelebrated(d);

    var meta = null;
    try {
      meta = (g.MILESTONES || []).find(function (m) {
        return m.days === d;
      });
    } catch (e) {
      meta = null;
    }
    var icon = meta ? meta.icon : "🏅";
    var name = meta ? meta.name : "里程碑";

    banner(icon + " " + name + " · 连续 " + d + " 天", "这一段，是你自己走完的。");

    if (!g.Sensory || g.Sensory.isSilent()) return true;
    // 鼓在前，亮片在后，隔 180ms 出——同时响会糊成一团
    g.Sensory.playChime("drum");
    g.setTimeout(function () {
      if (g.Sensory.isSilent()) return;
      g.Sensory.playChime("rank");
    }, 180);
    g.Sensory.vibrate([40, 80, 40, 80, 120]);
    g.Sensory.fullBurst({ count: 160 });
    return true;
  }

  /**
   * 检查当前是否刚好踩中一个未庆祝的里程碑。
   * @returns {number|null} 待庆祝的天数
   */
  function pendingMilestone() {
    var reached = 0;
    try {
      var s = typeof g.globalStreak === "function" ? g.globalStreak() : { current: 0, best: 0 };
      reached = Math.max(Number(s.current) || 0, Number(s.best) || 0);
    } catch (e) {
      return null;
    }
    var done = loadCelebrated();
    var table = Array.isArray(g.MILESTONES) ? g.MILESTONES : [];
    var hit = null;
    table.forEach(function (m) {
      if (reached >= m.days && done.indexOf(m.days) < 0) {
        // 多个同时达成时取最高的那个，不连放几遍
        if (!hit || m.days > hit) hit = m.days;
      }
    });
    return hit;
  }

  /**
   * 顶部庆典横幅（自己收起，不需要用户点）。
   * 用独立节点而非 toast：toast 是「操作反馈」，庆典是「事件」，两者不该抢同一个位置。
   * @param {string} title 主标题
   * @param {string} sub 副标题
   * @returns {void}
   */
  function banner(title, sub) {
    var root = document.getElementById("overlay-root");
    if (!root) return;
    var old = root.querySelector(".fx-banner");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var esc = typeof g.escapeHtml === "function" ? g.escapeHtml : function (s) {
      return String(s);
    };
    var box = document.createElement("div");
    box.className = "fx-banner";
    box.setAttribute("role", "status");
    box.innerHTML =
      '<p class="fx-banner-title">' + esc(title) + "</p>" +
      (sub ? '<p class="fx-banner-sub">' + esc(sub) + "</p>" : "");
    root.appendChild(box);

    g.setTimeout(function () {
      box.classList.add("is-out");
      g.setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 420);
    }, 3600);
  }

  g.Celebrate = {
    onCheckin: onCheckin,
    celebrateMilestone: celebrateMilestone,
    celebrateRankUp: celebrateRankUp,
    pendingMilestone: pendingMilestone,
    pulse: pulse,
    banner: banner,
  };
})(window);
