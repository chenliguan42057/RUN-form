/**
 * js/core/boot.js —— 统一引导脚本（消除 4 个 HTML 重复的加载序）
 * 设计文档 §8.2 加载红线：util→bus→storage→content→schema→store→
 * systems(pet,garden,coupon,punishment,rpg,countdown,habits)→
 * ui(scene,fx,components)→pages(<page>)，最后调用 RF.pages.<page>.init()。
 * 通过 document.write 按序注入，保证与原来逐行 <script> 完全一致的执行顺序。
 */
(function () {
  "use strict";
  var PAGE = { "index.html": "home", "manage.html": "manage", "shop.html": "shop", "stats.html": "stats" };
  var file = (location.pathname.split("/").pop()) || "index.html";
  var page = PAGE[file] || "home";
  var MODULES = [
    "register-sw.js",
    "js/core/util.js", "js/core/bus.js", "js/core/storage.js", "js/core/content.js",
    "js/data/schema.js", "js/data/store.js",
    "js/systems/pet.js", "js/systems/garden.js", "js/systems/coupon.js",
    "js/systems/punishment.js", "js/systems/rpg.js", "js/systems/countdown.js", "js/systems/habits.js",
    "js/ui/scene.js", "js/ui/fx.js", "js/ui/components.js",
    "js/pages/" + page + ".js"
  ];
  var i;
  for (i = 0; i < MODULES.length; i++) {
    document.write('<script src="' + MODULES[i] + '"><\/script>');
  }
  document.write('<script>RF.pages.' + page + '.init();<\/script>');
})();
