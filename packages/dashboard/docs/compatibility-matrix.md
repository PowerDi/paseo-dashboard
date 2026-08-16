# Dashboard 兼容性矩阵

## 概述

Dashboard 通过 `server_info.features.*` 实现特性门控（feature gating），在连接到不同版本的 Paseo daemon 时优雅降级。

**兼容策略**：

- **协议兼容**：Dashboard 客户端可以连接任何版本的 daemon（向后兼容）
- **特性门控**：新功能检查 `server_info.features` 中的对应 flag，缺失时不启用该功能
- **优雅降级**：旧 daemon 不广播 feature flag 时，Dashboard 隐藏或禁用相关 UI，不进行 fallback 模拟

## Daemon 版本矩阵

| Daemon 版本 | Features 字段                                                      | Dashboard 行为                                         |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| v0.1.80-    | 无 `features` 字段                                                 | 所有特性门控返回 `false`，相关功能不可用               |
| v0.1.81+    | `{ "terminal-restore-modes": true }`                               | Terminal 支持 restore options（mode、scrollbackLines） |
| v0.1.106+   | `{ "terminal-restore-modes": true, selectiveAgentTimeline: true }` | + Agent timeline 选择性订阅（viewAgent/leaveAgent）    |
| v0.2.0+     | `workspaceFileEditing: true`                                       | + Workspace 文件只读查看与文件变更订阅                 |

## 特性门控列表

Dashboard 当前使用的所有 feature gates（位于 `web/src/paseo/features.ts`）：

### 1. `selectiveAgentTimeline`

- **添加版本**：v0.1.106
- **用途**：daemon 只为客户端显式订阅的 agent 推送 timeline 事件
- **门控位置**：`web/src/paseo/dashboardRuntime.ts` 的 `viewAgent` 和 `leaveAgent`
- **行为**：
  - **有 feature**：调用 `client.setAgentTimelineSubscription(agentId, true/false)` 订阅/取消订阅
  - **无 feature**：不调用订阅方法，daemon 会广播所有 agent 的 timeline 事件（性能较差，但功能可用）

### 2. `terminalRestoreModes`

- **添加版本**：v0.1.81
- **用途**：daemon 支持 terminal 恢复模式参数（mode、scrollbackLines），避免总是发送完整 snapshot
- **门控位置**：`web/src/paseo/terminalSession.ts` 的 `onTerminalStreamEvent` 订阅
- **行为**：
  - **有 feature**：传递 `restore: { mode: "ansi-stream", scrollbackLines: 10000 }` 参数
  - **无 feature**：不传递 restore 参数，daemon 会发送 `snapshot` 帧（Dashboard 用 `renderTerminalSnapshotToAnsi` 重放）

### 3. `workspaceFileEditing`

- **添加版本**：v0.2.0
- **用途**：daemon 支持 `fs.file.subscribe` 文件版本订阅和同组文件写入 RPC；Dashboard P3.7.1 只使用订阅部分。
- **门控位置**：`web/src/pages/WorkspacePage.tsx` 的 Workspace 视图切换。
- **行为**：
  - **有 feature**：显示「文件」视图，使用 `listDirectory`、`readFile` 和 `subscribeFile`。
  - **无 feature**：隐藏「文件」视图，不通过轮询或旧 RPC 模拟文件订阅。

## 测试覆盖

兼容性测试位于 `tests/e2e/src/compatibility.vitest.test.ts`，共 **18 个测试用例**：

### Feature Detection 测试（8 个）

- 旧 daemon 无 features 字段 → 全 false
- null server_info → 全 false
- 空 features 对象 → 全 false
- v0.1.81 daemon → terminalRestoreModes true
- v0.1.106 daemon → timeline 与 terminal feature 为 true
- v0.2.0 daemon → `workspaceFileEditing` 为 true
- 显式 false flag → 正确识别
- 未知 feature → 忽略不影响

### 兼容性判断测试（4 个）

- 旧 daemon 无 features → 接受（优雅降级）
- 部分 features → 接受
- 全部 features → 接受
- null server_info → 接受（连接中的竞态）

### Feature Gating 行为测试（6 个）

- selectiveAgentTimeline 缺失 → 不调用订阅方法
- selectiveAgentTimeline 存在 → 启用订阅
- terminalRestoreModes 缺失 → 不传 restore options
- terminalRestoreModes 存在 → 传 restore options
- workspaceFileEditing 缺失 → 隐藏文件视图
- workspaceFileEditing 存在 → 启用文件视图

