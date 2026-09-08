/**
 * js/systems/coupon.js —— 野餐篮美食券：发放 / 叠加 / 核销 / 偷吃
 * 归属：C 组（T04）。订阅 bus "day:perfect" → 按连续天数发放（幂等）。
 * 依赖 store.streakInfo().current；与 pet/garden 只走 bus。
 */
(function (RF) {
  "use strict";

  var RULES = RF.content.get("coupon.rules", {
    basic: { amount: 50, kind: "basic" },
    upgrade: { amount: 100, kind: "upgrade" },
    luxury: { amount: 200, kind: "luxury" }
  });

  /** 里程碑：连续天数 → 发券规格（可叠加，无上限）。可在 data/content.json 自由调整 */
  var MILESTONES = RF.content.get("coupon.milestones", [
    { days: 7, kind: "basic", amount: 50, source: "streak7", label: "连续 7 天 · 基础野餐篮" },
    { days: 14, kind: "upgrade", amount: 100, source: "streak14", label: "连续 14 天 · 升级野餐篮" },
    { days: 30, kind: "luxury", amount: 200, source: "streak30", label: "连续 30 天 · 豪华野餐篮" }
  ]);

  function U() { return RF.util; }
  function B() { return RF.bus; }
  function store() { return RF.store; }

  function get() { return store().loadCoupons(); }

  function listUnused() {
    var now = U().nowMs();
    return get().filter(function (c) {
      return c.usedAt === null && c.expireAt >= now && c.usedAmount < c.amount;
    });
  }

  function balance() {
    return listUnused().reduce(function (s, c) { return s + (c.amount - c.usedAmount); }, 0);
  }

  /** 按连续天数发券（幂等：同一 milestone 只发一次，记 profile.granted） */
  function grant(streakDays) {
    var granted = store().loadProfile().granted || {};
    var fresh = [];
    MILESTONES.forEach(function (m) {
      if (streakDays >= m.days && !granted[m.source]) {
        var c = store().addCoupon({
          kind: m.kind, amount: m.amount, source: m.source, note: m.label, grantedAt: U().nowMs()
        });
        granted[m.source] = U().nowMs();
        fresh.push(c);
        try { B().emit("coupon:granted", { coupon: c }); } catch (e) {}
      }
    });
    if (fresh.length) {
      // 持久化 granted 标记（深合并，不覆盖其它）
      var prof = store().loadProfile();
      prof.granted = Object.assign({}, prof.granted, granted);
      store().saveProfile({ granted: prof.granted });
    }
    return fresh;
  }

  /** 多选叠加核销，无上限；逐券扣减，扣满写 usedAt。返回实际核销金额 */
  function use(ids, amount, note) {
    var list = store().loadRaw ? null : null; // 占位（见下）
    var all = RF.storage.getJSON(RF.storage.KEYS.COUPONS, []).map(function (c) { return RF.schema.defCoupon(c); });
    var pick = (ids || []).slice();
    var remain = amount, used = 0;
    var usedIds = [];
    for (var i = 0; i < all.length && remain > 0; i++) {
      var c = all[i];
      if (c.usedAt !== null) continue;
      if (pick.length && pick.indexOf(c.id) < 0) continue;
      var avail = c.amount - c.usedAmount;
      if (avail <= 0) continue;
      var take = Math.min(avail, remain);
      c.usedAmount += take;
      remain -= take;
      used += take;
      usedIds.push(c.id);
      if (c.usedAmount >= c.amount) c.usedAt = U().nowMs();
    }
    RF.storage.setJSON(RF.storage.KEYS.COUPONS, all);
    store().scheduleAutoSync("state");
    try { B().emit("coupon:used", { ids: usedIds, amount: used, note: note || "" }); } catch (e) {}
    return used;
  }

  function isTheft(amount) { return balance() < (amount || 0); }

  /** 吃一顿放纵餐；偷吃时扣双倍积分 + 心情大降 + 精灵吐槽 */
  function indulge(amount, note) {
    var amt = Number(amount) || 0;
    if (isTheft(amt)) {
      store().addPoints(-amt * 2, "偷吃惩罚");
      try { if (RF.pet) RF.pet.applyDelta({ mood: -20 }, "theft"); } catch (e) {}
      try { B().emit("coupon:theft", { amount: amt }); } catch (e) {}
      return { ok: false, used: 0, penalty: { points: amt * 2, mood: 20 } };
    }
    var used = use(null, amt, note);
    return { ok: true, used: used };
  }

  try {
    B().on("day:perfect", function (d) {
      try {
        var streak = (d && d.streak) || store().streakInfo().current;
        grant(streak);
      } catch (e) {}
    });
  } catch (e) {}

  RF.coupon = {
    RULES: RULES,
    get: get, listUnused: listUnused, balance: balance,
    grant: grant, use: use, isTheft: isTheft, indulge: indulge
  };
})(window.RF = window.RF || {});
