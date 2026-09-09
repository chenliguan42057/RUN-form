/**
 * js/core/bus.js —— 事件总线（L1，无业务依赖）
 *
 * 存在的唯一理由：systems/ 下七个模块之间**禁止直接调用**，一切联动走事件。
 * 这样 A/B/C/D 四组可以完全并行，互不 import 对方文件。
 *
 * 事件名已冻结（设计文档 §8.7），一个字都不能改。EVENTS 采用「键=值」自映射，
 * 因此 Object.keys(RF.bus.EVENTS) 就是完整的冻结清单，避免两处字符串不同步。
 *
 * 归属：地基（T01，已实现）。接口签名见设计文档 §5.2。
 */
(function (RF) {
  "use strict";

  /**
   * 冻结的事件名清单。
   * · §8.7 表格（含载荷定义）的 14 个全部在列；
   * · §5.2 常量清单另有 pet:speak / pet:stateChange / coupon:used / event:rolled 四个，
   *   同样在列（并集 = 18 个）。缺了它们 C 组的 coupon 核销与 B 组的精灵气泡无法发事件。
   * · 另有 4 个扩展事件 pet:applyDelta / pet:revive / scene:weather / day:reset，
   *   为本轮内部解耦（system→system / system→UI 改走 bus）而追加；18 个基线事件保持冻结不变。
   * @type {Object<string,string>}
   */
  var EVENTS = {
    "checkin:done": "checkin:done",
    "checkin:undo": "checkin:undo",
    "day:perfect": "day:perfect",
    "day:missed": "day:missed",
    "pet:stageUp": "pet:stageUp",
    "pet:speak": "pet:speak",
    "pet:stateChange": "pet:stateChange",
    "garden:bloom": "garden:bloom",
    "garden:wither": "garden:wither",
    "coupon:granted": "coupon:granted",
    "coupon:used": "coupon:used",
    "coupon:theft": "coupon:theft",
    "rank:up": "rank:up",
    "achievement:unlocked": "achievement:unlocked",
    "event:rolled": "event:rolled",
    "scene:periodChange": "scene:periodChange",
    "pet:applyDelta": "pet:applyDelta",
    "pet:revive": "pet:revive",
    "scene:weather": "scene:weather",
    "day:reset": "day:reset",
    "sync:ok": "sync:ok",
    "sync:fail": "sync:fail"
  };

  /** 冻结名列表（只读，供自检与文档生成）。 @type {Array<string>} */
  var EVENT_NAMES = Object.freeze(Object.keys(EVENTS));

  /** @type {Object<string, Array<Function>>} */
  var channels = {};

  /**
   * 订阅事件。
   * @param {string} name 建议用 RF.bus.EVENTS.xxx
   * @param {Function} fn 收到 (payload)
   * @return {void}
   */
  function on(name, fn) {
    if (typeof name !== "string" || typeof fn !== "function") return;
    if (!channels[name]) channels[name] = [];
    if (channels[name].indexOf(fn) === -1) channels[name].push(fn);
  }

  /**
   * 取消订阅；不传 fn 则清空该事件。
   * @param {string} name
   * @param {Function=} fn
   * @return {void}
   */
  function off(name, fn) {
    if (!channels[name]) return;
    if (typeof fn !== "function") {
      channels[name] = [];
      return;
    }
    channels[name] = channels[name].filter(function (f) {
      return f !== fn;
    });
  }

  /**
   * 发布事件。单个订阅者抛错**不影响**其余订阅者（隔离性红线）。
   * @param {string} name
   * @param {*} payload
   * @return {void}
   */
  function emit(name, payload) {
    var list = channels[name];
    if (!list || !list.length) return;
    list.slice().forEach(function (fn) {
      try {
        fn(payload);
      } catch (e) {
        if (window.console && console.error) {
          console.error("[bus] 订阅者执行失败：" + name, e);
        }
      }
    });
  }

  /** @return {Object<string,number>} 各事件的订阅数，调试用 */
  function stats() {
    var out = {};
    Object.keys(channels).forEach(function (k) {
      out[k] = channels[k].length;
    });
    return out;
  }

  RF.bus = {
    EVENTS: EVENTS,
    EVENT_NAMES: EVENT_NAMES,
    on: on,
    off: off,
    emit: emit,
    stats: stats
  };
})(window.RF = window.RF || {});
