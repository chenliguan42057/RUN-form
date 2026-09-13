/**
 * PWA Service Worker 注册 · 阳光花园 v2
 *
 * 设计得很克制：
 *   · 只在安全上下文（HTTPS / localhost）尝试注册，file:// 直接跳过
 *   · 注册失败只在控制台打印，不弹窗打扰
 *   · 检测到新版本（updatefound + installed）→ 顶部横幅提示「有新版本，刷新看看」
 *   · controllerchange（新 SW 接管）→ 自动 reload **一次**，且跨 reload 去重
 *
 * 归属：地基（T01）。v1 只打 console.log，v2 补上用户可见的刷新横幅（§6.3 第 3 条）。
 *
 * ⚠️ 自动重载去重策略（防「反复自我刷新」）：
 *   仅用模块级 `reloading` 挡不住 —— reload 后脚本重新求值，标记就被重置为 false，
 *   于是「reload → controllerchange → reload → …」可能无限循环。
 *   这里追加 sessionStorage 层：sessionStorage 在同一标签页跨 reload 存活，
 *   一旦本会话已为接管自动 reload 过，后续所有 controllerchange 一律不再 reload。
 *   只做 reload（不写版本号锁定），因此下次真正的新版本接管时仍会自动刷新一次，
 *   既杜绝死循环，又不牺牲后续版本的无感升级。
 */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && !/^localhost$/i.test(location.hostname)) return;

  /** sessionStorage key：本次标签页会话是否已为 SW 接管自动 reload 过。 */
  var RELOAD_FLAG = "rf-sw-reloaded";

  /**
   * 读取「本会话已自动 reload 过」标记。
   * sessionStorage 在隐私模式/被禁用时会抛错，必须吞掉异常并保守地当作「已重载」
   * 处理？—— 不。这里返回 false 表示「未重载过」，让本次仍能完成一次跳转；
   * 而模块级 `reloading` 兜住同一页面生命周期内的重复，二者叠加已足够安全。
   * @return {boolean}
   */
  function hasReloadedThisSession() {
    try {
      return window.sessionStorage.getItem(RELOAD_FLAG) === "1";
    } catch (e) {
      return false;
    }
  }

  /** 标记「本会话已自动 reload 过」。写入失败静默（不影响注册流程）。 */
  function markReloadedThisSession() {
    try {
      window.sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch (e) {
      /* 隐私模式 / 存储被禁用：无法持久标记，退化为仅模块级保护 */
    }
  }

  /**
   * 插入「有新版本」横幅。
   * @param {ServiceWorkerRegistration} reg
   * @return {void}
   */
  function showUpdateBanner(reg) {
    if (document.getElementById("sw-update-banner")) return;
    var bar = document.createElement("div");
    bar.id = "sw-update-banner";
    bar.setAttribute("role", "status");
    bar.textContent = "花园长出新芽啦，刷新看看 ✨";
    bar.style.cssText =
      "position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:120;" +
      "padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.92);" +
      "color:#3a3a4a;font-size:13px;font-weight:600;cursor:pointer;" +
      "box-shadow:0 8px 24px rgba(58,58,74,.16);border:1px solid rgba(255,255,255,.9);";

    bar.addEventListener("click", function () {
      var w = reg.waiting || reg.installing;
      if (w) w.postMessage({ type: "SKIP_WAITING" });
      bar.textContent = "正在刷新…";
      window.setTimeout(function () {
        window.location.reload();
      }, 300);
    });

    document.body.appendChild(bar);
  }

  navigator.serviceWorker
    .register("sw.js", { scope: "/RUN-form/" })
    .then(function (reg) {
      if (window.console && console.log) console.log("[SW] 已注册，scope:", reg.scope);

      // 已有新版本在等待 → 立刻提示
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);

      reg.addEventListener("updatefound", function () {
        var worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", function () {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            if (window.console && console.log) console.log("[SW] 新版已就绪");
            showUpdateBanner(reg);
          }
        });
      });

      // 新 SW 接管后自动重载一次，避免用户看到「半新半旧」的混合状态。
      // 双重去重：
      //   ① 模块级 reloading —— 挡住**同一次页面生命周期内**的重复 controllerchange；
      //   ② sessionStorage 标记 —— 跨 reload 存活，挡住**新页面加载后**再次自动 reload，
      //      从根上消灭「reload ↔ controllerchange」无限自我刷新循环。
      var reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (reloading) return; // ① 同一页面生命周期内只放行一次
        if (hasReloadedThisSession()) {
          if (window.console && console.log) console.log("[SW] 本会话已完成接管重载，跳过重复刷新");
          return; // ② 跨 reload 锁：本会话已刷过一次，不再刷
        }
        reloading = true;
        markReloadedThisSession(); // 必须在 reload 之前落盘，否则新页面读不到
        window.location.reload();
      });
    })
    .catch(function (err) {
      if (window.console && console.warn) console.warn("[SW] 注册失败：", err);
    });
})();
