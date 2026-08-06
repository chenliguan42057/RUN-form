# 不按惯例 · 个人打卡站点（RUN-form）

一个挂在 GitHub Pages 上的极简个人打卡（check-in）网站。名字叫「不按惯例」——
先把基础框架搭好，后续你自己往里加功能（统计、多人、图表……）。

纯静态实现：**HTML / CSS / JS，无构建步骤**，所有数据默认存在浏览器本地（localStorage）。
背景是一幅梵高星空海洋风格的油画，白卡黑字保证可读性。

> 线上地址示例：https://chenliguan42057.github.io/RUN-form/

---

## 目录结构

```
RUN-form/
├── index.html                      # 首页：今日打卡（选计划 → 一键打卡 → 今日记录）
├── manage.html                     # 管理页：计划 CRUD / 全部台账 / 同步设置
├── styles.css                      # 样式（含油画背景 + 半透蒙版 + 梵高配色按钮）
├── store.js                        # 共享数据层：计划 / 台账 / 同步（两页都要先加载它）
├── app.js                          # 首页逻辑
├── app2.js                         # 管理页逻辑
├── data/
│   ├── plans.json                  # 同步上来的计划（钉钉提醒读这个文件）
│   └── checkins.json               # 同步上来的打卡台账
├── assets/
│   └── bg-vangogh-ocean.webp       # 背景油画
├── .github/
│   └── workflows/
│       ├── dingtalk-reminder.yml   # 每小时检查一次，推送到期计划的钉钉提醒
│       └── sync.yml                # 接收同步事件并写入 data/plans.json + data/checkins.json
└── README.md
```

---

## 页面分工（v2）

- **首页 `index.html`**：只关心「今天」。选一个计划 → 点「打卡」→ 下面列出今天打过的卡和打卡时间。
  底部「管理」按钮进入管理页。打卡内容 **就是计划名**，不再手写备注。
- **管理页 `manage.html`**：计划的增删改查、全部台账（单条删除 / 清空全部）、GitHub 同步设置。

---

## v2 计划与钉钉提醒

### 计划模型

每个计划是这样一条数据：

```jsonc
{
  "id": "…",           // 自动生成的唯一 id
  "name": "跑步",       // 计划名，也是打卡记录里显示的内容
  "freq": "daily",     // daily | weekly | monthly
  "time": "08:00",     // 提醒时间（北京时间，HH:MM）
  "day": 0,            // weekly：星期号 0~6（周一 = 0）；monthly：每月第几日 1~31；daily：忽略
  "enabled": true      // 关掉后既不出现在首页下拉框，也不会推提醒
}
```

### 每个计划各自的提醒时间

- 提醒时间跟着**计划**走，不再是全站一个写死的时间。
- `.github/workflows/dingtalk-reminder.yml` 用 **每小时整点** 的 cron（`0 * * * *`）跑一次，
  脚本内部把 UTC 换算成北京时间，只挑出「**本小时到期**」的计划推送：
  - `daily`：`time` 的小时数 == 当前小时 → 推
  - `weekly`：小时匹配 **且** 当前是 `day` 指定的星期 → 推
  - `monthly`：小时匹配 **且** 当前是 `day` 指定的日子 → 推
- 同一小时有多个计划到期时，合并成一条消息推送，不会刷屏。
- 本小时没有任何到期计划就直接跳过，不发消息（workflow 正常绿色结束）。
- ⚠️ 目前只精确到**小时**：`08:00` 和 `08:30` 都会在 08 点那次执行时被推送。

### ⚠️ 改完计划一定要点一次「同步到仓库」

提醒脚本**读的是仓库里的 `data/plans.json`，不是你浏览器里的 localStorage**。
所以：

> **新增 / 修改 / 删除计划后，去管理页点一次「同步到仓库」**（填了 Token 的话也会自动同步），
> 等 Actions 跑完把 `data/plans.json` 更新掉，提醒才会生效。

没同步过的计划，调度器根本看不见。

---

## 本地预览

任选一种方式：

1. **直接打开**：双击 `index.html` 用浏览器打开即可。
2. **起本地服务**（推荐，避免个别浏览器对本地文件的限制）：
   ```bash
   python -m http.server 8000
   # 然后浏览器访问 http://localhost:8000
   ```

---

## GitHub Pages 设置

1. 进入仓库 `chenliguan42057/RUN-form`。
2. 打开 **Settings → Pages**。
3. **Source** 选择 **Deploy from a branch** → 分支选 **`main`**，目录选 **`/ (root)`**。
4. 保存后稍等一两分钟，访问 `https://chenliguan42057.github.io/RUN-form/`。

---

## 设置 Secrets（用于钉钉提醒）

钉钉机器人需要「加签」方式，因此要配置两个 Secret：

1. 进入仓库 **Settings → Secrets and variables → Actions → New repository secret**。
2. 新建 `DINGTALK_WEBHOOK`，值填**完整的钉钉机器人 webhook URL**
   （形如 `https://oapi.dingtalk.com/robot/send?access_token=xxxx`）。
