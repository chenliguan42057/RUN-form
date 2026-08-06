# 星河自律 · 个人打卡站点（RUN-form）

一个挂在 GitHub Pages 上的极简个人打卡（check-in）网站。

**v3「星河自律」** 把 v2 的白底卡片全面换成了 **深色星河玻璃拟态**：梵高星空油画打底，
毛玻璃卡片浮在上面，三层视差星点缓缓流动；新增仪表盘、统计页、热力星图、连续天数、
里程碑徽章与数据备份。副标题仍然是那句 **不按惯例 · RUN-form**。

纯静态实现：**HTML / CSS / JS，无构建步骤、无框架、无依赖**，
所有数据默认存在浏览器本地（localStorage）。

> 线上地址：https://chenliguan42057.github.io/RUN-form/

---

## 目录结构

```
RUN-form/
├── index.html                      # 仪表盘：问候 / 下一个提醒 / 今日时间轴 / 迷你星图
├── manage.html                     # 管理页：计划 CRUD / 界面偏好 / 备份恢复 / 台账 / 同步
├── stats.html                      # 统计页：全年星图 / 趋势 / 完成率 / 徽章 / 频率分布
├── styles.css                      # 深色星河玻璃拟态样式（含 6 套主题配色与全部动效）
├── store.js                        # 共享数据与计算层（三个页面都要最先加载它）
├── components.js                   # 共享 UI 生成器（ui* 纯函数，依赖 store.js）
├── app.js                          # 仪表盘逻辑
├── app2.js                         # 管理页逻辑
├── app3.js                         # 统计页逻辑
├── data/
│   ├── plans.json                  # 同步上来的计划（钉钉提醒读这个文件）
│   ├── checkins.json               # 同步上来的打卡台账
│   └── reminder-state.json         # 提醒送达状态（提醒工作流独占写，前端只读）
├── assets/
│   └── bg-vangogh-ocean.webp       # 背景油画
├── .github/
│   └── workflows/
│       ├── dingtalk-reminder.yml   # 每 15 分钟检查一次，推送到期计划的钉钉提醒
│       └── sync.yml                # 接收同步事件并写入 data/plans.json + data/checkins.json
└── README.md
```

### 脚本加载顺序（不可颠倒）

```
store.js  →  components.js  →  app.js / app2.js / app3.js
```

- `store.js`：常量、数据读写、日期与统计计算。**不碰任何页面独有的 DOM**。
- `components.js`：`ui*` 系列纯函数，输入数据、输出 HTML 字符串（或挂载行为）。
  所有用户数据在函数内部就已经过 `escapeHtml`，调用方直接塞 `innerHTML` 是安全的。
- `appN.js`：页面脚本，取 DOM、组织流程、绑事件。只有这一层才允许声明
  `const $ = (id) => document.getElementById(id)`。

---

## 页面分工（v3）

### 🌌 仪表盘 `index.html`

- 按时段问候（凌晨 / 早上 / 上午 / 中午 / 下午 / 傍晚 / 夜里）+ 当天日期 + 每日一句梵高书信。
- **下一个提醒**卡片：环形倒计时 + 计划图标 / 名称 / 说明，每 30 秒刷新一次。
- **概览**：启用计划数、今日到期 / 已完成、当前连续天数、近 30 天完成率。
- **今日时间轴**：今天所有到期计划按时间排序，标出「已送达 / 已完成 / 已过时间 / 即将触发」。
- **迷你星图**：最近 12 周的打卡热力图。
- 「标记完成」按钮默认显示，可在管理页关掉（见下方「界面偏好」）。

### 🛠 管理页 `manage.html`

计划的增删改查（含图标 / 配色 / 一句话说明）、界面偏好、数据备份与恢复、
全部台账（单条删除 / 清空全部）、GitHub 同步设置。

### 📊 统计页 `stats.html`

全年热力星图（可按数据来源筛选）、打卡趋势折线、各计划完成率与连续天数、
里程碑徽章墙、频率分布。**这一页只读**，唯一会写入的是「星图数据来源」这个筛选偏好。

---

## 数据模型

### 计划 Plan

