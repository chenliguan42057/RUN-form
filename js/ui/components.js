/**
 * js/ui/components.js —— 卡片 / 进度条 / 弹窗 / 图标选择器 / 藤编篮（字符串模板工厂）
 *
 * 归属：B 组（T03）。签名冻结（设计文档 §5.13）。
 *
 * 约定：
 *   · 除 modal() 外，其余函数**返回 HTML 字符串**，由调用方插入 DOM。
 *   · **所有用户数据必须先过 RF.util.esc()** 再拼进字符串（红线 §8.5 第 3 条）。
 *   · 类名用 BEM-lite + g- 前缀（.g-card__title--rainbow，见 §8.1）。
 *   · 藤编篮用 inline SVG，不引入任何图片资源。
 */
(function (RF) {
  "use strict";

  var E = function (s) { return RF.util.esc(s); };

  /**
   * 通用卡片。
   * @param {{title:string, icon:string, sub?:string, right?:string, body:string, klass?:string}} opts
   * @return {string} HTML
   */
  function card(opts) {
    opts = opts || {};
    var cls = "g-card" + (opts.klass ? " " + opts.klass : "");
    var head =
      '<div class="g-card__head">' +
        '<span class="g-card__icon" aria-hidden="true">' + E(opts.icon || "🌿") + "</span>" +
        '<div class="g-card__titles">' +
          '<h3 class="g-card__title u-title">' + E(opts.title || "") + "</h3>" +
          (opts.sub ? '<p class="g-card__sub">' + E(opts.sub) + "</p>" : "") +
        "</div>" +
        (opts.right ? '<div class="g-card__right">' + opts.right + "</div>" : "") +
      "</div>";
    return '<section class="' + cls + '">' + head +
      '<div class="g-card__body">' + (opts.body || "") + "</div></section>";
  }

  /**
   * 进度条 / 状态条（精灵四项状态与任务进度共用）。
   * 仅动 transform（scaleX）与 opacity，不碰 width/top/box-shadow。
   * @param {{value:number, max:number, color:string, emoji:string, showNum?:boolean}} opts
   * @return {string} HTML
   */
  function progressBar(opts) {
    opts = opts || {};
    var max = Number(opts.max) || 100;
    var val = RF.util.clamp(Number(opts.value) || 0, 0, max);
    var ratio = max > 0 ? val / max : 0;
    var color = opts.color || "var(--g-sky)";
    var num = opts.showNum
      ? '<span class="g-bar__num u-num">' + E(Math.round(val)) + "<span class=\"g-bar__max\">/" + E(Math.round(max)) + "</span></span>"
      : "";
    return (
      '<div class="g-bar" style="--bar-color:' + E(color) + '">' +
        (opts.emoji ? '<span class="g-bar__emoji" aria-hidden="true">' + E(opts.emoji) + "</span>" : "") +
        '<div class="g-bar__track">' +
          '<div class="g-bar__fill" style="transform:scaleX(' + ratio.toFixed(4) + ')"></div>' +
        "</div>" +
        num +
      "</div>"
    );
  }

  /* ---------------- 弹窗（插到 #overlay-root） ---------------- */
  function modal(opts) {
    opts = opts || {};
    var root = document.getElementById("overlay-root");
    if (!root) return;

    var overlay = document.createElement("div");
    overlay.className = "g-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", E(opts.title || "提示"));

    var okText = opts.okText || "好的";
    var cancelText = opts.cancelText;

    overlay.innerHTML =
      '<div class="g-modal">' +
        '<h3 class="g-modal__title u-title">' + E(opts.title || "提示") + "</h3>" +
        '<div class="g-modal__body">' + (opts.body || "") + "</div>" +
        '<div class="g-modal__actions">' +
          (cancelText ? '<button type="button" class="g-btn g-btn--ghost" data-act="cancel">' + E(cancelText) + "</button>" : "") +
          '<button type="button" class="g-btn g-btn--primary" data-act="ok">' + E(okText) + "</button>" +
        "</div>" +
      "</div>";

    root.appendChild(overlay);

    function close() {
      document.removeEventListener("keydown", onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); close(); }
      else if (ev.key === "Tab") {
        // 焦点陷阱
        var f = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    }

    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) close();
      var act = ev.target.getAttribute && ev.target.getAttribute("data-act");
      if (act === "cancel") close();
      if (act === "ok") {
        if (typeof opts.onOk === "function") { try { opts.onOk(); } catch (e) {} }
        close();
      }
    });

    document.addEventListener("keydown", onKey, true);
    // 聚焦首个可聚焦元素
    var focusable = overlay.querySelector("button, [href], input, select, textarea");
    if (focusable) focusable.focus();
    // 触发进入过渡
    void overlay.offsetWidth;
    overlay.classList.add("is-open");
  }

  /* ---------------- 图标选择器（garden 向 emoji） ---------------- */
  var PICKERS = {};
  var delegated = false;
  var EMOJIS = ["🌸", "🌼", "🌺", "🌻", "🌷", "🌿", "🍀", "🌳", "💧", "☀️", "🌙", "⭐",
    "🌈", "🐝", "🦋", "🐢", "🐱", "🐶", "🍎", "📚", "🏃", "✍️", "💪", "🎵", "🧘", "🌟", "💡", "🍵", "🛌", "🥗"];

  function ensurePickerDelegate() {
    if (delegated) return;
    delegated = true;
    document.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-emoji]") : null;
      if (!btn) return;
      var pid = btn.getAttribute("data-picker");
      var em = btn.getAttribute("data-emoji");
      var wrap = btn.parentNode;
      if (wrap) {
        var sibs = wrap.querySelectorAll("[data-emoji]");
        for (var i = 0; i < sibs.length; i++) sibs[i].classList.remove("is-sel");
      }
      btn.classList.add("is-sel");
      var cb = PICKERS[pid];
      if (typeof cb === "function") { try { cb(em); } catch (e) {} }
    });
  }

  /**
   * emoji 图标选择器。
   * @param {{value:string, onChange:Function}} opts
   * @return {string} HTML
   */
  function iconPicker(opts) {
    opts = opts || {};
    ensurePickerDelegate();
    var id = "pk-" + RF.util.genId();
    PICKERS[id] = opts.onChange;
    var html = '<div class="g-picker" data-picker="' + E(id) + '">';
    for (var i = 0; i < EMOJIS.length; i++) {
      var em = EMOJIS[i];
      var sel = em === opts.value ? " is-sel" : "";
      html += '<button type="button" class="g-picker__item' + sel + '" data-emoji="' + em + '" aria-label="选择图标 ' + em + '">' + em + "</button>";
    }
    html += "</div>";
    return html;
  }

  /* ---------------- 藤编野餐篮（市集库存，inline SVG） ---------------- */
  /**
   * @param {Object} c Coupon {amount, source, expireAt, status?}
   * @return {string} HTML
   */
  function couponBasket(c) {
    c = c || {};
    var amt = Math.round(Number(c.amount) || 0);
    var used = c.status === "used" || c.used === true;
    var exp = "";
    if (c.expireAt) {
      try {
        var d = new Date(Number(c.expireAt));
        if (!isNaN(d.getTime())) {
          var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
          exp = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
        }
      } catch (e) { /* ignore */ }
    }
    var src = E(c.source || RF.content.get("ui.coupon.labels.defaultSource", "打卡奖励"));
    return (
      '<div class="g-basket' + (used ? " is-used" : "") + '">' +
        '<svg class="g-basket__svg" viewBox="0 0 64 56" width="56" height="48" aria-hidden="true">' +
          '<path d="M10 20 H54 L48 52 H16 Z" fill="#d9a566" stroke="#a9763b" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M14 20 Q32 8 50 20" fill="none" stroke="#a9763b" stroke-width="2.4" stroke-linecap="round"/>' +
          '<path d="M20 28 L24 50 M32 26 L32 52 M44 28 L40 50" stroke="#a9763b" stroke-width="1.4" opacity="0.7"/>' +
          '<path d="M10 20 H54" stroke="#8a5a2b" stroke-width="2.4" stroke-linecap="round"/>' +
        "</svg>" +
        '<div class="g-basket__info">' +
          '<span class="g-basket__amt">¥' + E(amt) + " " + RF.content.get("ui.coupon.unit", "野餐券") + "</span>" +
          '<span class="g-basket__src">' + RF.content.get("ui.coupon.labels.source", "来源：") + src + "</span>" +
          (exp ? '<span class="g-basket__exp">' + RF.content.get("ui.coupon.labels.expireAt", "有效期至 ") + exp + "</span>" : "") +
          (used ? '<span class="g-basket__tag">' + RF.content.get("ui.coupon.labels.used", "已核销") + "</span>" : "") +
        "</div>" +
      "</div>"
    );
  }

  /**
   * 按当前 pathname 末段高亮顶部导航（4 个页面共用，消除重复）。
   */
  function markActiveNav() {
    try {
      var seg = (location.pathname.split("/").pop() || "").replace(/\.html$/, "") || "index";
      var links = document.querySelectorAll("[data-nav]");
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute("href") || "";
        var key = href.split("/").pop().replace(/\.html$/, "") || "index";
        if (key === seg) links[i].classList.add("is-active");
        else links[i].classList.remove("is-active");
      }
    } catch (e) { /* ignore */ }
  }

  RF.ui = {
    card: card,
    progressBar: progressBar,
    modal: modal,
    iconPicker: iconPicker,
    couponBasket: couponBasket,
    markActiveNav: markActiveNav
  };
})(window.RF = window.RF || {});
