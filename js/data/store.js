/**
 * js/data/store.js —— 六域 CRUD + 墓碑 + 同步派发 + 连续天数
 *
 * 归属：A 组（T02）。签名冻结（设计文档 §5.3 / §3.1 Store 类）。
 * 依赖：RF.storage / RF.schema / RF.util / RF.bus（均已在前面加载）。
 *
 * 红线（§8.5）：SYNC_PROXY_URL / SYNC_APP_KEY 非机密可写死；resolveToken 永不外传。
 */
(function (RF) {
  "use strict";

  /** Cloudflare Worker 同步代理（非机密，可写死） */
  var SYNC_PROXY_URL = "https://runform-sync.3341644038.workers.dev";
  /** Worker 侧 X-App-Key，仅挡滥用，不是密钥 */
  var SYNC_APP_KEY = "runform-shared-9k2d";
  /** 仓库坐标（Token 回退通道用） */
  var REPO = "chenliguan42057/RUN-form";

  function S() { return RF.storage; }
  function SC() { return RF.schema; }
  function U() { return RF.util; }
  function B() { return RF.bus; }
  function K() { return S().KEYS; }

  /** 会话内已发过的「日级事件」去重（避免重复 emit） */
  var _dayEmitted = { perfect: "", missed: "" };

  /* ---------------- 内部读写助手 ---------------- */

  function loadRaw(key, fallback) {
    try { return S().getJSON(key, fallback); } catch (e) { return fallback; }
  }
  function saveRaw(key, val) {
    try { return S().setJSON(key, val); } catch (e) { return false; }
  }

  /* ---------------- 计划 Plan ---------------- */

  function loadPlans() {
    return loadRaw(K().PLANS, []).map(function (p) { return SC().normalizePlan(p); })
      .sort(function (a, b) { return a.order - b.order; });
  }

  function savePlans(list) {
    saveRaw(K().PLANS, (list || []).map(function (p) { return SC().normalizePlan(p); }));
    scheduleAutoSync("checkins");
  }

  function saveCheckins(list) {
    saveRaw(K().CHECKINS, (list || []).map(function (c) { return SC().normalizeCheckin(c); }));
    scheduleAutoSync("checkins");
  }

  function addPlan(fields) {
    var list = loadPlans();
    var plan = SC().defPlan(fields || {});
    if (!plan.id) plan.id = U().genId();
    plan.order = list.length;
    plan.createdAt = U().nowMs();
    plan.updatedAt = plan.createdAt;
    list.push(plan);
    savePlans(list);
    return plan;
  }

  function updatePlan(id, patch) {
    var list = loadPlans();
    var changed = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i] = SC().normalizePlan(Object.assign({}, list[i], patch, { id: id, updatedAt: U().nowMs() }));
        changed = true;
        break;
      }
    }
    if (changed) savePlans(list);
  }

  function deletePlan(id) {
    addTombstone("plans", id);
    var list = loadPlans().filter(function (p) { return p.id !== id; });
    savePlans(list);
  }

  function togglePlan(id) {
    var list = loadPlans();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].enabled = !list[i].enabled;
        list[i].updatedAt = U().nowMs();
        break;
      }
    }
    savePlans(list);
  }

  function todayPlans() {
    var now = new Date();
    var dow = (now.getDay() + 6) % 7; // Python 口径：周一=0
    var dom = now.getDate();
    return loadPlans().filter(function (p) {
      if (!p.enabled) return false;
      return RF.util.isPlanOnDay(p, U().dayKey());
    });
  }

  /* ---------------- 打卡 Checkin ---------------- */

  function loadCheckins() {
    return loadRaw(K().CHECKINS, []).map(function (c) { return SC().normalizeCheckin(c); });
  }

  function addCheckin(planId, extra) {
    var e = extra || {};
    var day = U().dayKey();
    var list = loadCheckins();
    // 幂等：同一 planId 同一天不重复写
    for (var i = 0; i < list.length; i++) {
      if (list[i].planId === planId && list[i].dayKey === day) {
        return list[i];
      }
    }
    var plan = null;
    if (planId) {
      var plans = loadPlans();
      for (var j = 0; j < plans.length; j++) { if (plans[j].id === planId) { plan = plans[j]; break; } }
    }
    var _dp = RF.content.get("tuning.difficultyPoints", [1, 1.0, 1.2, 1.5, 1.8, 2.2]);
    var coef = _dp[plan ? plan.difficulty : 3] || 1.5;
    var c = SC().defCheckin({
      id: U().genId(),
      planId: planId || null,
      planName: plan ? plan.name : "随手打卡",
      planIcon: plan ? plan.icon : "✨",
      dayKey: day,
      ts: U().nowMs(),
      note: e.note || "",
      image: e.image || "",
      points: Math.round(10 * coef)
    });
    list.push(c);
    saveCheckins(list);

    // 全勤奖励：若这一下让今天核心全勤，补 20 分
    if (dayStatus(day) === "perfect" && plan && plan.core) c.points += 20;

    // 通知各玩法系统（宠物/花园/段位/券各自订阅）
    try { B().emit("checkin:done", { planId: planId, ts: c.ts, points: c.points, checkin: c }); } catch (ex) {}

    // 今日全勤 → 发 day:perfect（同一天只发一次）
    if (dayStatus(day) === "perfect" && _dayEmitted.perfect !== day) {
      _dayEmitted.perfect = day;
      try { B().emit("day:perfect", { dayKey: day, streak: streakInfo().current }); } catch (ex) {}
    }
    return c;
  }

  function deleteCheckin(id) {
    addTombstone("checkins", id);
    var list = loadCheckins().filter(function (c) { return c.id !== id; });
    saveCheckins(list);
  }

  function checkinsOfDay(dayKey) {
    var d = dayKey || U().dayKey();
    return loadCheckins().filter(function (c) { return c.dayKey === d; });
  }

  function doneToday(planId) {
    var d = U().dayKey();
    return loadCheckins().some(function (c) { return c.planId === planId && c.dayKey === d; });
  }

  function dayStatus(dayKey) {
    var d = dayKey || U().dayKey();
    var core = loadPlans().filter(function (p) { return p.enabled && p.core && isOnDay(p, d); });
    if (core.length === 0) return "perfect"; // vacuous truth（决策 2）
    var done = core.filter(function (p) { return loadCheckins().some(function (c) { return c.planId === p.id && c.dayKey === d; }); });
    if (done.length === core.length) return "perfect";
    if (done.length > 0) return "partial";
    return "missed";
  }

  /** plan 是否在指定 dayKey 那天该做 */
  function isOnDay(plan, dayKey) {
    return RF.util.isPlanOnDay(plan, dayKey);
  }

  /* ---------------- 精灵 / 花园 / 券 / 档案 ---------------- */

  function loadPet() { return SC().normalizePet(loadRaw(K().PET, SC().defPet())); }
  function savePet(patch) {
    var cur = loadPet();
    var next = SC().normalizePet(Object.assign({}, cur, patch, { updatedAt: U().nowMs() }));
    saveRaw(K().PET, next);
    scheduleAutoSync("state");
    return next;
  }
  function loadGarden() { return SC().normalizeGarden(loadRaw(K().GARDEN, SC().defGarden())); }
  function saveGarden(patch) {
    var cur = loadGarden();
    var next = SC().normalizeGarden(Object.assign({}, cur, patch, { updatedAt: U().nowMs() }));
    saveRaw(K().GARDEN, next);
    scheduleAutoSync("state");
    return next;
  }
  function loadCoupons() {
    var now = U().nowMs();
    return loadRaw(K().COUPONS, []).map(function (c) { return SC().defCoupon(c); })
      .filter(function (c) { return c.expireAt >= now; });
  }
  function addCoupon(fields) {
    var list = loadRaw(K().COUPONS, []).map(function (c) { return SC().defCoupon(c); });
    var c = SC().defCoupon(fields || {});
    if (!c.id) c.id = U().genId();
    list.push(c);
    saveRaw(K().COUPONS, list);
    scheduleAutoSync("state");
    return c;
  }
  function saveCoupons(list) {
    saveRaw(K().COUPONS, (list || []).map(function (c) { return SC().defCoupon(c); }));
    scheduleAutoSync("state");
  }
  function loadProfile() { return SC().normalizeProfile(loadRaw(K().PROFILE, SC().defProfile())); }
  function saveProfile(patch) {
    var cur = loadProfile();
    var next = SC().normalizeProfile(Object.assign({}, cur, patch, { updatedAt: U().nowMs() }));
    saveRaw(K().PROFILE, next);
    scheduleAutoSync("state");
    return next;
  }
  function addPoints(n, reason) {
    var p = loadProfile();
    var delta = Number(n) || 0;
    p.points = Math.max(0, p.points + delta);
    if (delta > 0) p.totalPoints = p.totalPoints + delta;
    p.updatedAt = U().nowMs();
    saveRaw(K().PROFILE, p);
    scheduleAutoSync("state");
    return p;
  }

  /* ---------------- 连续天数 ---------------- */

  function streakInfo() {
    var today = U().dayKey();
    var cur = 0, best = 0, lastPerfect = "", broke = 0;
    // 无数据下限：回溯到「最早打卡日 / 最早计划起始日」为止。
    // 否则空计划（无核心计划日）时 dayStatus 永远返回 perfect，会无限回溯 → 页面卡死。
    var floor = today;
    loadCheckins().forEach(function (c) { if (c.dayKey < floor) floor = c.dayKey; });
    loadPlans().forEach(function (p) { if (p.startDay && p.startDay < floor) floor = p.startDay; });
    var guard = 0;
    // 向后扫：今天若 partial（进行中）不计入但继续；missed 即断
    var d = today;
    for (;;) {
      if (++guard > 4000) break; // 安全护栏：绝不允许无限回溯
      var st = dayStatus(d);
      if (st === "perfect") { cur++; if (lastPerfect === "") lastPerfect = d; }
      else if (d === today && st === "partial") { /* 今天进行中，不断也不计 */ }
      else { break; }
      // 往昨天走（到无数据区即停）
      var prev = U().addDays(d, -1);
      if (prev === d || prev < floor) break;
      d = prev;
    }
    // best：从最早打卡日扫到今天
    var checks = loadCheckins();
    if (checks.length) {
      var firstDay = today;
      checks.forEach(function (c) { if (c.dayKey < firstDay) firstDay = c.dayKey; });
      var run = 0, bd = firstDay;
      for (;;) {
        if (++guard > 8000) break; // 安全护栏
        if (dayStatus(bd) === "perfect") { run++; if (run > best) best = run; }
        else { run = 0; }
        var nxt = U().addDays(bd, 1);
        if (nxt === bd || nxt > today) break;
        bd = nxt;
      }
    }
    if (lastPerfect) broke = Math.max(0, U().diffDays(lastPerfect, today));
    return { current: cur, best: Math.max(best, cur), lastPerfectDay: lastPerfect, brokeDays: broke };
  }

  /* ---------------- 墓碑 ---------------- */

  function tombstoneMap() {
    return loadRaw(K().TOMBSTONES, SC().defTombstones());
  }
  function addTombstone(kind, id) {
    var t = tombstoneMap();
    if (!t[kind]) t[kind] = {};
    t[kind][id] = U().nowMs();
    saveRaw(K().TOMBSTONES, t);
  }

  /* ---------------- 同步 ---------------- */

  function resolveProxyUrl() {
    try { var custom = S().getRaw(K().PROXY_URL, ""); return custom || SYNC_PROXY_URL; }
    catch (e) { return SYNC_PROXY_URL; }
  }
  function resolveToken() {
    try { return S().getRaw(K().PAT, ""); } catch (e) { return ""; }
  }

  /** 过滤 note（决策 10：开启「不同步 note」后清空备注再出网） */
  function exportCheckins() {
    var noNote = loadProfile().settings && loadProfile().settings.noNote;
    return loadCheckins().map(function (c) {
      return noNote ? Object.assign({}, c, { note: "" }) : c;
    });
  }

  function buildPayload(kind) {
    var ts = tombstoneMap();
    if (kind === "checkins") {
      return { plans: loadPlans(), checkins: exportCheckins(), tombstones: ts };
    }
    return { pet: loadPet(), garden: loadGarden(), coupons: loadRaw(K().COUPONS, []), profile: loadProfile(), tombstones: ts };
  }

  function dispatchViaProxy(eventType, payload) {
    return new Promise(function (resolve) {
      var url = resolveProxyUrl();
      var body = JSON.stringify({ event_type: eventType, client_payload: payload });
      var done = false;
      var finish = function (ok, err) {
        if (done) return; done = true;
        if (ok) { try { B().emit("sync:ok", { kind: eventType }); } catch (e) {} }
        else { try { B().emit("sync:fail", { error: err || "unknown" }); } catch (e) {} }
        resolve();
      };
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("X-App-Key", SYNC_APP_KEY);
        xhr.timeout = 15000;
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) finish(true);
            else if (xhr.status === 0) finish(false, "network"); // 离线 / CORS
            else fallbackToken(eventType, payload, finish);
          }
        };
        xhr.ontimeout = function () { fallbackToken(eventType, payload, finish); };
        xhr.onerror = function () { fallbackToken(eventType, payload, finish); };
        xhr.send(body);
      } catch (e) {
        fallbackToken(eventType, payload, finish);
      }
    });
  }

  /** Token 回退通道：直发 GitHub repository_dispatch（仅在 proxy 失败且有 PAT 时） */
  function fallbackToken(eventType, payload, finish) {
    var token = resolveToken();
    if (!token) { finish(false, "no-channel"); return; }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "https://api.github.com/repos/" + REPO + "/dispatches", true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("Accept", "application/vnd.github+json");
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) finish(xhr.status >= 200 && xhr.status < 300, "gh-" + xhr.status);
      };
      xhr.send(JSON.stringify({ event_type: eventType, client_payload: payload }));
    } catch (e) { finish(false, "token-fail"); }
  }

  var _syncTimer = null;
  function scheduleAutoSync(kind) {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(function () {
      _syncTimer = null;
      syncToRepo();
    }, 800);
  }

  function syncToRepo() {
    var p1 = dispatchViaProxy("sync-checkins", buildPayload("checkins"));
    var p2 = dispatchViaProxy("sync-state", buildPayload("state"));
    return Promise.all([p1, p2]).then(function () { markLocalSync(); });
  }

  function markLocalSync() { saveRaw(K().LAST_SYNC, U().nowMs()); }
  function loadLastSync() {
    var v = S().getRaw(K().LAST_SYNC, "");
    return v ? Number(v) : 0;
  }

  function pullRepoState() {
    return new Promise(function (resolve) {
      var out = { profile: null, pushState: null };
      var t = U().nowMs();
      function get(url, key) {
        return new Promise(function (res) {
          try {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url + "?t=" + t, true);
            xhr.onreadystatechange = function () {
              if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) { try { res(JSON.parse(xhr.responseText)); } catch (e) { res(null); } }
                else res(null);
              }
            };
            xhr.onerror = function () { res(null); };
            xhr.send();
          } catch (e) { res(null); }
        });
      }
      Promise.all([
        get("data/profile.json", "profile"),
        get("data/push-state.json", "pushState")
      ]).then(function (r) {
        out.profile = r[0]; out.pushState = r[1];
        resolve(out);
      });
    });
  }

  /* ---------------- 首次运行初始化 ---------------- */

  function init() {
    var hasSchema = S().getRaw(K().SCHEMA, "");
    if (hasSchema) {
      // 已初始化：补发今日全勤事件（供券/庆典订阅）
      var today = U().dayKey();
      if (dayStatus(today) === "perfect" && _dayEmitted.perfect !== today) {
        _dayEmitted.perfect = today;
        try { B().emit("day:perfect", { dayKey: today, streak: streakInfo().current }); } catch (e) {}
      }
      // 每日结算：断签惩罚（幂等）
      try { B().emit("day:reset"); } catch (e) {}
      return;
    }
    // 首次运行
    var plans = loadRaw(K().PLANS, []);
    var checks = loadRaw(K().CHECKINS, []);
    if (checks.length || plans.length) {
      // v1 老用户：迁移
      var m = SC().migrate({ plans: plans, checkins: checks });
      saveRaw(K().PLANS, m.plans);
      saveRaw(K().CHECKINS, m.checkins);
      saveRaw(K().PET, m.pet);
      saveRaw(K().GARDEN, m.garden);
      saveRaw(K().COUPONS, m.coupons);
      saveRaw(K().PROFILE, m.profile);
    } else {
      // 全新用户：起名 + 种下默认种子任务
      var seed = RF.content.get("seed.plans", [
        { name: "喝一杯温水", icon: "💧", freq: "daily", time: "07:30", core: true, difficulty: 1, estMinutes: 2 },
        { name: "运动 20 分钟", icon: "🏃", freq: "daily", time: "08:00", core: true, difficulty: 4, estMinutes: 20 },
        { name: "读 10 页书", icon: "📚", freq: "daily", time: "21:00", core: true, difficulty: 3, estMinutes: 15 },
        { name: "写一句今日感想", icon: "✍️", freq: "daily", time: "22:00", core: false, difficulty: 2, estMinutes: 5 }
      ]);
      seed.forEach(function (f) { addPlan(f); });
      savePet(SC().defPet());
      saveGarden(SC().defGarden());
    }
    S().setRaw(K().SCHEMA, String(SC().SCHEMA_VERSION));
    // 同步一次全量
    syncToRepo();
  }

  RF.store = {
    SYNC_PROXY_URL: SYNC_PROXY_URL,
    SYNC_APP_KEY: SYNC_APP_KEY,
    /* 计划 */
    loadPlans: loadPlans,
    savePlans: savePlans,
    addPlan: addPlan,
    updatePlan: updatePlan,
    deletePlan: deletePlan,
    togglePlan: togglePlan,
    todayPlans: todayPlans,
    /* 打卡 */
    loadCheckins: loadCheckins,
    addCheckin: addCheckin,
    deleteCheckin: deleteCheckin,
    checkinsOfDay: checkinsOfDay,
    doneToday: doneToday,
    dayStatus: dayStatus,
    /* 精灵 / 花园 / 券 / 档案 */
    loadPet: loadPet,
    savePet: savePet,
    loadGarden: loadGarden,
    saveGarden: saveGarden,
    loadCoupons: loadCoupons,
    addCoupon: addCoupon,
    saveCoupons: saveCoupons,
    loadProfile: loadProfile,
    saveProfile: saveProfile,
    addPoints: addPoints,
    /* 连续天数 */
    streakInfo: streakInfo,
    /* 同步 */
    resolveProxyUrl: resolveProxyUrl,
    resolveToken: resolveToken,
    dispatchViaProxy: dispatchViaProxy,
    scheduleAutoSync: scheduleAutoSync,
    syncToRepo: syncToRepo,
    markLocalSync: markLocalSync,
    loadLastSync: loadLastSync,
    pullRepoState: pullRepoState,
    tombstoneMap: tombstoneMap,
    addTombstone: addTombstone,
    /* 初始化 */
    init: init,
    _dayEmitted: _dayEmitted
  };
})(window.RF = window.RF || {});
