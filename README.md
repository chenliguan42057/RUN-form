# 星河契约 · 个人打卡站点（RUN-form）

一个挂在 GitHub Pages 上的极简个人打卡（check-in）网站。

**v4「星河契约」** 换了一套说法：**立一个计划 = 与星辰缔结一份契约**。
每个计划都是夜空里的一颗星——坚持得越久它越亮，荒废了就慢慢黯下去。
管理页不再是一张「表格 + 技术设置」的后台，而是**一块可以亲手安排自己星空的画布**：
星点按 id 哈希落位、按连续天数分四档亮度、按创建先后连成星座；
悬停看星语，点击进入编辑，删除叫作 **「熄灭此星」**。
同步 Token、备份恢复这类技术开关全部收进右上角 **✦ 设置抽屉**，不再占据主视野。

前作 **v3「星河自律」** 已把白底卡片换成 **深色星河玻璃拟态**：梵高星空油画打底，
毛玻璃卡片浮在上面，三层视差星点缓缓流动。v4 在它之上**只做加法**，
v3 的全部数据、键名与函数原样保留。副标题仍然是那句 **不按惯例 · RUN-form**。

纯静态实现：**HTML / CSS / JS，无构建步骤、无框架、无依赖**，
所有数据默认存在浏览器本地（localStorage）。

> 线上地址：https://chenliguan42057.github.io/RUN-form/

---

## 目录结构

```
RUN-form/
├── index.html                      # 观星台：天象旁白 / 四枚天象指标 / 今晚的星轨 / 星点热力 / 星语
├── manage.html                     # 星图编辑器：星空画布 / 缔结新星 / 编辑与熄灭 / ✦ 设置抽屉
├── stats.html                      # 星历：我的星途（星轨）/ 星座亮度条 / 月历星图 / 徽章 / 频率分布
├── styles.css                      # 深色星河玻璃拟态样式（6 套主题配色 + v3/v4 全部动效）
├── store.js                        # 共享数据与计算层（三个页面都要最先加载它）
├── components.js                   # 共享 UI 生成器（ui* 纯函数，依赖 store.js）
├── app.js                          # 仪表盘逻辑
├── app2.js                         # 管理页逻辑
├── app3.js                         # 统计页逻辑
├── data/
│   ├── plans.json                  # 同步上来的计划（钉钉提醒读这个文件）
│   ├── checkins.json               # 同步上来的打卡台账
│   ├── quotes.json                 # 每日心法大语录库（首页星语 + 09:10 / 21:10 钉钉推送共用）
│   └── reminder-state.json         # 提醒送达状态（提醒工作流独占写，前端只读）
├── assets/
│   └── bg-vangogh-ocean.webp       # 背景油画
├── .github/
│   └── workflows/
│       ├── dingtalk-reminder.yml   # 每 15 分钟检查一次，推送到期计划的钉钉提醒
│       ├── daily-quote.yml         # 每天北京时间 09:10 推送一句「当日心法」
│       ├── daily-quote-evening.yml # 每天北京时间 21:10 推送一句「晚安心法」（半库偏移，早≠晚）
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

## 页面分工（v4）

### 🔭 观星台 `index.html`

- **天象旁白**：`skyPoem(now)` 按 24 小时给出不同的一句，配当天日期与每日一句梵高书信。
- **下一个提醒**卡片：环形倒计时 + 计划图标 / 名称 / 说明，每 30 秒刷新一次。
- **四枚天象指标**（`.stat-grid--astro`）：
  | 指标 | 含义 |
  | ---- | ---- |
  | 星数 | 当前启用的计划数 |
  | 待点亮 | 今日到期但还没完成的数量 |
  | 彗尾 | 当前连续天数，尾巴长度随 `streak/21` 增长 |
  | 月相 | 近 30 天完成率，画成一枚真实的月相 SVG |
- **今晚的星轨**（`.rail`）：今天所有到期计划按时间排成一条轨道，
  逐项标出 `is-done / is-passed / is-due / is-now`。
- **星点热力**：最近 12 周的打卡热力图，格子从 `sh-l0` 到 `sh-l4` 五档。
- **星语**：底部一张 quote 卡片。
- 「标记完成」按钮默认显示，可在设置抽屉里关掉（见下方「界面偏好」）。

### ✦ 星图编辑器 `manage.html`

主视野**只有星空**：

- **星空画布**（`.sky-map`）：每个计划一颗星，位置由 `planStarPosition(id)` 哈希派生并做
  确定性松弛避免重叠；亮度由 `planBrightness(plan)` 按「连续天数 65% + 近 30 天完成率 35%」
  算出 0~4 级；按 `createdAt` 先后连成**星座连线**。
- **悬停**弹出星语 tooltip（频率 / 时间 / 下次触发 / 完成率 / 说明，全部经 `escapeHtml`）。
- **点击**任一颗星打开编辑弹窗；弹窗底部的危险区按钮叫 **「熄灭此星」**。
- **「+ 缔结新星」**按钮新建计划；一颗星都没有时显示空状态引导语。
- **右上角 ✦ 按钮**打开**设置抽屉**，v3 那两张技术卡片（**同步到 GitHub 仓库**、
  **备份与恢复**）连同界面偏好、全部台账都收在这里。
  DOM 里 `#pat-input` / `#sync-btn` / `#toast` 的 id 与行为完全没变，只是换了个位置。