```jsonc
{
  "id": "…",              // 自动生成的唯一 id
  "name": "跑步",          // 计划名，也是打卡记录里显示的内容
  "freq": "daily",        // daily | weekly | monthly
  "time": "08:00",        // 提醒时间（北京时间，HH:MM）
  "day": 0,               // weekly：星期号 0~6（周一 = 0）；monthly：每月第几日 1~31；daily：忽略
  "enabled": true,        // 关掉后既不出现在今日时间轴，也不会推提醒

  // ↓ v3 新增，老数据读取时会自动补全，不需要手工迁移
  "icon": "🏃",           // emoji 图标，缺省 🌟
  "color": "gold",        // 主题配色 key，缺省时按 id 哈希自动分配一种
  "desc": "五公里，慢一点也没关系",  // 一句话说明，可为空
  "createdAt": 1754460000000        // 创建时间戳，用于计算连续天数的起点
}
```

六套配色：`gold` 星夜金 / `blue` 深海蓝 / `teal` 松石绿 / `violet` 暮色紫 /
`rose` 玫瑰粉 / `amber` 麦田橙。

### 打卡记录 Checkin

```jsonc
{
  "id": "…",
  "planId": "…",          // 关联的计划 id，历史迁移数据可能是 null
  "planName": "跑步",
  "ts": 1754460000000,
  "note": "",

  // ↓ v3 新增
  "planIcon": "🏃",       // 打卡当时的图标快照（计划改图标后老记录不受影响）
  "source": "manual"      // manual = 手动确认；auto = 提醒送达
}
```

### 提醒送达状态 `data/reminder-state.json`

```jsonc
{
  "sent": {
    "2026-08-06|abc123": { "name": "跑步", "time": "08:00", "icon": "🏃", "ts": 1754460000000 }
  },
  "updatedAt": 1754460000000
}
```

- key 固定是 **`YYYY-MM-DD|planId`**，这是幂等去重的唯一依据。
- **由 `dingtalk-reminder.yml` 独占写入，前端只读**（`fetch` 同源相对路径，带
  `?t=` 时间戳绕缓存）。拉取失败（`file://` 预览 / 首次部署文件还不存在 / 断网）
  时会静默降级读 localStorage 缓存，页面右上角出现一个「离线」小胶囊，不会报错。
- ⚠️ `sync.yml` **绝对不能**把这个文件一起提交，否则会用旧快照覆盖提醒工作流刚写的记录，
  导致同一天重复轰炸 + 热力图上的青色格子凭空消失。工作流里已经写死了只 add 另外两个文件。

### 界面偏好 Prefs（localStorage 键 `runform_prefs`）

| 字段 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `showManualCheckin` | `true` | 仪表盘是否显示「标记完成」按钮。关掉后只展示提醒送达情况，台账仍然保留 |
| `heatmapSource` | `"all"` | 星图数据来源：`all` 全部 / `auto` 仅提醒送达 / `manual` 仅手动确认 |
| `reduceMotion` | `false` | 手动关闭全部动效 |

热力图配色区分来源：**青色 = 提醒送达（auto）**，**金色 = 手动确认（manual）**。

---

## ⚠️ 两套星期口径（改代码前必读）

| 场景 | 口径 | 说明 |
| ---- | ---- | ---- |
| `plan.day`、`data/plans.json`、Python `datetime.weekday()` | **周一 = 0** | 全仓库的存储口径 |
| JavaScript 原生 `Date.getDay()` | **周日 = 0** | 只在浏览器运行时出现 |

所以前端判断「某计划今天是否到期」必须换算：

```js
const jsDow = ((Number(plan.day) || 0) + 1) % 7;   // 存储口径 → JS 口径
return d.getDay() === jsDow;
```

Python 侧则可以直接比较，**不要**画蛇添足加换算：

```python
if freq == "weekly":
    return now.weekday() == day        # 两边都是周一 = 0
```

`manage.html` 里 `#plan-weekday` 的 `option value` 已按存储口径（周一 = 0）写死，
表单读到什么就存什么，中间不做任何转换。

---

## 钉钉提醒（v3 有较大改动）

### 调度策略

