/**
 * PWA Service Worker 注册。
 *
 * 设计得很克制：
 *   · 只在 HTTPS / localhost / file 等安全上下文尝试注册
 *   · 注册失败只在控制台打印，不弹窗打扰
 *   · 监听 controllerchange，新 SW 激活后提示刷新（可选）
 */
(function () {
  if (!("serviceWorker" in navigator)) return;

  // GitHub Pages 是 https，本地 http://localhost 也允许注册；file:// 不允许
  if (!window.isSecureContext && !/^localhost$/i.test(location.hostname)) return;

  const scope = "/RUN-form/";
  navigator.serviceWorker
    .register("sw.js", { scope })
    .then((reg) => {
      console.log("[SW] 已注册，scope:", reg.scope);

      // 检测到新的 SW 已安装好但尚未激活时，提示用户刷新以应用新版
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[SW] 新版已就绪，刷新页面后生效");
          }
        });
      });
    })
    .catch((err) => {
      console.warn("[SW] 注册失败：", err);
    });
})();
