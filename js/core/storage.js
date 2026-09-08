/**
 * js/core/storage.js —— localStorage 安全读写层（L1）
 *
 * 三条铁律：
 *   1. 键名统一前缀 runform_（沿用 v1，保证老用户数据不丢，见设计文档 §4.1）。
 *   2. 任何读取失败 / JSON 损坏都**降级为默认值**，绝不抛异常、绝不白屏。
 *   3. 配额超限（QuotaExceededError）时降级：先丢可重建的缓存键重试一次，仍失败返回 false。
 *
 * 注意：runform_pat 只在本机读写，**任何情况下都不随同步 payload 出网**（红线 §8.5）。
 *
 * 归属：地基（T01，已实现）。接口签名见设计文档 §3.1 的 Storage 类。
 */
(function (RF) {
  "use strict";

  var PREFIX = "runform_";

  /** localStorage 键总表（设计文档 §4.1）。业务层一律用 KEYS.xxx，不要手写字符串。 */
  var KEYS = {
    PLANS: PREFIX + "plans",
    CHECKINS: PREFIX + "checkins",
    TOMBSTONES: PREFIX + "tombstones",
    PET: PREFIX + "pet",
    GARDEN: PREFIX + "garden",
    COUPONS: PREFIX + "coupons",
    PROFILE: PREFIX + "profile",
    HABITS: PREFIX + "habits",
    PREFS: PREFIX + "prefs",
    PAT: PREFIX + "pat",
    PROXY_URL: PREFIX + "proxy_url",
    LAST_SYNC: PREFIX + "last_sync",
    FX: PREFIX + "fx",
    SCHEMA: PREFIX + "schema"
  };

  /** 配额不足时可安全丢弃的键（丢了能重建，不影响用户资产）。 */
  var DROPPABLE = [KEYS.LAST_SYNC, KEYS.HABITS, KEYS.PREFS];

  /** @return {boolean} localStorage 是否可用（隐私模式 / file:// 下可能为 false） */
  function available() {
    try {
      var k = PREFIX + "__probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 读字符串。
   * @param {string} key
   * @param {string=} fallback
   * @return {string}
   */
  function getRaw(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? (fallback === undefined ? "" : fallback) : v;
    } catch (e) {
      return fallback === undefined ? "" : fallback;
    }
  }

  /**
   * 写字符串。
   * @param {string} key
   * @param {string} val
   * @return {boolean} 是否写入成功
   */
  function setRaw(key, val) {
    try {
      window.localStorage.setItem(key, val);
      return true;
    } catch (e) {
      // 配额超限：丢掉可重建的缓存键后重试一次
      for (var i = 0; i < DROPPABLE.length; i++) {
        if (DROPPABLE[i] === key) continue;
        try { window.localStorage.removeItem(DROPPABLE[i]); } catch (e2) { /* 忽略 */ }
      }
      try {
        window.localStorage.setItem(key, val);
        return true;
      } catch (e3) {
        return false;
      }
    }
  }

  /**
   * 读 JSON；解析失败或类型不符一律返回 fallback。
   * @param {string} key
   * @param {*} fallback 默认值（强烈建议必传）
   * @return {*}
   */
  function getJSON(key, fallback) {
    var raw = getRaw(key, "");
    if (raw === "") return fallback;
    try {
      var val = JSON.parse(raw);
      return val === null || val === undefined ? fallback : val;
    } catch (e) {
      return fallback;
    }
  }

  /**
   * 写 JSON；序列化失败返回 false（例如循环引用）。
   * @param {string} key
   * @param {*} val
   * @return {boolean}
   */
  function setJSON(key, val) {
    try {
      return setRaw(key, JSON.stringify(val));
    } catch (e) {
      return false;
    }
  }

  /**
   * 删除键。
   * @param {string} key
   * @return {void}
   */
  function remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      /* 忽略 */
    }
  }

  /**
   * 列出本站所有 runform_ 键（调试 / 迁移用）。
   * @return {Array<string>}
   */
  function listKeys() {
    try {
      var out = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) out.push(k);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  /**
   * 估算某个键占用的字符数（配额诊断用）。
   * @param {string} key
   * @return {number}
   */
  function sizeOf(key) {
    return getRaw(key, "").length;
  }

  RF.storage = {
    PREFIX: PREFIX,
    KEYS: KEYS,
    available: available,
    getRaw: getRaw,
    setRaw: setRaw,
    getJSON: getJSON,
    setJSON: setJSON,
    remove: remove,
    listKeys: listKeys,
    sizeOf: sizeOf
  };
})(window.RF = window.RF || {});
