# Dashboard Web UI

Dashboard 浏览器端的视觉与交互约定。改 `packages/dashboard/web/` 的页面、组件、CSS 前读这篇。

Paseo 官方 App（`packages/app`、仓库根 `docs/design.md`）是另一套设计系统（React Native / Unistyles），**不要当 Dashboard 的样式来源**。Dashboard 自己实现页面和设计系统，见 [paseo-integration.md](./paseo-integration.md) 的页面平移原则。

## 参照

视觉与组件结构对齐 **Zeno desktop renderer**：

`/root/workspace/code/zeno/apps/desktop/src/renderer/`

- 看 `components/`、`components/ui/`、`styles.css`。
- 不要看 `apps/landing`——那是营销首页，只有首屏。
- 技术栈同构：Tailwind 4 + CVA + lucide + `radix-ui`。`components/ui/` 下的 shadcn 风格组件可以复制，改 `@/` 指向 `packages/dashboard/web/src`。
- 已搬：select、dialog、alert-dialog、tooltip。未搬：dropdown-menu、popover、tabs、switch、scroll-area、command、collapsible、field / input / label、message-scroller。
- 搬组件时：radix 的 `animate-in` / `fade-in-0` 依赖 `tw-animate-css`；用到的语义色（`bg-popover` 等）必须在 `web/src/globals.css` 的 `@theme inline` 里有映射。

缺交互时先打开 Zeno 对应组件，再决定搬结构还是只搬观感。不要从零发明一套间距和控件。

## 气质

密、安静。侧栏窄、主区低噪声、消息连续阅读、composer 贴底常驻。深色是默认，亮色是同一套结构换一组 token。

层级靠字重和颜色，不靠把字做大。正文 14px；结构标签 `500`；内容 `400`。可操作的用 `--foreground`，上下文用 `--foreground-muted` / `--foreground-subtle`。

每个表面最多一个实心主按钮（`--primary` 填充）。其余用 ghost / outline / 次级动作。

## Token 与文件

| 放这里                | 放什么                                                        |
| --------------------- | ------------------------------------------------------------- |
| `web/src/globals.css` | 色、圆角、字阶、motion、markdown/code、层叠重置。注释即规范。 |
| `web/src/App.css`     | 壳、侧栏、树、composer、header、timeline 的结构类。           |

表面三级：`--surface-panel`（卡片、菜单、输入）、`--surface-muted`（hover / 选中）、`--surface-soft`（用户气泡、终端底）。圆角 6 / 10 / 12（`--radius-sm/md/lg`）。

### 主题

两套：`[data-theme="dark"]`（同时挂在 `:root`，是默认）和 `[data-theme="light"]`。`stores/theme-store.ts` 是唯一入口——写 `data-theme` + `color-scheme`，存 localStorage（`paseo-dashboard-theme`），并派发 `THEME_CHANGE_EVENT`。切换器在设置页「偏好」和侧栏底部。

加主题相关的颜色时：**先加 token，两套主题各给一份**，再在规则里用 `var()`。写死 hex 的代价是亮色下直接崩——代码块的 hljs 语法色、diff 增删底色、滚动条、选区、composer 聚焦背景当初都是写死的，亮色主题第一版整块代码块是灰底浅字。`color-mix(… var(--background) …)` 也不安全：混出来的结果跟着主题反向跑。

`--code-*` 那一组（`--code-block-bg/-fg/-label`、`--code-comment/-keyword/-string/-number/-variable`、`--code-diff-*`）拥有代码块的全部配色，两套主题都定义完整。

xterm 不读 CSS 变量（canvas 测量字形，`fontFamily` 也要写完整字体栈）。`terminal-view.tsx` 用 `getComputedStyle` 取 token 值，并监听 `THEME_CHANGE_EVENT` 重设 `terminal.options.theme`。

字符串一律走 i18n（`web/src/i18n/`）。`zh-CN.ts` 是字典事实来源，`en.ts` 用 `typeof zhCN` 约束。`t()` 拼错 key 会编译失败。不要在 JSX 里写死用户可见文案。语言检测顺序：localStorage（`paseo-dashboard-language`）→ navigator；切换器在设置页「偏好」。

## 层叠（下午级坑）

元素重置必须写在 `@layer base` 里。

无层级 CSS **恒定压过** `@layer utilities`，跟 specificity 无关。曾经有一条裸的 `* { margin: 0; padding: 0 }`，全站 Tailwind 间距工具类（`p-*`、`m-*`、`space-y-*`）静默失效——权限卡片写了 `p-3.5`，计算值是 `padding: 0`，按钮贴边。

