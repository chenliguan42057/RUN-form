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
├── index.html                      # 页面结构
├── styles.css                      # 样式（含油画背景 + 半透蒙版）
├── app.js                          # 打卡 / 台账 / 同步逻辑
├── assets/
│   └── bg-vangogh-ocean.webp       # 背景油画（需自行放入）
├── .github/
│   └── workflows/
│       ├── dingtalk-reminder.yml   # 每日钉钉提醒
│       └── sync.yml                # 接收同步事件并写入 data/checkins.json
└── README.md
```

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

---

## 修改每日提醒时间

提醒时间写在 `.github/workflows/dingtalk-reminder.yml` 的 cron 里：

```yaml
schedule:
  - cron: "0 14 * * *"   # 14:00 UTC
```

GitHub Actions 的 cron 使用 **UTC** 时间，北京时间 = UTC + 8 小时。

| 想在北京时间 | 对应 UTC | cron 写法 |
| ------------ | -------- | --------- |
| 22:00        | 14:00    | `0 14 * * *` |
| 21:00        | 13:00    | `0 13 * * *` |
| 08:00        | 00:00    | `0 0 * * *`  |

改完提交即可生效；也可以到仓库 **Actions** 页手动 **Run workflow**（`workflow_dispatch`）测试。

---

## 同步到仓库的使用说明

1. 在页面「同步到 GitHub 仓库」卡片里，粘贴你的 **Personal Access Token**
   （需要有该仓库的 `repo` 权限；推荐使用 Fine-grained PAT 并只授权本仓库）。
2. 点击 **同步到仓库**。

行为说明：

- Token **只保存在浏览器会话（sessionStorage）**，关闭标签页即清除，**不会被写入文件或提交**。
- 点击后，前端向
  `https://api.github.com/repos/chenliguan42057/RUN-form/dispatches`
  发送 `repository_dispatch` 事件（`event_type: sync-checkins`，并把当前台账作为
  `client_payload.checkins` 传过去）。
- 仓库里的 `sync.yml` 收到事件后，把台账合并去重并写入 `data/checkins.json`，然后自动提交。
- 仅触发，不做复杂逻辑；成功 / 失败都会弹出 toast 提示。

---

## 后续可扩展点

- **统计**：按周 / 月统计打卡天数、连续打卡（streak）。
- **多人**：接入 GitHub 登录或表单填昵称，区分不同用户。
- **图表**：用 Chart.js 画打卡趋势折线图。
- **导出**：把 `data/checkins.json` 导出为 CSV / ical。
- **提醒渠道**：除钉钉外，再加邮件 / 企业微信 / Telegram。

---

## 许可证

个人项目，随意使用与修改。