3. 再新建 `DINGTALK_SECRET`，值填钉钉机器人的**加签密钥**（以 `SEC` 开头的一串字符）。

> ⚠️ 这两个值只存在 GitHub Secrets 里，绝不会写进任何仓库文件。

调试时可以到仓库 **Actions → 钉钉打卡提醒 → Run workflow** 手动触发一次
（手动触发同样只推「当前这个小时到期」的计划，本小时没有就会打印「跳过推送」）。

---

## 同步到仓库的使用说明

1. 进入 **管理页 → 同步到 GitHub 仓库**，粘贴你的 **Personal Access Token**。
2. 填好之后就不用管了——**打卡 / 删除 / 清空 / 增删改计划都会自动同步**；
   也可以随时点 **同步到仓库** 手动触发一次。
3. 一次同步会把 **计划（plans）和台账（checkins）一起推上去**，
   分别覆盖写入 `data/plans.json` 与 `data/checkins.json`。

### Token 权限要求 / 401 排查

如果看到 **「同步失败（401）」**，按下面三条挨个确认：

| 检查项 | 说明 |
| ------ | ---- |
| ① Token 是否过期 | GitHub 的 PAT 有有效期，过期后必须重新生成 |
| ② Classic Token | 必须勾选 **`repo`** 这个大权限（只勾子项不够） |
| ③ Fine-grained Token | 需要在 **Account / Repository permissions** 里授予 **`Contents: read & write`**、**`Metadata: read`**，以及 **`Administration: read`**（⚠️ `repository_dispatch` 同步事件由 Administration 权限控制——只给 Contents 能推代码却推不了同步，会报 401）；并把本仓库加进 **Repository access** |

出现 **403** 通常是权限不足或触发太频繁，检查权限后稍等一会儿再试。

### Token 的存放（安全说明）

- Token 保存在**本机浏览器的 localStorage**，刷新页面、关闭标签页都不会丢，下次打开自动回填，
  不用每次重新粘贴。
- 它**只会通过 `Authorization` 请求头发给 GitHub**，不会写进任何文件、不会被提交、不会出现在日志里，
  也不会发给任何第三方。
- ⚠️ 正因为是持久保存，**请勿在公共 / 共享电脑上保存 Token**。想清除的话，在浏览器开发者工具的
  Application → Local Storage 里删掉 `runform_pat` 即可。

### 自动同步

- 触发时机：打卡、删除记录、清空全部、新增 / 修改 / 删除计划、切换计划启用状态。
- **防抖 800ms**：连续操作（比如一口气删好几条）只会在最后一次操作后合并成一次请求，不会刷屏。
- 自动同步是静默的：成功不打扰你，**只有失败才会弹错误 toast**。手动点按钮则成功 / 失败都有提示。
- 没填 Token 时自动同步会直接跳过，不会报错——纯本地用也完全没问题
  （但那样钉钉提醒就没有数据可读了）。

### 同步链路与覆盖语义

- 前端向 `https://api.github.com/repos/chenliguan42057/RUN-form/dispatches`
  发送 `repository_dispatch` 事件（`event_type: sync-checkins`，
  `client_payload` 里同时带 `plans` 与 `checkins`）。
- 仓库里的 `sync.yml` 收到事件后，把两份数据**全量覆盖写入** `data/plans.json`
  和 `data/checkins.json`，然后自动提交。
- ⚠️ **浏览器端是唯一真源，远端是它的镜像**：
  在页面上删掉一条，同步后仓库里那条也会消失；点「清空全部记录」，仓库里的
  `data/checkins.json` 会被写成空数组 `[]`。这不是 bug，是刻意设计——
  否则删除和清空永远同步不出去。**需要留底就先备份 `data/*.json`。**
- 换句话说：**远端不做累加**。如果你在两台设备上各自打卡，后同步的那台会覆盖掉先同步的内容。

---

## 数据迁移说明（v1 → v2）

v1 的打卡记录形如 `{id, ts, content}`，没有计划概念。v2 首次加载时会自动迁移：

- `planId` 置为 `null`（表示不属于任何计划）
- `planName` 取原来的 `content`，为空则记为 `历史记录`
- 台账的 localStorage 键名仍是 `runform_checkins`，**老数据不会丢**

---

## 后续可扩展点

- **统计**：按周 / 月统计打卡天数、连续打卡（streak）。
- **提醒精确到分钟**：把 cron 调密（如每 15 分钟）并在脚本里比对完整 `HH:MM`。
- **多人**：接入 GitHub 登录或表单填昵称，区分不同用户。
- **图表**：用 Chart.js 画打卡趋势折线图。
- **导出**：把 `data/checkins.json` 导出为 CSV / ical。
- **提醒渠道**：除钉钉外，再加邮件 / 企业微信 / Telegram。

---

## 许可证

个人项目，随意使用与修改。