`App.css` 的组件类故意留在 layer 外，用来压过 utilities。不要把组件类再塞进 `@layer utilities`。改间距之前先在 DevTools 看计算值是不是 0。

## 控件结构

### Composer

一个控件，不是三个零件叠在一起。

- 顶上是满宽 **protrusion 条**（`--composer-protrusion`），只圆上角。项目 / provider 是条上的 chip，不是浮在外面的独立盒子。
- 下面是输入卡片，有 protrusion 时上角收小，焊在条上（`composer-card is-attached`）。
- **发送按钮占自己的底栏**（`.composer-actions`），禁止和 textarea 同一行。键盘提示放底栏左侧，不要再写进 placeholder。
- 共享壳：`components/composer-shell.tsx`。新建会话和进行中会话都走它。
- 贴底的 radix Select 用 `position="popper" side="top"`。默认 `item-aligned` 会盖住触发器。

### 侧栏

导航行（Hosts / Agents / Settings）用 `.dashboard-nav-item`。树节点用 `.dashboard-tree-row`。

「添加主机」这类**往树里加东西的动作**用 `.dashboard-sidebar-action`（虚线方标 + 次级字色），不要复用 nav-item，否则会和上一行挤成一条。

会话行状态用 `components/session-status-marker.tsx`：running 转圈、error 红叉、idle 点。不要再给 running 加一颗会呼吸的绿点。

### 运行中

daemon 只报 `running` / `idle` / `error`。没有 thinking / executing / compacting 这种独立协议字段。更细的 phase 从**最新 timeline 条目**推断（`lib/live-activity.ts`）。不要为此扩 wire schema。

两层都要有：

1. 侧栏 marker（扫一眼）。
2. 时间线末尾 `TimelineLiveStatus`：图标 + 经过时间，`role="status"`。**不显示状态文案**——「正在回复…」「思考中」这类固定词对不上 agent 真实状态，只会让人盯着一个假标签；图标和计时已经说明它在动。图标参照 zeno `TimelineRow.tsx` 的 `liveStatusIcon`。

计时的起点：优先用 daemon 时间戳，但 daemon 的钟可能比浏览器快，负的经过时间会被 `formatElapsed` 钳成 `0s` 并一直卡住。时间戳缺失或超前 1s 以上就从组件挂载时刻起算。

### 发消息

发送后立刻在时间线末尾出现用户气泡，紧接着是活动指示器——一次连续的状态，不是「先出指示器、再把气泡插到它上面」。

实现在 `timeline-store` 的 `submissions`：runtime 发消息前生成 `messageId` 写入 store，daemon 把它当 `user_message.clientMessageId` 回来后按 ID 移除乐观条目，RPC 失败只回滚这一条。两种错误做法——按文本匹配（连发同样内容会错配）、靠 agent `running` 状态清理（状态与 timeline 不同帧到达，中间会闪一段空白）。canonical 与乐观气泡共用 `submission:<id>` 这个 React key，接管时不重新挂载。

### 时间线

- 用户消息右对齐气泡（`.thread-user-bubble`），助手消息 markdown（`MarkdownContent`），不要把用户消息做成和助手一样的通栏卡片。
- 用户消息前加一点顶距，把轮次分开。
- 上翻超过阈值就不要再自动贴底；给「回到底部」按钮（`.workspace-scroll-bottom`）。
- 权限请求不是 timeline item，卡片挂在时间线后面，见 progress.md 里「权限不是 timeline 条目」。

### Header

状态、Timeline/Terminal 切换、行内操作是**三组**，组间留空，不要 `ml-2` 把它们粘成一串。标题过长截断，不要把 tab 挤出视口。

## 禁止

- 原生 `<select>`。用 radix Select。
- `window.alert` / `window.confirm`。用 `useErrorAlert()` 或 AlertDialog。
- 为「看起来像按钮」而复用导航行 class。
- 把发送箭头绝对定位进 textarea。
- 从 `packages/app` 抄 RN 组件或 Unistyles token。
- 在 layer 外写新的全局 `* { padding/margin }`。
- 写死颜色。颜色进 token，两套主题各一份。
- 给活动指示器加状态文案。

## 验证

- 间距看起来挤：先看计算 padding/margin 是不是 0（层叠），再改 class。
- 改颜色：两套主题都截图。代码块、diff、终端最容易只在深色下对。
- Playwright 用 `http://localhost:5173`。server Origin 白名单不认别的 vite 端口，登录会 403。
- headless 截图时入场动画首帧全透明（`startTime: null`）。截图前 `mouse.move` + `wheel` 推进合成。
- web 单测走 `npm run test --workspace=@getpaseo/dashboard-web`（该包自己的 `@` 别名）。不要从仓库根 `npx vitest run packages/dashboard/web/src`。