- cron 从 v2 的 **每小时整点**（`0 * * * *`）改成 **每 15 分钟**（`*/15 * * * *`）。
- 脚本比对**完整的 `HH:MM`**，不再只看小时——`08:00` 和 `08:30` 现在是两次独立的提醒。
- **补偿窗口 `WINDOW_MIN = 30`**：计划时间过去 30 分钟以内都算「本次该推」。
  GitHub 的 schedule 本身不保证准时（高峰期延迟 5~20 分钟是常态），这个窗口就是用来兜住抖动的。
- **幂等去重**：每次发送成功后，把 `YYYY-MM-DD|planId` 写进 `data/reminder-state.json`。
  窗口内的后续调度看到 key 已存在就跳过，所以「窗口 30 分钟 + 每 15 分钟跑一次」
  也只会推一条，不会重复。
- **批量阈值 2**：同一次判定出 2 个及以上到期计划时合并成一条消息，避免刷屏。
- 发送失败**不写状态文件**，下一次调度只要还在窗口内就会自动重试。
- `concurrency` 分组保证同一时刻只有一个提醒任务在跑。

### 手动触发与演练

**Actions → 钉钉打卡提醒 → Run workflow**，有两个输入：

| 输入 | 作用 |
| ---- | ---- |
| `dry_run` | 演练模式：只在日志里打印判定结果和消息全文，**不发钉钉、不写状态文件** |
| `force_plan_id` | 强制推送指定计划 id，**跳过时间判定与去重**，用来验证 webhook 是否通 |

改文案、调格式时先用 `dry_run` 跑一遍看日志，确认无误再真发。

### 每日一句是同一句

钉钉消息里的鼓励语和网页首页显示的是**同一句**——两边都用
`hashString(当天日期)` 取模选句，Python 侧完整复刻了 `store.js` 的 djb2 哈希。

> ⚠️ `dingtalk-reminder.yml` 里的 `QUOTES` 必须与 `store.js` 里的 `VAN_GOGH_QUOTES`
> 一字不差。改文案要**两边同时改**，否则同一天在网页和钉钉里会看到不同的句子。

### ⚠️ 改完计划一定要点一次「同步到仓库」

提醒脚本**读的是仓库里的 `data/plans.json`，不是你浏览器里的 localStorage**。所以：

> **新增 / 修改 / 删除计划后，去管理页点一次「同步到仓库」**（填了 Token 的话会自动同步），
> 等 Actions 跑完把 `data/plans.json` 更新掉，提醒才会生效。

没同步过的计划，调度器根本看不见。

---

## 数据备份与恢复

管理页 → **💾 备份与恢复**：

- **导出**：下载一个 `runform-backup-YYYY-MM-DD.json`，内含 **计划 + 台账 + 偏好**，
  **不含 Personal Access Token**，可以放心保存或转移到别的浏览器。
- **导入**：
  - 勾选「合并导入」（默认）→ 按 `id` 合并，同 id 以文件里的为准，本地独有的保留。
  - 不勾选 → **整体覆盖**本地数据，会先弹确认框。
- 导入完成后偏好、表单、列表、台账会立刻刷新，并触发一次自动同步。

---

## 无障碍与动效

- 固定深色主题，正文与背景对比度满足 **WCAG AA**；不提供浅色模式（星河底图在浅色下不成立）。
- 全部动效（星点闪烁、卡片进场、数字滚动、进度环填充、光晕呼吸……）都包在
  `@media (prefers-reduced-motion: no-preference)` 里。
- 系统开启「减少动态效果」时自动降级：`animation-duration: 0.001ms !important`，
  JS 侧的 `PREFERS_REDUCED` 常量同步生效，数字直接跳终值、进度环直接画满。
- 也可以在管理页手动勾「减少动效」，等价于给 `<html>` 加 `.no-motion` 类。
  **系统设置优先**：系统关了动效，页面上怎么点都不会有动画。

---

## 本地预览

任选一种方式：

1. **直接打开**：双击 `index.html`。
   ⚠️ `file://` 下浏览器会拦截 `fetch`，所以读不到 `data/reminder-state.json`，
   页面会显示「离线」胶囊、热力图上只有手动打卡的金色格子。这属于预期降级，功能不受影响。