### 🗓 星历 `stats.html`

- **里程碑欢呼**（`milestoneCheer()`）：达成阶段性成就时在顶部给一句。
- **我的星途**：每个启用计划一条**竖向星轨**，21 天封顶，按当前 / 最佳连续降序，最多 12 条。
- **星座亮度条**：各计划近 30 天完成率画成亮度条。
- **月历星图**：可前后翻月，有活动的日子亮成一颗星；已是本月时「下一月 / 回到本月」自动禁用。
- 全年热力星图（可按数据来源筛选）、打卡趋势折线、里程碑徽章墙、频率分布。
- **这一页只读**，唯一会写入的是「星图数据来源」这个筛选偏好。

---

## v4 星图计算层（`store.js` 追加部分）

这些都是**纯函数 + 确定性**的：同样的输入永远给同样的星空，刷新页面星星不会乱跳。

| 函数 | 作用 |
| ---- | ---- |
| `skyPoem(date)` | 按小时取一句天象旁白，24 小时都有兜底 |
| `planStarPosition(id)` | 用 djb2 哈希把 id 映射成 `{x, y}` 百分比，落在安全边距内 |
| `planBrightness(plan)` | 算亮度：`min(streak/21,1)*0.65 + rate*0.35`，按 `STAR_LEVEL_STEPS` 分 0~4 级 |
| `buildStarMap(plans)` | 星点 + 星座连线 + `{total, lit, dim}` 统计，含确定性松弛去重叠 |
| `buildMonthGrid(y, m)` | 月历网格，整周对齐、**周一在第一列**、带当月活动统计 |
| `milestoneCheer()` | 里程碑文案，无数据时也给鼓励，不会返回空 |
| `loadMindsetQuotes()` | 异步取 `data/quotes.json` 大语录库，带缓存；失败回落 `VAN_GOGH_QUOTES` |
| `dayOfYear(dateStr)` | `'YYYY-MM-DD'` → 一年中的第几天（1 月 1 日 = 1）。**星语已不走这里**，保留备用 |
| `daysSinceEpoch(dateStr, epoch)` | 距 `MINDSET_EPOCH`（2026-01-01 = 0）的总天数，与钉钉工作流口径一致 |
| `dailyMindsetQuote(dateStr, quotes, offset?)` | 按 `(days + offset) % len` 取心法（欧几里得取模）；`offset` 缺省 0 = 早上那句，传 `len/2` = 晚上那句，详见「每日心法语录」一节 |

几个关键常量：`STAR_MARGIN_X = 9`、`STAR_MARGIN_Y = 13`、`STAR_ASPECT = 1.7`、
`STAR_MIN_GAP = 17`、`STAR_RELAX_ITERATIONS = 30`、`STAR_LEVEL_STEPS = [0.8, 0.56, 0.32, 0.02]`。

> ⚠️ **停用的计划恒为 0 级**（星星熄灭）；启用中的计划**至少 1 级微光**，
> 不会因为一次没打卡就完全看不见。

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

> ⚠️ **本地台账里只应该有 `manual`**。`auto` 那一半活动来自
> `data/reminder-state.json`，由 `buildActivityMap()` 单独并进来。
> 所以 `buildActivityMap` 里有一行防御：`if (c.source === "auto") return;`——
> 本地台账中若混入 `auto` 记录会被直接跳过，否则同一次提醒会被算两遍。
> **写测试造数据时要注意这一点**，本地 checkin 全写 `manual` 才符合真实情况。

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

> **新增 / 修改 / 熄灭星星后，去管理页 ✦ 设置抽屉里点一次「同步到仓库」**
>（填了 Token 的话会自动同步），等 Actions 跑完把 `data/plans.json` 更新掉，提醒才会生效。

没同步过的计划，调度器根本看不见。

---

## 每日心法语录

和「打卡提醒」是两条完全独立的链路：提醒盯的是**你的计划到点没有**，
心法语录盯的是**今天这句话**。前者读 `data/plans.json`，后者读 `data/quotes.json`。

### 它每天做什么

- **每天北京时间 09:10**，`.github/workflows/daily-quote.yml` 自动从
  `data/quotes.json` 里取一句，推送到钉钉。
