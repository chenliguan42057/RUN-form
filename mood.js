/**
 * 星河契约 · 情绪旁路表（mood.js，v6 · L1 计算层）
 *
 * 职责：给每次打卡挂一条「当时什么状态」的记录，让星点有温度差。
 *
 * ⚠️ **架构红线（本文件存在的全部理由）**：
 *   checkin 对象结构**一字不改**，恒为七字段 {id, planId, planName, ts, note, planIcon, source}。
 *   情绪数据一律存在**旁路表** runform_moodmap 里，用 checkinId 做外键关联。
 *   原因：checkins 会整体进 dispatchSync 的 client_payload，往里塞字段就等于
 *   把「今天心情怎么样」推到公开仓库，且会破坏 sync.yml 的输入契约。
 *   旁路表永远留在本机，换设备重填是可接受的代价。
 *
 * GC：旁路表按 checkinId 外键存活，打卡被删后就成孤儿。gc() 在打卡变动后调用，
 *     把找不到宿主的条目清掉，避免这张表随时间无限膨胀。
 *
 * 依赖：store.js 的 loadCheckins()
 * ⚠️ 本文件禁止声明 `$`。
 */
(function (g) {
  "use strict";

  /**
   * 五个情绪维度（主理人拍板，数量与命名不可单边改）。
   *   e     energy 档位，用于光谱排序（满电最高）
   *   hue   色相，情绪光谱直接拿它算 hsl()
   */
  var MOODS = [
    { key: "full", name: "满电", icon: "⚡", hue: 45, e: 5, hint: "有劲，还能再来" },
    { key: "glow", name: "微光", icon: "✨", hue: 200, e: 4, hint: "不亢奋，但亮着" },
    { key: "calm", name: "稳态", icon: "🌊", hue: 170, e: 3, hint: "平，刚好" },
    { key: "low", name: "将熄", icon: "🕯", hue: 225, e: 2, hint: "撑着做完的" },
    { key: "edge", name: "焦躁", icon: "🔥", hue: 20, e: 1, hint: "心里有火" },
  ];

  /** key → 定义，避免每次 find 线性扫 */
  var BY_KEY = {};
  MOODS.forEach(function (m) {
    BY_KEY[m.key] = m;
  });

  /** 备注长度上限：这是「一句话」不是日记，超出截断 */
  var NOTE_MAX = 60;

  /**
   * 读整张旁路表。任何异常都返回空对象，绝不让页面挂掉。
   * @returns {Object} {[checkinId]: {e, m, note, ts}}
   */
  function loadMap() {
    try {
      var raw = localStorage.getItem("runform_moodmap");
      var data = raw ? JSON.parse(raw) : null;
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (e) {
      console.error("读取情绪表失败，已重置：", e);
      return {};
    }
  }

  /**
   * 写整张旁路表。
   * @param {Object} map 表内容
   * @returns {boolean} 是否写入成功
   */
  function saveMap(map) {
    try {
      localStorage.setItem("runform_moodmap", JSON.stringify(map || {}));
      return true;
    } catch (e) {
      console.error("写入情绪表失败：", e);
      return false;
    }
  }

  /**
   * 给一条打卡记录挂情绪。
   * @param {string} id checkin.id
   * @param {{m?:string, e?:number, note?:string}} data 情绪数据，m = MOODS 的 key
   * @returns {Object|null} 写入的条目，非法入参返回 null
   */
  function recordMood(id, data) {
    var cid = String(id || "").trim();
    if (!cid) return null;
    var d = data && typeof data === "object" ? data : {};
    var def = BY_KEY[d.m];
    if (!def) return null;

    var entry = {
      m: def.key,
      e: Number.isFinite(Number(d.e)) ? Number(d.e) : def.e,
      note: String(d.note == null ? "" : d.note).trim().slice(0, NOTE_MAX),
      ts: Date.now(),
    };
    var map = loadMap();
    map[cid] = entry;
    return saveMap(map) ? entry : null;
  }

  /**
   * 取某条打卡的情绪。
   * @param {string} id checkin.id
   * @returns {Object|null} 含 def（情绪定义）的完整条目
   */
  function getMood(id) {
    var map = loadMap();
    var hit = map[String(id || "")];
    if (!hit || !BY_KEY[hit.m]) return null;
    return Object.assign({}, hit, { def: BY_KEY[hit.m] });
  }

  /**
   * 取某条打卡对应的着色（供星点 / 台账做色调偏移）。
   * @param {string} id checkin.id
   * @returns {string} CSS 颜色；没有记录时返回空串（调用方保持原色）
   */
  function tintOf(id) {
    var hit = getMood(id);
    if (!hit) return "";
    return "hsl(" + hit.def.hue + " 72% 62%)";
  }

  /**
   * 近 N 天的情绪光谱：按天聚合出主导情绪与能量均值。
   * 星历页拿它画一条彩色带，一眼看出「哪几天是硬撑过来的」。
   * @param {number} [days=30] 回溯天数
   * @returns {{days:Array<Object>, total:number, counts:Object, dominant:(Object|null)}}
   */
  function spectrum(days) {
    var span = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.floor(Number(days)) : 30;
    var map = loadMap();
    var checkins = [];
    try {
      checkins = typeof g.loadCheckins === "function" ? g.loadCheckins() : [];
    } catch (e) {
      checkins = [];
    }

    // 先把「日期 → 该日所有情绪」归拢
    var byDay = {};
    var counts = {};
    var total = 0;
    MOODS.forEach(function (m) {
      counts[m.key] = 0;
    });

    checkins.forEach(function (c) {
      var hit = map[c.id];
      if (!hit || !BY_KEY[hit.m]) return;
      var key = typeof g.dateKey === "function" ? g.dateKey(c.ts) : "";
      if (!key) return;
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(hit);
      counts[hit.m] += 1;
      total += 1;
    });

    // 再按自然日铺满 span 天（没有记录的日子也要占位，光谱才连续）
    var out = [];
    var today = new Date();
    for (var i = span - 1; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var k = typeof g.dateKey === "function" ? g.dateKey(d) : "";
      var list = byDay[k] || [];
      if (list.length === 0) {
        out.push({ date: k, mood: null, hue: 0, energy: 0, count: 0 });
        continue;
      }
      // 主导情绪 = 当天出现次数最多的那个（并列时取能量高的，别把「将熄」顶上去）
      var tally = {};
      var energySum = 0;
      list.forEach(function (h) {
        tally[h.m] = (tally[h.m] || 0) + 1;
        energySum += Number(h.e) || BY_KEY[h.m].e;
      });
      var top = null;
      Object.keys(tally).forEach(function (mk) {
        if (
          !top ||
          tally[mk] > tally[top] ||
          (tally[mk] === tally[top] && BY_KEY[mk].e > BY_KEY[top].e)
        ) {
          top = mk;
        }
      });
      out.push({
        date: k,
        mood: BY_KEY[top],
        hue: BY_KEY[top].hue,
        energy: energySum / list.length,
        count: list.length,
      });
    }

    // 全局主导情绪
    var dominantKey = null;
    Object.keys(counts).forEach(function (mk) {
      if (counts[mk] > 0 && (!dominantKey || counts[mk] > counts[dominantKey])) dominantKey = mk;
    });

    return {
      days: out,
      total: total,
      counts: counts,
      dominant: dominantKey ? BY_KEY[dominantKey] : null,
    };
  }

  /**
   * 清理孤儿条目：宿主打卡已被删除的情绪记录。
   * 在打卡删除 / 清空 / 导入之后调用。
   * @returns {number} 清掉的条目数
   */
  function gc() {
    var map = loadMap();
    var keys = Object.keys(map);
    if (keys.length === 0) return 0;

    var alive = new Set();
    try {
      (typeof g.loadCheckins === "function" ? g.loadCheckins() : []).forEach(function (c) {
        alive.add(c.id);
      });
    } catch (e) {
      // 读不到台账时**不清理**：宁可留着孤儿，也不能误删用户数据
      return 0;
    }

    var removed = 0;
    keys.forEach(function (k) {
      if (!alive.has(k)) {
        delete map[k];
        removed += 1;
      }
    });
    if (removed > 0) saveMap(map);
    return removed;
  }

  g.MoodStore = {
    MOODS: MOODS,
    NOTE_MAX: NOTE_MAX,
    recordMood: recordMood,
    getMood: getMood,
    tintOf: tintOf,
    spectrum: spectrum,
    gc: gc,
  };
})(window);