2. **起本地服务**（推荐）：
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

- Token 保存在**本机浏览器的 localStorage**（键名 `runform_pat`），刷新页面、关闭标签页都不会丢，
  下次打开自动回填，不用每次重新粘贴。
- 它**只会通过 `Authorization` 请求头发给 GitHub**，不会写进任何文件、不会被提交、不会出现在日志里，
  也不会发给任何第三方。**导出的备份 JSON 里同样不含 Token。**
- ⚠️ 正因为是持久保存，**请勿在公共 / 共享电脑上保存 Token**。想清除的话，在浏览器开发者工具的
  Application → Local Storage 里删掉 `runform_pat` 即可。

### 自动同步

- 触发时机：打卡、删除记录、清空全部、新增 / 修改 / 删除计划、切换计划启用状态、导入备份。
- **防抖 800ms**：连续操作（比如一口气删好几条）只会在最后一次操作后合并成一次请求，不会刷屏。
- 自动同步是静默的：成功不打扰你，**只有失败才会弹错误 toast**。手动点按钮则成功 / 失败都有提示。
- 没填 Token 时自动同步会直接跳过，不会报错——纯本地用也完全没问题
  （但那样钉钉提醒就没有数据可读了）。

### 同步链路与覆盖语义

- 前端向 `https://api.github.com/repos/chenliguan42057/RUN-form/dispatches`
  发送 `repository_dispatch` 事件（`event_type: sync-checkins`，
  `client_payload` 里同时带 `plans` 与 `checkins`）。
- 仓库里的 `sync.yml` 收到事件后，把两份数据**全量覆盖写入** `data/plans.json`
  和 `data/checkins.json`，然后自动提交。**不会碰 `data/reminder-state.json`。**
- ⚠️ **浏览器端是唯一真源，远端是它的镜像**：
  在页面上删掉一条，同步后仓库里那条也会消失；点「清空全部记录」，仓库里的
  `data/checkins.json` 会被写成空数组 `[]`。这不是 bug，是刻意设计——
  否则删除和清空永远同步不出去。**需要留底就先用管理页的「导出备份 JSON」。**
- 换句话说：**远端不做累加**。如果你在两台设备上各自打卡，后同步的那台会覆盖掉先同步的内容。
- 两个工作流可能同时推送（提醒写 `reminder-state.json`、同步写另外两个文件），
  推送失败时都会 `git pull --rebase --autostash` 后重试一次；因为改的是不同文件，rebase 不会冲突。

---

## 数据迁移说明

### v1 → v2

v1 的打卡记录形如 `{id, ts, content}`，没有计划概念。v2 首次加载时会自动迁移：

- `planId` 置为 `null`（表示不属于任何计划）
- `planName` 取原来的 `content`，为空则记为 `历史记录`
- 台账的 localStorage 键名仍是 `runform_checkins`，**老数据不会丢**

### v2 → v3

**不需要做任何事，直接刷新页面即可。** v3 的迁移是「读时补全」，不改写已有存储：

- localStorage 键名全部沿用：`runform_plans` / `runform_checkins` / `runform_pat`。
- 计划缺 `icon` 补 `🌟`，缺 `color` 按 `id` 哈希分配，缺 `desc` 补空串，缺 `createdAt` 补一个兜底时间。
- 台账缺 `planIcon` 时按 `planId` 反查当前计划的图标，缺 `source` 一律视为 `manual`
  （v2 只有手动打卡，这个默认值是准确的）。
- 新增的 `runform_prefs` 首次读取时直接用默认值，不存在也不报错。

---

## 后续可扩展点

- **多人**：接入 GitHub 登录或表单填昵称，区分不同用户。
- **导出 CSV / iCal**：目前只导出 JSON。
- **提醒渠道**：除钉钉外，再加邮件 / 企业微信 / Telegram。
- **计划分组**：给计划加标签，按标签筛选统计。
- **补卡**：允许为过去某一天补一条记录（当前只能打「现在」）。

---

## 许可证

个人项目，随意使用与修改。