- cron 写的是 `"10 1 * * *"`——GitHub 用 UTC，北京时间 = UTC+8，所以 09:10 要往前推 8 小时。
- 选句规则是**按日期轮播**，不是随机：

  ```
  days  = 今天距 2026-01-01 的总天数（2026-01-01 记为 0）
  quote = quotes[days % quotes.length]
  ```

  所以同一天不管跑几次、刷新几次，永远是同一句；第二天自动换下一句。
  目前库里 1102 条，**要走满 1102 天（约 3 年）才回到原点，跨年也不重复，整库都会被轮到**。

> ⚠️ **起点之前的日期天数为负，两端取模语义不同。**
> Python 的 `%` 对负数返回非负余数（`-1 % 1102 == 1101`），
> 而 JS 的 `%` 返回负余数（`-1 % 1102 === -1`，会取到 `quotes[-1]` → `undefined`）。
> 所以 `store.js` 里用的是欧几里得取模 `((n % len) + len) % len` 来对齐 Python。
> **这行别删**，否则 2026-01-01 之前的日期两端会选出不同的句子。

### 首页「星语」读的是同一份库

`index.html` 的「星语」也走 `data/quotes.json`，用的是同一个
`days % len` 公式（`store.js` 的 `daysSinceEpoch()` / `dailyMindsetQuote()`），
所以**网页上看到的那句，就是当天早上钉钉推给你的那句**。

渲染分两步，是为了避免加载期间那块地方是空的：

1. 同步先渲染一句梵高语录兜底（署名 `— 梵高`）；
2. `loadMindsetQuotes()` 异步取回大库后，用「当日心法」覆盖（署名 `— RUN-form 心法`）。

`quotes.json` 拉不到（离线 / 文件损坏 / 空数组）时会静默回落到梵高语录，
首页不会白屏；钉钉侧同样有内置的 5 条兜底小库，**工作流不会因为语录文件出问题而变红**。

> ⚠️ 两边的天数口径必须一字不差：
> Python 侧是 `(today - date(2026, 1, 1)).days`，
> JS 侧是 `store.js` 的 `daysSinceEpoch()`（用 `Date.UTC` 做减法绕开夏令时）。
> 起点常量两边也要对齐：`MINDSET_EPOCH`（JS 是字符串 `"2026-01-01"`，Python 是 `date(2026,1,1)`）。
> 改任何一边都要同步改另一边，否则同一天会看到两句不同的话。

### 每晚心法（21:10 的第二条推送）

除了早上那条，**每天北京时间 21:10** 还会再推一条「晚安心法」，
走的是 `.github/workflows/daily-quote-evening.yml`，cron `"10 13 * * *"`（UTC 13:10）。
文案是夜里收尾的口吻：回顾今天、给自己一句定心的话，然后早点睡。

**早上 09:10 那条完全没动**——两个工作流是彼此独立的文件，
`concurrency.group` 也分成了 `daily-quote` 和 `daily-quote-evening`，互不排队、互不取消。

选句用的是**同一份 `quotes.json`、同一个 `days`**，只是加了个「半库偏移」：

```
早上：index = days % len
晚上：index = (days + len // 2) % len
```

偏移半个库，是为了保证**同一天早上和晚上不会是同一句**（只要 `len >= 2`，`len // 2` 就不为 0），
同时晚上这条依旧是全库轮播——走满 `len` 天回到原点，一条都不会漏。

JS 侧对应的是 `dailyMindsetQuote(dateStr, quotes, offset)` 的第三个参数：

```js
dailyMindsetQuote(dateKey(new Date()), quotes)                          // 早上那句（offset 省略 = 0）
dailyMindsetQuote(dateKey(new Date()), quotes, Math.floor(len / 2))     // 晚上那句
```

> ⚠️ `offset` 是**可选**参数，省略或传 `0` 时行为与加它之前一模一样。
> `app.js` 首页「星语」调用的就是不带 `offset` 的版本，所以**页面上显示的永远是早上那句**。
> 想让首页也跟着变成晚上那句，得自己判断时间再传 `Math.floor(quotes.length / 2)`——目前没这么做。

手动验证：**Actions → 每日晚安心法推送 → Run workflow**，勾上 `dry_run`，
日志里会同时打印晚上的 `index` 和早上的 `index`，一眼就能看出两句不一样。

和早上那条一样，这个工作流**只读不写**：不碰 `reminder-state.json`，不做任何 `git commit`，
`permissions` 只申请 `contents: read`。

### 怎么扩充语录

直接往 `data/quotes.json` 这个数组里加字符串就行，不用改任何代码：

```json
[
  "我的归属不是眼前的苟且，我想试试不一样的人生。",
  "我不将就，因为将就一次，就会将就一辈子。",
  "在这里加你自己的新句子。"
]
```

