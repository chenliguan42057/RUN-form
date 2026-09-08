/**
 * js/pages/shop.js —— 花园市集（shop.html）
 * 归属：C 组（T04）。导出 RF.pages.shop.init()。
 *
 * 内容：藤编篮库存（多选叠加核销）、放纵餐登记、偷吃惩罚、积分商店换道具。
 * 所有用户数据进 innerHTML 前过 RF.util.esc()。
 */
(function (RF) {
  "use strict";

  function U() { return RF.util; }
  function S() { return RF.store; }

  var selected = {}; // couponId -> true

  var SHOP_ITEMS = RF.content.get("shop.items", [
    { key: "timeDew", name: "时光露水", emoji: "💧", cost: 300, desc: "唤醒沉睡/ faded 的小光" },
    { key: "memoryFlower", name: "回忆之花", emoji: "🌸", cost: 800, desc: "召回已离开的小光（亲密度保留）" },
    { key: "doubleHappy", name: "双倍开心", emoji: "✨", cost: 200, desc: "下次打卡积分翻倍" }
  ]);

  function $(id) { return document.getElementById(id); }

  function init() {
    try { S().init(); } catch (e) {}
    try { if (RF.scene) RF.scene.init(); } catch (e) {}
    try {
      if (RF.scene && RF.scene.setReduceMotion) {
        var p = S().loadProfile();
        RF.scene.setReduceMotion(!!(p.settings && p.settings.reduceMotion));
      }
    } catch (e) {}

    markActiveNav();
    selected = {};
    renderBasket();
    renderShopGrid();
    bindIndulge();
    bindSelectAll();
  }

  function markActiveNav() {
    try {
      var here = location.pathname.split("/").pop() || "shop.html";
      var links = document.querySelectorAll(".g-nav__link");
      for (var i = 0; i < links.length; i++) {
        if ((links[i].getAttribute("href") || "").indexOf(here) >= 0) links[i].classList.add("g-nav__link--active");
      }
    } catch (e) {}
  }

  function renderBalance() {
    var el = $("balance");
    if (!el) return;
    try { el.textContent = "¥" + RF.coupon.balance(); } catch (e) {}
    var pts = $("points");
    if (pts) { try { pts.textContent = String(S().loadProfile().points || 0); } catch (e) {} }
  }

  function renderBasket() {
    var box = $("basket-list");
    var empty = $("basket-empty");
    if (!box) return;
    var coupons = [];
    try { coupons = RF.coupon.listUnused(); } catch (e) {}
    renderBalance();
    if (!coupons.length) {
      if (empty) empty.hidden = false;
      box.innerHTML = "";
      updateTheftHint(0);
      return;
    }
    if (empty) empty.hidden = true;
    var html = "";
    for (var i = 0; i < coupons.length; i++) {
      var c = coupons[i];
      var sel = selected[c.id] ? " is-sel" : "";
      html += '<label class="g-basket-item' + sel + '">' +
        '<input type="checkbox" class="g-basket-item__chk" data-coupon="' + U().esc(c.id) + '"' + (selected[c.id] ? " checked" : "") + ">" +
        RF.ui.couponBasket(c) +
        "</label>";
    }
    box.innerHTML = html;
    // 绑定选择
    var chks = box.querySelectorAll("[data-coupon]");
    for (var j = 0; j < chks.length; j++) {
      chks[j].addEventListener("change", function (ev) {
        var id = ev.target.getAttribute("data-coupon");
        if (ev.target.checked) selected[id] = true; else delete selected[id];
        var lbl = ev.target.closest ? ev.target.closest(".g-basket-item") : null;
        if (lbl) lbl.classList.toggle("is-sel", ev.target.checked);
      });
    }
    updateTheftHint(0);
  }

  function bindSelectAll() {
    var btn = $("select-all-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var chks = document.querySelectorAll("#basket-list [data-coupon]");
      var allOn = chks.length > 0;
      for (var i = 0; i < chks.length; i++) {
        if (!chks[i].checked) { allOn = false; break; }
      }
      for (var j = 0; j < chks.length; j++) {
        chks[j].checked = !allOn;
        var id = chks[j].getAttribute("data-coupon");
        if (!allOn) selected[id] = true; else delete selected[id];
        var lbl = chks[j].closest ? chks[j].closest(".g-basket-item") : null;
        if (lbl) lbl.classList.toggle("is-sel", !allOn);
      }
    });
  }

  function selectedIds() {
    return Object.keys(selected);
  }

  function updateTheftHint(amount) {
    var el = $("theft-hint");
    if (!el) return;
    if (amount > 0) {
      el.hidden = false;
      el.textContent = "余额不足将按「偷吃」扣双倍积分 + 小光心情 -20";
    } else {
      el.hidden = true;
    }
  }

  function bindIndulge() {
    var form = $("indulge-form");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var amt = parseInt($("indulge-amount").value, 10) || 0;
      var note = $("indulge-note") ? $("indulge-note").value.trim() : "";
      if (amt <= 0) { if (RF.fx) RF.fx.toast("请输入金额", "warning"); return; }
      try {
        var r = RF.coupon.indulge(amt, note);
        if (r.ok) {
          if (RF.fx) { RF.fx.toast("吃好喝好！核销 ¥" + r.used, "success"); RF.fx.sound("cheer"); }
        } else {
          if (RF.fx) RF.fx.toast("偷吃被抓！已加倍扣回 ¥" + (r.penalty ? r.penalty.points : amt * 2), "error");
        }
      } catch (e) { if (RF.fx) RF.fx.toast("操作失败", "error"); }
      if ($("indulge-amount")) $("indulge-amount").value = "";
      renderBasket();
    });
    var amtEl = $("indulge-amount");
    if (amtEl) amtEl.addEventListener("input", function () { updateTheftHint(parseInt(amtEl.value, 10) || 0); });
  }

  function renderShopGrid() {
    var grid = $("shop-grid");
    if (!grid) return;
    var prof = S().loadProfile();
    var inv = (prof.inventory && prof.inventory.props) || {};
    var html = "";
    for (var i = 0; i < SHOP_ITEMS.length; i++) {
      var it = SHOP_ITEMS[i];
      var owned = inv[it.key] || 0;
      html += '<div class="g-shop-item">' +
        '<div class="g-shop-item__emoji" aria-hidden="true">' + it.emoji + "</div>" +
        '<div class="g-shop-item__name">' + U().esc(it.name) + "</div>" +
        '<div class="g-shop-item__desc">' + U().esc(it.desc) + "</div>" +
        '<div class="g-shop-item__own">已有 ' + owned + " 个</div>" +
        '<button type="button" class="g-btn g-btn--primary g-shop-item__buy" data-buy="' + it.key + '">¥' + it.cost + " 兑换</button>" +
        "</div>";
    }
    grid.innerHTML = html;
    var buys = grid.querySelectorAll("[data-buy]");
    for (var j = 0; j < buys.length; j++) {
      buys[j].addEventListener("click", function (ev) {
        buyItem(ev.target.getAttribute("data-buy"));
      });
    }
  }

  function buyItem(key) {
    var item = null;
    for (var i = 0; i < SHOP_ITEMS.length; i++) if (SHOP_ITEMS[i].key === key) { item = SHOP_ITEMS[i]; break; }
    if (!item) return;
    var prof = S().loadProfile();
    if ((prof.points || 0) < item.cost) {
      if (RF.fx) RF.fx.toast("积分不够，先去打卡攒分～", "warning");
      return;
    }
    try {
      S().addPoints(-item.cost, "兑换道具");
      var inv = Object.assign({}, (prof.inventory && prof.inventory.props) || {}, {});
      inv[key] = (inv[key] || 0) + 1;
      S().saveProfile({ inventory: { props: inv } });
      if (RF.fx) { RF.fx.toast("兑换成功：" + item.name, "success"); RF.fx.sound("bloom"); }
    } catch (e) { if (RF.fx) RF.fx.toast("兑换失败", "error"); }
    renderShopGrid();
    renderBalance();
  }

  RF.pages = RF.pages || {};
  RF.pages.shop = { init: init };
})(window.RF = window.RF || {});
