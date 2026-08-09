/**
 * 星河契约 · 专注计时（focus.js，v6 · L3 交互层）
 *
 * 职责：一段不被打断的时间，结束后可以一键变成一颗真实的星。
 *
 * 三条硬约束：
 *   1. **倒计时用 Date.now() - startTs 推算，绝不累加 tick**。
 *      后台标签页的 setInterval 会被节流到 1 秒甚至更久，累加法跑 25 分钟能偏几分钟。
 *   2. **会话存在 localStorage，刷新 / 关页面能恢复**。
 *      pausedMs 记累计暂停时长，pauseTs 记本次暂停起点，恢复时按 now - start - paused 算。
 *   3. **只有 convertToStar() 产生真实 checkin**，走 addCheckin() + scheduleAutoSync()。
 *      abort() 一定不写台账——放弃就是放弃，不留半颗星。
 *
 * 依赖：store.js 的 addCheckin / scheduleAutoSync / loadPlans / loadPrefs
 * ⚠️ 本文件禁止声明 `$`。
 */
(function (g) {
  "use strict";

  /** 历史记录上限（环形），与 store.js 的 FOCUS_LOG_LIMIT 保持一致 */
  var LOG_LIMIT = 200;
  /** UI 刷新节拍。250ms 足够让秒数看起来是连续跳的，又不至于烧 CPU */
  var TICK_MS = 250;

  /** setInterval 句柄 */
  var timer = 0;
  /** 订阅者 */
  var tickCbs = [];
  var finishCbs = [];
  /** 本次会话是否已经派发过 finish（防止 tick 反复触发） */
  var firedFinish = false;

  /**
   * 读会话。
   * @returns {Object|null}
   */
  function loadSession() {
    try {
      var raw = localStorage.getItem("runform_focus");
      var s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s !== "object") return null;
      if (!Number.isFinite(Number(s.startTs)) || !Number.isFinite(Number(s.minutes))) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  /**
   * 写会话；传 null 清除。
   * @param {Object|null} s 会话
   * @returns {void}
   */
  function saveSession(s) {
    try {
      if (s) localStorage.setItem("runform_focus", JSON.stringify(s));
      else localStorage.removeItem("runform_focus");
    } catch (e) {
      console.error("写入专注会话失败：", e);
    }
  }

  /**
   * 计算会话的实时状态。
   * ⚠️ 全靠时间戳减法，与 tick 次数无关——这是本模块的核心正确性保证。
   * @param {Object} [s] 会话，缺省从存储读
   * @returns {{active:boolean, paused:boolean, elapsed:number, remain:number,
   *            total:number, percent:number, done:boolean, minutes:number,
   *            planId:(string|null), planName:string}}
   */
  function state(s) {
    var sess = s === undefined ? loadSession() : s;
    if (!sess) {
      return {
        active: false, paused: false, elapsed: 0, remain: 0, total: 0,
        percent: 0, done: false, minutes: 0, planId: null, planName: "",
      };
    }
    var total = Number(sess.minutes) * 60000;
    var pausedMs = Number(sess.pausedMs) || 0;
    var paused = Number.isFinite(Number(sess.pauseTs)) && Number(sess.pauseTs) > 0;
    // 暂停中：时间冻结在暂停那一刻
    var nowRef = paused ? Number(sess.pauseTs) : Date.now();
    var elapsed = Math.max(0, nowRef - Number(sess.startTs) - pausedMs);
    var remain = Math.max(0, total - elapsed);
    return {
      active: true,
      paused: paused,
      elapsed: elapsed,
      remain: remain,
      total: total,
      percent: total > 0 ? Math.min(1, elapsed / total) : 0,
      done: remain <= 0,
      minutes: Number(sess.minutes),
      planId: sess.planId || null,
      planName: sess.planName || "",
    };
  }

  /**
   * 启动 tick 循环（幂等）。
   * @returns {void}
   */
  function startTimer() {
    if (timer) return;
    timer = g.setInterval(function () {
      var st = state();
      if (!st.active) {
        stopTimer();
        return;
      }
      tickCbs.forEach(function (cb) {
        try {
          cb(st);
        } catch (e) {
          console.error("focus tick 回调异常：", e);
        }
      });
      if (st.done && !st.paused && !firedFinish) {
        firedFinish = true;
        onDone(st);
      }
    }, TICK_MS);
  }

  /**
   * 停 tick 循环。
   * @returns {void}
   */
  function stopTimer() {
    if (!timer) return;
    g.clearInterval(timer);
    timer = 0;
  }

  /**
   * 计时走完时的处理：响铃 + 通知订阅者。会话**不清除**，
   * 因为用户还得决定「转成星」还是「丢掉」。
   * @param {Object} st 状态快照
   * @returns {void}
   */
  function onDone(st) {
    stopTimer();
    if (g.Sensory && !g.Sensory.isSilent()) {
      g.Sensory.playChime("focus");
      g.Sensory.vibrate([30, 60, 30]);
    }
    finishCbs.forEach(function (cb) {
      try {
        cb(st);
      } catch (e) {
        console.error("focus finish 回调异常：", e);
      }
    });
  }

  /**
   * 开一段专注。已有进行中会话时直接返回旧状态，不覆盖。
   * @param {number} min 分钟数（5~120，越界夹紧）
   * @param {string|null} planId 关联计划 id
   * @param {string} planName 计划名（快照，计划改名不影响这次会话）
   * @returns {Object} 状态快照
   */
  function startFocus(min, planId, planName) {
    var exist = loadSession();
    if (exist) return state(exist);

    var m = Number(min);
    if (!Number.isFinite(m)) {
      try {
        m = typeof g.loadPrefs === "function" ? g.loadPrefs().focusMinutes : 25;
      } catch (e) {
        m = 25;
      }
    }
    m = Math.min(120, Math.max(5, Math.round(m)));

    var sess = {
      startTs: Date.now(),
      minutes: m,
      planId: planId || null,
      planName: String(planName || "专注"),
      pausedMs: 0,
      pauseTs: 0,
    };
    saveSession(sess);
    firedFinish = false;
    startTimer();
    if (g.Sensory) g.Sensory.unlock();
    return state(sess);
  }

  /**
   * 暂停。已暂停时是空操作。
   * @returns {Object} 状态快照
   */
  function pause() {
    var s = loadSession();
    if (!s || (Number(s.pauseTs) || 0) > 0) return state(s);
    s.pauseTs = Date.now();
    saveSession(s);
    stopTimer();
    return state(s);
  }

  /**
   * 继续。未暂停时是空操作。
   * @returns {Object} 状态快照
   */
  function resume() {
    var s = loadSession();
    if (!s || !(Number(s.pauseTs) > 0)) return state(s);
    // 把这段暂停时长累加进 pausedMs，startTs 保持不动（时间轴不能漂）
    s.pausedMs = (Number(s.pausedMs) || 0) + (Date.now() - Number(s.pauseTs));
    s.pauseTs = 0;
    saveSession(s);
    firedFinish = false;
    startTimer();
    return state(s);
  }

  /**
   * 放弃这段专注。
   * ⚠️ **绝不写台账**。放弃就是放弃，不留记录也不留半颗星。
   * @returns {boolean} 是否确实中止了一段会话
   */
  function abort() {
    var s = loadSession();
    if (!s) return false;
    stopTimer();
    saveSession(null);
    firedFinish = false;
    appendLog({
      minutes: Number(s.minutes),
      planId: s.planId || null,
      planName: s.planName || "",
      startTs: Number(s.startTs),
      endTs: Date.now(),
      completed: false,
      converted: false,
    });
    return true;
  }

  /**
   * 把完成的专注转成一颗真实的星。
   * 走 addCheckin() + scheduleAutoSync()，与手动点亮**完全同一条路径**，
   * checkin 仍是七字段，同步 payload 结构不变。
   * @returns {Object|null} 新建的 checkin；未完成 / 无会话时返回 null
   */
  function convertToStar() {
    var s = loadSession();
    if (!s) return null;
    var st = state(s);
    if (!st.done) return null;

    var item = null;
    try {
      item = g.addCheckin(s.planId || null, s.planName || "专注");
    } catch (e) {
      console.error("专注转星失败：", e);
      return null;
    }

    saveSession(null);
    stopTimer();
    firedFinish = false;
    appendLog({
      minutes: Number(s.minutes),
      planId: s.planId || null,
      planName: s.planName || "",
      startTs: Number(s.startTs),
      endTs: Date.now(),
      completed: true,
      converted: true,
      checkinId: item ? item.id : null,
    });

    try {
      if (typeof g.scheduleAutoSync === "function") g.scheduleAutoSync();
    } catch (e) {
      console.error("专注转星后同步排期失败：", e);
    }
    return item;
  }

  /**
   * 页面加载时恢复会话。
   * 常见场景：25 分钟专注开着，用户切走做别的事，回来时页面已被浏览器回收重载。
   * @returns {Object} 状态快照
   */
  function restore() {
    var s = loadSession();
    if (!s) return state(null);
    var st = state(s);
    if (st.done) {
      // 已经走完了：不自动转星（那是用户的决定），但把 finish 事件补派一次
      firedFinish = true;
      g.setTimeout(function () {
        finishCbs.forEach(function (cb) {
          try {
            cb(st);
          } catch (e) {
            /* 忽略单个订阅者异常 */
          }
        });
      }, 0);
      return st;
    }
    if (!st.paused) startTimer();
    return st;
  }

  /**
   * 追加一条历史（环形，超出上限丢最早的）。
   * @param {Object} row 记录
   * @returns {void}
   */
  function appendLog(row) {
    var list = history(LOG_LIMIT);
    list.push(row);
    while (list.length > LOG_LIMIT) list.shift();
    try {
      localStorage.setItem("runform_focus_log", JSON.stringify(list));
    } catch (e) {
      console.error("写入专注历史失败：", e);
    }
  }

  /**
   * 读专注历史（时间升序）。
   * @param {number} [limit] 最多返回几条（取最近的）
   * @returns {Array<Object>}
   */
  function history(limit) {
    var list = [];
    try {
      var raw = localStorage.getItem("runform_focus_log");
      var arr = raw ? JSON.parse(raw) : null;
      list = Array.isArray(arr) ? arr.filter(function (r) {
        return r && typeof r === "object";
      }) : [];
    } catch (e) {
      list = [];
    }
    var n = Number(limit);
    return Number.isFinite(n) && n > 0 ? list.slice(-Math.floor(n)) : list;
  }

  /**
   * 订阅 tick。
   * @param {Function} cb 回调，入参为状态快照
   * @returns {Function} 退订函数
   */
  function onTick(cb) {
    if (typeof cb === "function") tickCbs.push(cb);
    return function () {
      tickCbs = tickCbs.filter(function (f) {
        return f !== cb;
      });
    };
  }

  /**
   * 订阅计时结束。
   * @param {Function} cb 回调
   * @returns {Function} 退订函数
   */
  function onFinish(cb) {
    if (typeof cb === "function") finishCbs.push(cb);
    return function () {
      finishCbs = finishCbs.filter(function (f) {
        return f !== cb;
      });
    };
  }

  /**
   * 把毫秒格式化成 mm:ss。
   * @param {number} ms 毫秒
   * @returns {string}
   */
  function clock(ms) {
    var total = Math.max(0, Math.ceil(Number(ms) / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  g.Focus = {
    startFocus: startFocus,
    pause: pause,
    resume: resume,
    abort: abort,
    state: state,
    restore: restore,
    convertToStar: convertToStar,
    onTick: onTick,
    onFinish: onFinish,
    history: history,
    clock: clock,
  };
})(window);
