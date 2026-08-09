/**
 * shortcuts.js — C4 键盘快捷键 + PWA 下拉手势
 *
 * 主理人拍板：
 *  - 移动端下拉手势「只在 PWA standalone 模式」生效；
 *    普通浏览器里下拉是系统刷新，不抢，只保留键盘快捷键。
 *
 * 约定（白屏防御）：
 *  - 全文件 IIFE，只暴露 window.Shortcuts
 *  - 不声明顶层 const $
 *  - 输入框 / 文本域 / contenteditable 内一律不拦截按键
 */
(function (g) {
  "use strict";

  var bound = false;
  var handlers = {};
  var helpOpen = false;

  var KEYS = [
    { key: "C", act: "check", desc: "点亮下一颗星" },
    { key: "F", act: "focus", desc: "开始 / 暂停专注" },
    { key: "T", act: "theme", desc: "切换星空主题" },
    { key: "M", act: "silent", desc: "静默模式开关" },
    { key: "G", act: "goto", desc: "去星图 / 回天文台" },
    { key: "?", act: "help", desc: "显示这张快捷键表" },
    { key: "←", act: "planPrev", desc: "上一颗星（切计划）" },
    { key: "→", act: "planNext", desc: "下一颗星（切计划）" },
    { key: "Esc", act: "escape", desc: "关闭当前浮层" }
  ];

  /* ============================================================
   * 环境判断
   * ========================================================== */

  /** 是否处于 PWA 独立窗口（安装到桌面后打开） */
  function isStandalone() {
    try {
      if (g.navigator && g.navigator.standalone === true) return true;
      if (g.matchMedia && g.matchMedia("(display-mode: standalone)").matches) return true;
      if (g.matchMedia && g.matchMedia("(display-mode: fullscreen)").matches) return true;
    } catch (e) {
      return false;
    }
    return false;
  }

  /** 焦点是否在可输入元素里 */
  function inEditable(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function fire(act, ev) {
    var fn = handlers[act];
    if (typeof fn !== "function") return false;
    try {
      fn(ev);
    } catch (e) {
      /* 单个回调炸了不能连累整页 */
    }
    return true;
  }

  /* ============================================================
   * 快捷键帮助浮层
   * ========================================================== */

  function closeHelp() {
    var old = document.getElementById("shortcut-help");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    helpOpen = false;
  }

  function openHelp() {
    if (helpOpen) {
      closeHelp();
      return;
    }
    var root = document.getElementById("overlay-root") || document.body;
    var box = document.createElement("div");
    box.id = "shortcut-help";
    box.className = "sc-help";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "快捷键");

    var rows = "";
    for (var i = 0; i < KEYS.length; i++) {
      rows +=
        '<div class="sc-row"><kbd class="sc-key">' +
        KEYS[i].key +
        '</kbd><span class="sc-desc">' +
        KEYS[i].desc +
        "</span></div>";
    }
    var tail = isStandalone()
      ? '<p class="sc-tip">已装到桌面：在天文台顶部下拉可以直接点亮。</p>'
      : '<p class="sc-tip">把网站「添加到主屏幕」，下拉手势才会解锁。</p>';

    box.innerHTML =
      '<div class="sc-panel">' +
      '<div class="sc-head"><span>⌨️ 快捷键</span>' +
      '<button type="button" class="sc-close" id="sc-close" aria-label="关闭">✕</button></div>' +
      rows +
      tail +
      "</div>";

    root.appendChild(box);
    helpOpen = true;

    var btn = document.getElementById("sc-close");
    if (btn) btn.addEventListener("click", closeHelp);
    box.addEventListener("click", function (e) {
      if (e.target === box) closeHelp();
    });
  }

  /* ============================================================
   * 键盘
   * ========================================================== */

  function onKeydown(e) {
    if (!e) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (inEditable(e.target)) return;

    var k = e.key || "";

    if (k === "Escape") {
      if (helpOpen) {
        closeHelp();
        e.preventDefault();
        return;
      }
      fire("escape", e);
      return;
    }

    if (k === "?" || (k === "/" && e.shiftKey)) {
      openHelp();
      e.preventDefault();
      return;
    }

    if (k === "ArrowLeft") {
      if (fire("planPrev", e)) e.preventDefault();
      return;
    }
    if (k === "ArrowRight") {
      if (fire("planNext", e)) e.preventDefault();
      return;
    }

    var low = k.toLowerCase();
    var map = { c: "check", f: "focus", t: "theme", m: "silent", g: "goto" };
    var act = map[low];
    if (!act) return;

    if (fire(act, e)) e.preventDefault();
  }

  /* ============================================================
   * 下拉手势（仅 standalone）
   * ========================================================== */

  var THRESHOLD = 92; // 触发阈值 px
  var MAX_PULL = 150; // 视觉最大位移
  var touchY = 0;
  var pulling = false;
  var pullEl = null;

  function ensurePullEl() {
    if (pullEl && pullEl.parentNode) return pullEl;
    pullEl = document.createElement("div");
    pullEl.id = "pull-hint";
    pullEl.className = "pull-hint";
    pullEl.innerHTML = '<span class="pull-icon">✦</span><span class="pull-text">下拉点亮</span>';
    var root = document.getElementById("overlay-root") || document.body;
    root.appendChild(pullEl);
    return pullEl;
  }

  function setPull(dist) {
    var el = ensurePullEl();
    var d = Math.max(0, Math.min(MAX_PULL, dist));
    el.style.transform = "translateX(-50%) translateY(" + d + "px)";
    el.style.opacity = String(Math.min(1, d / THRESHOLD));
    if (d >= THRESHOLD) {
      el.classList.add("is-ready");
      var t = el.querySelector(".pull-text");
      if (t) t.textContent = "松手点亮";
    } else {
      el.classList.remove("is-ready");
      var t2 = el.querySelector(".pull-text");
      if (t2) t2.textContent = "下拉点亮";
    }
  }

  function resetPull() {
    if (!pullEl) return;
    pullEl.style.transform = "translateX(-50%) translateY(0)";
    pullEl.style.opacity = "0";
    pullEl.classList.remove("is-ready");
  }

  function onTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) return;
    var top = g.pageYOffset || document.documentElement.scrollTop || 0;
    if (top > 2) return;
    touchY = e.touches[0].clientY;
    pulling = true;
  }

  function onTouchMove(e) {
    if (!pulling || !e.touches || e.touches.length !== 1) return;
    var dy = e.touches[0].clientY - touchY;
    if (dy <= 0) {
      pulling = false;
      resetPull();
      return;
    }
    setPull(dy * 0.55);
    if (dy > 12 && e.cancelable) e.preventDefault();
  }

  function onTouchEnd(e) {
    if (!pulling) return;
    pulling = false;
    var el = pullEl;
    var ready = el && el.classList.contains("is-ready");
    resetPull();
    if (ready) {
      try {
        if (g.Sensory && g.Sensory.vibrate) g.Sensory.vibrate(14);
      } catch (err) {
        /* 忽略 */
      }
      fire("pull", e) || fire("check", e);
    }
  }

  /* ============================================================
   * 对外 API
   * ========================================================== */

  /**
   * 初始化。可重复调用（只绑定一次事件，后续只更新 handlers）。
   * @param {Object} h - { check, focus, theme, silent, goto, escape, pull, planPrev, planNext }
   */
  function init(h) {
    handlers = h || {};
    if (bound) return;
    bound = true;

    document.addEventListener("keydown", onKeydown, false);

    if (isStandalone()) {
      document.addEventListener("touchstart", onTouchStart, { passive: true });
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd, { passive: true });
      document.addEventListener("touchcancel", function () {
        pulling = false;
        resetPull();
      }, { passive: true });
      try {
        document.body.classList.add("is-standalone");
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  function destroy() {
    if (!bound) return;
    document.removeEventListener("keydown", onKeydown, false);
    bound = false;
    closeHelp();
  }

  g.Shortcuts = {
    KEYS: KEYS,
    isStandalone: isStandalone,
    init: init,
    destroy: destroy,
    openHelp: openHelp,
    closeHelp: closeHelp
  };
})(window);
