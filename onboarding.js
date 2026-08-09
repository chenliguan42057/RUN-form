/**
 * 星河契约 · 缔约引导（onboarding.js，v6 · L3 交互层）
 *
 * 职责：首次进站时，把「注册一个打卡账号」变成「和自己签一份契约」。
 *   三步：看见星空 → 读誓词 → 按下签约（拿到自己的编号 #A1B2）
 *
 * 为什么值得做：这是整个产品唯一一次「你还没有任何数据」的时刻，
 * 也是唯一一次能建立仪式感的机会。签完之后，这个编号会一直跟着他。
 *
 * 硬约束：
 *   · 签约按钮是**真实用户手势**，必须在这里调 Sensory.unlock() 解锁音频——
 *     整站唯一保证能拿到手势的时机，错过就得等用户下一次点击。
 *   · 「跳过」永远可用。不想签的人也得能进站，不能拿仪式感绑架用户。
 *   · 编号用 hashString(uuid + ts) 派生，同一台设备重签会得到不同编号（本来就是新契约）。
 *
 * 依赖：store.js 的 hashString / genId / escapeHtml；components.js 的 uiOathStep；sensory.js
 * ⚠️ 本文件禁止声明 `$`。
 */
(function (g) {
  "use strict";

  /** 誓词版本。改动誓词内容时 +1，用于日后识别「签的是哪一版」 */
  var OATH_VER = 1;

  /** 当前打开的浮层节点 */
  var panel = null;
  /** 当前步骤索引 */
  var step = 0;

  /** 三步引导的文案 */
  var STEPS = [
    {
      icon: "🌌",
      title: "这里没有排行榜",
      body:
        "没有好友动态，没有连胜播报，没有人看着你。\n" +
        "所有数据只躺在这台设备的浏览器里，关掉页面它也不会去任何地方。",
      next: "继续",
    },
    {
      icon: "✦",
      title: "每个计划，是一颗星",
      body:
        "点亮一次，它就亮一点；断了，它会暗下去，但不会消失。\n" +
        "星图不会替你评判什么，它只是把你走过的路画出来。",
      next: "继续",
    },
    {
      icon: "🖋",
      title: "星河契约",
      body:
        "我知道我会有做不到的日子。\n" +
        "我不为那些日子道歉，也不用它们否定其余的日子。\n" +
        "我只承诺一件事：断了之后，我会回来。",
      next: "签下契约",
      isOath: true,
    },
  ];

  /**
   * 读契约。
   * @returns {{signed:boolean, id:string, date:string, ts:number, oathVer:number}}
   */
  function contract() {
    try {
      var raw = localStorage.getItem("runform_contract");
      var c = raw ? JSON.parse(raw) : null;
      if (c && typeof c === "object" && c.signed === true) {
        return {
          signed: true,
          id: String(c.id || ""),
          date: String(c.date || ""),
          ts: Number(c.ts) || 0,
          oathVer: Number(c.oathVer) || 1,
        };
      }
    } catch (e) {
      /* 读不到就当没签 */
    }
    return { signed: false, id: "", date: "", ts: 0, oathVer: OATH_VER };
  }

  /**
   * 是否需要弹引导。
   * 已签 / 已跳过都不再弹——只在真正的第一次出现。
   * @returns {boolean}
   */
  function needed() {
    var c = contract();
    if (c.signed) return false;
    try {
      // 跳过也记一笔，否则每次刷新都弹，比不做还烦人
      return localStorage.getItem("runform_contract") === null;
    } catch (e) {
      return false;
    }
  }

  /**
   * 生成契约编号：'#' + djb2(uuid + ts) 的 36 进制后 4 位，大写。
   * 用 store.js 现成的 hashString（djb2），不另造轮子。
   * @returns {string} 形如 "#A1B2"
   */
  function makeId() {
    var uuid = typeof g.genId === "function" ? g.genId() : String(Math.random());
    var seed = uuid + ":" + Date.now();
    var h = typeof g.hashString === "function" ? g.hashString(seed) : Math.abs(seed.length * 7919);
    var tail = h.toString(36).slice(-4).toUpperCase();
    // 哈希太小时补位，保证编号恒为 4 位，视觉上整齐
    while (tail.length < 4) tail = "0" + tail;
    return "#" + tail;
  }

  /**
   * 签约。
   * @param {{silent?:boolean}} [opts] silent=true 表示用户勾了「保持安静」
   * @returns {Object} 契约对象
   */
  function sign(opts) {
    var o = opts && typeof opts === "object" ? opts : {};
    var now = new Date();
    var c = {
      signed: true,
      id: makeId(),
      date:
        now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0"),
      ts: now.getTime(),
      oathVer: OATH_VER,
    };
    try {
      localStorage.setItem("runform_contract", JSON.stringify(c));
    } catch (e) {
      console.error("写入契约失败：", e);
    }

    // 静默开关必须在这里落地：用户在签约页勾的，就得从签约那一刻生效
    if (g.Sensory) g.Sensory.setSilent(o.silent === true);
    return c;
  }

  /**
   * 记下「跳过」，避免反复弹窗。
   * @returns {void}
   */
  function markSkipped() {
    try {
      localStorage.setItem(
        "runform_contract",
        JSON.stringify({ signed: false, skipped: true, ts: Date.now(), oathVer: OATH_VER })
      );
    } catch (e) {
      console.error("记录跳过状态失败：", e);
    }
  }

  /**
   * 渲染当前步骤。
   * @returns {void}
   */
  function paint() {
    if (!panel) return;
    var s = STEPS[step];
    var body = panel.querySelector(".oath-slot");
    if (!body) return;
    body.innerHTML = g.uiOathStep(
      Object.assign({}, s, { index: step, total: STEPS.length })
    );
  }

  /**
   * 关闭浮层并解锁滚动。
   * @returns {void}
   */
  function close() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    document.body.style.overflow = "";
  }

  /**
   * 打开引导浮层。
   * @returns {boolean} 是否成功打开
   */
  function open() {
    if (panel) return true;
    var root = document.getElementById("overlay-root");
    if (!root || typeof g.uiOathStep !== "function") return false;

    step = 0;
    panel = document.createElement("div");
    panel.className = "oath-overlay";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "星河契约引导");
    panel.innerHTML =
      '<div class="oath-veil"></div>' +
      '<div class="oath-panel"><div class="oath-slot"></div></div>';
    root.appendChild(panel);
    document.body.style.overflow = "hidden";
    paint();

    panel.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-oath]");
      if (!btn) return;
      var act = btn.getAttribute("data-oath");

      if (act === "skip") {
        markSkipped();
        close();
        return;
      }
      if (act === "next") {
        step = Math.min(step + 1, STEPS.length - 1);
        paint();
        return;
      }
      if (act === "sign") {
        // ⚠️ 这里是整站唯一保证拿得到用户手势的时机，音频解锁必须发生在这一行
        if (g.Sensory) g.Sensory.unlock();

        var silentBox = panel.querySelector("#oath-silent");
        var wantSilent = Boolean(silentBox && silentBox.checked);
        var c = sign({ silent: wantSilent });

        if (!wantSilent && g.Sensory) {
          g.Sensory.playChime("oath");
          g.Sensory.vibrate([40, 70, 40]);
          var r = panel.getBoundingClientRect();
          g.Sensory.fullBurst({ count: 120 });
          void r;
        }

        // 换成「已签署」终屏，展示编号，2.4 秒后自动退场
        var body = panel.querySelector(".oath-slot");
        if (body) {
          body.innerHTML = g.uiOathStep({
            icon: "✷",
            title: "契约已缔结",
            body: "编号 " + c.id + "\n" + c.date + "\n\n这个编号只属于你，不会上传到任何地方。",
            signed: true,
            index: STEPS.length - 1,
            total: STEPS.length,
          });
        }
        g.setTimeout(close, 2600);
      }
    });

    // Esc 等同跳过：任何浮层都必须能用键盘逃出去
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        markSkipped();
        close();
      }
    });
    var first = panel.querySelector("[data-oath]");
    if (first && typeof first.focus === "function") first.focus();
    return true;
  }

  g.Onboarding = {
    OATH_VER: OATH_VER,
    needed: needed,
    open: open,
    close: close,
    sign: sign,
    contract: contract,
  };
})(window);