## 添加新 Feature Gate 的流程

1. **在 `web/src/paseo/features.ts` 扩展 `DaemonFeatures` 接口**：

   ```typescript
   export interface DaemonFeatures {
     // 现有...
     newFeature: boolean;
   }
   ```

2. **在 `getDaemonFeatures` 函数中提取 flag**：

   ```typescript
   export function getDaemonFeatures(serverInfo: ServerInfoStatusPayload | null): DaemonFeatures {
     const features = serverInfo?.features ?? {};
     return {
       // 现有...
       newFeature: features["new-feature"] === true,
     };
   }
   ```

3. **在使用点进行 gate 检查**（带 COMPAT 标签）：

   ```typescript
   const features = getDaemonFeatures(serverInfo);

   // COMPAT(new-feature): added in v0.x.y, remove after 2027-XX
   if (features.newFeature) {
     // 使用新功能
   } else {
     // 隐藏 UI 或禁用功能，不做 fallback 模拟
   }
   ```

4. **在 `tests/e2e/src/compatibility.vitest.test.ts` 添加测试**：

   ```typescript
   it("detects newFeature for vX.Y.Z+ daemon", () => {
     const serverInfo = {
       version: "0.x.y",
       features: { "new-feature": true },
     };
     expect(getDaemonFeatures(serverInfo).newFeature).toBe(true);
   });

   it("gates newFeature when missing", () => {
     const oldDaemon = { version: "0.1.80" };
     expect(getDaemonFeatures(oldDaemon).newFeature).toBe(false);
   });
   ```

5. **更新本文档的「特性门控列表」和「Daemon 版本矩阵」**。

## COMPAT 标签清理

所有 feature gate 代码必须带 COMPAT 标签，格式：

```typescript
// COMPAT(feature-name): added in vX.Y.Z, remove after YYYY-MM
```

**清理时机**：

- 当所有支持的 daemon 版本都包含该 feature 时（通常是功能添加 1 年后）
- 执行 `rg "COMPAT\("` 查看待清理列表
- 删除 gate 检查，直接使用新功能，不再降级

**当前 COMPAT 标签**：

- `COMPAT(selectiveAgentTimeline)` - `dashboardRuntime.ts:XXX` - 添加于 v0.1.106，2027-08 后可删
- `COMPAT(terminal-restore-modes)` - `terminalSession.ts:XXX` - 添加于 v0.1.81，2027-02 后可删
- `COMPAT(workspaceFileEditing)` - `WorkspacePage.tsx:XXX` - 添加于 v0.2.0，daemon floor 达到 v0.2.0 后可删

## 协议兼容性

Dashboard 遵守 Paseo 的协议兼容规则（见 `/root/workspace/code/paseo/docs/protocol-compatibility.md`）：

- **Wire schema 保持纯净**：不用 `.transform()`、`.catch()`、`.preprocess()`
- **新字段可选**：不 narrow、不删除、不要求
- **一次性 gating**：检查一次 feature flag，然后运行功能或告知用户更新 host
- **不做 fallback 路径**：没有 feature 时不模拟行为，而是禁用功能

## 测试矩阵验证

**手动测试**（可选，CI 不包含）：

1. 启动旧版 daemon（v0.1.80）
2. Dashboard 连接后检查：
   - Timeline 仍可用（daemon 广播所有事件）
   - Terminal 仍可用（daemon 发送 snapshot 帧）
   - Workspace 不显示「文件」视图
3. 升级 daemon 到 v0.2.0+
4. Dashboard 重连后检查：
   - Timeline 订阅生效（只接收选中 agent 事件）
   - Terminal restore 参数生效（不再收到 snapshot）
   - Workspace 显示「文件」视图，文件变更能刷新内容

**自动化测试**（已包含在 `test:dashboard`）：

- ✅ Feature detection 逻辑（15 个测试用例）
- ✅ Gate 检查在实际调用点（dashboardRuntime.test.ts、terminalSession.test.ts）

## 参考

- Paseo 协议兼容文档：`/root/workspace/code/paseo/docs/protocol-compatibility.md`
- Dashboard feature 实现：`packages/dashboard/web/src/paseo/features.ts`
- 兼容性测试：`packages/dashboard/tests/e2e/src/compatibility.vitest.test.ts`