加完提交推送即可，下一次 09:10 / 21:10 两条推送都会用新库选句，首页刷新后也会同步生效。
**早晚两条读的是同一个数组**，所以只要往数组里加字符串，两条一起变多，不用改任何代码。

**条数越多，一轮走完需要的天数越久，也就越久不重样**——整库都在轮播里，
加一条就多一天不重复。注意加句子会**改变末尾之后所有日期的对应关系**
（因为 `len` 变了，取模结果整体平移），这不影响两端一致性（两边读的是同一个文件）。

**想指定某天显示哪句**，直接改对应索引位置上的那条：

```
索引 = 该日期距 2026-01-01 的天数
```

例如 2026-01-01 是索引 `0`，2026-08-06 是索引 `217`，2026-08-07 是索引 `218`。

### 手动验证

**Actions → 每日心法语录 → Run workflow**，勾上 `dry_run` 就只在日志里打印
当天选中的语录和消息全文，**不会真的发钉钉**。改文案时先这么跑一遍。

这个工作流**只读不写**——不碰 `reminder-state.json`，不做任何 `git commit`，
`permissions` 也只申请了 `contents: read`。

---

## 数据备份与恢复

管理页 → 右上角 **✦ 设置** → **💾 备份与恢复**（v4 起从主视野移进抽屉，功能未变）：

- **导出**：下载一个 `runform-backup-YYYY-MM-DD.json`，内含 **计划 + 台账 + 偏好**，
  **不含 Personal Access Token**，可以放心保存或转移到别的浏览器。
- **导入**：
  - 勾选「合并导入」（默认）→ 按 `id` 合并，同 id 以文件里的为准，本地独有的保留。
  - 不勾选 → **整体覆盖**本地数据，会先弹确认框。
- 导入完成后偏好、表单、列表、台账会立刻刷新，并触发一次自动同步。

---

## 无障碍与动效

- 固定深色主题，正文与背景对比度满足 **WCAG AA**；不提供浅色模式（星河底图在浅色下不成立）。
- **全部动效都包在 `@media (prefers-reduced-motion: no-preference)` 里**，这是硬约定。
  v3 的星点闪烁、卡片进场、数字滚动、进度环填充、光晕呼吸；v4 新增的
  `star-breathe` / `star-beam-flare` / `link-flow` / `modal-in` / `drawer-in` /
  `comet-glow` / `rail-halo` / `mg-pop` / `track-rise` / `track-float` /
  `bright-grow` / `quote-glow` / `cheer-glow` 一律遵守。
- 每条 v4 关键帧的 `100%` 都是**稳定的静止态**，所以动画即使被掐断，元素也停在正确的最终样子上。
- 系统开启「减少动态效果」时自动降级：`animation-duration: 0.001ms !important`，
  JS 侧的 `PREFERS_REDUCED` 常量同步生效，数字直接跳终值、进度环直接画满。
  星轨、亮度条、月历星点、弹窗与抽屉另有一组
  `opacity:1 / transform:none / animation:none` 的静态兜底，不会停在「动画还没开始」的透明状态。
- 也可以在设置抽屉里手动勾「减少动效」，等价于给 `<html>` 加 `.no-motion` 类。
  **系统设置优先**：系统关了动效，页面上怎么点都不会有动画。
- 星点、星轨、月历格子都是真实的 `<button>` / 带 `aria-label` 的元素，可键盘聚焦；
  纯装饰的 SVG 一律 `aria-hidden="true"`。

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

1. 进入 **管理页 → 右上角 ✦ 设置 → 同步到 GitHub 仓库**，粘贴你的 **Personal Access Token**。
   （v4 起这张卡片收进了设置抽屉，`#pat-input` / `#sync-btn` 的 id 与行为都没变。）
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

### v3 → v4

**零迁移。刷新即可。**

- **数据模型一个字段都没改**，localStorage 键名全部沿用：
  `runform_plans` / `runform_checkins` / `runform_pat` / `runform_prefs` / `runform_reminder_cache`。
- `data/plans.json`、`data/checkins.json`、`data/reminder-state.json` 的结构没动，
  `.github/workflows/` 一行没改，钉钉提醒与同步链路完全照旧。
- v4 是**纯加法**：`store.js` 追加了 `skyPoem` / `planStarPosition` / `planBrightness` /
  `buildStarMap` / `buildMonthGrid` / `milestoneCheer`，`components.js` 追加了 14 个 `ui*`
  渲染器，v3 的老函数一个没删，仍可被调用。
- 唯一的**行为变化**是位置：管理页的「同步到 GitHub 仓库」「备份与恢复」两张卡片
  从主视野搬进了 ✦ 设置抽屉。id 与逻辑不变，用惯 v3 的人只需要多点一下齿轮。

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
