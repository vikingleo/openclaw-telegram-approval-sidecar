# OpenClaw Telegram Exec Approval Sidecar 实施计划

## 总体策略

按“**先验证关键约束，再最小实现，再增强**”推进：

- 第一阶段确认技术闭环成立
- 第二阶段做最小可用版本（MVP）
- 第三阶段做消息更新、容错和部署收尾
- 全程保持**非侵入式**，不改 OpenClaw 核心安装目录

---

## Phase 0：前置验证

### 目标

确认 sidecar 方案是否能在**不改核心源码**的前提下成立。

### 任务

1. 验证 OpenClaw 审批事件是否能被外部 Gateway 客户端稳定订阅
2. 抓取一条真实 `exec.approval.requested` 示例 payload
3. 记录以下字段：
   - `id`
   - `request.command`
   - `request.cwd`
   - `request.host`
   - `request.agentId`
   - `request.sessionKey`
   - `expiresAtMs`
4. 验证审批 `id` 的典型长度
5. 计算以下 callback_data 长度是否小于 64：
   - `/approve <id> allow-once`
   - `/approve <id> allow-always`
   - `/approve <id> deny`
6. 验证 Telegram inline buttons 当前配置是否允许在目标会话中点击并回流到 OpenClaw

### 验收标准

- 能拿到真实审批事件样本
- 能确认 callback_data 是否可直接承载 `/approve ...`
- 能确认目标 Telegram 会话具备 inline button 权限

### 风险

- 如果 callback_data 超长，则 MVP 需要引入“轻量 shim”备选

---

## Phase 1：MVP sidecar

### 目标

实现最小可用的 Telegram 审批消息转发。

### 任务

1. 建立 sidecar 项目骨架
2. 读取 OpenClaw 配置：
   - Gateway URL
   - Gateway token
   - Telegram botToken
3. 建立 Gateway WebSocket 客户端
4. 订阅：
   - `exec.approval.requested`
   - `exec.approval.resolved`
5. 为 `requested` 事件生成 Telegram 审批消息
6. 向固定 Telegram 目标发送消息
7. 记录本地状态映射：
   - approval id
   - chat id
   - message id
   - sent at
   - expires at
8. 对 `resolved` 事件编辑原消息为完成状态

### 消息内容 MVP 版本

- 标题：`Exec Approval Required`
- 命令预览
- 工作目录
- Host
- Agent
- 过期信息
- 审批 ID

### 按钮 MVP 版本

- `Allow once`
- `Always allow`
- `Deny`

### 验收标准

- 真实审批产生时，Telegram 能收到消息
- 点击按钮后能进入 OpenClaw 审批链
- 审批完成消息能更新状态

---

## Phase 2：路由与过滤

### 目标

让审批消息发送到正确的 Telegram 目标，而不是只发固定收件人。

### 任务

1. 设计路由模式：
   - `default-target`
   - `session-or-default`
   - `targets-only`
2. 从 `sessionKey` 解析会话来源
3. 当来源是 Telegram 且合法时，优先回发原会话
4. 当来源不是 Telegram 或无法解析时，回退到默认 Telegram 管理员目标
5. 支持过滤器：
   - `agentIds`
   - `sessionKeyPatterns`

### 验收标准

- Telegram 来源审批能优先回到原 Telegram 对话
- 非 Telegram 来源审批能发到默认管理员 Telegram
- 不匹配过滤条件的审批不会被误推送

---

## Phase 3：状态同步与用户体验

### 目标

让体验更接近原生 `/models` 按钮交互。

### 任务

1. resolved 后更新原按钮消息为完成态
2. expired 后更新原消息为过期态
3. 对重复审批、重复投递做去重
4. 增加更清晰的文案：
   - `Allowed (once)`
   - `Allowed (always)`
   - `Denied`
   - `Expired`
5. 增加 Telegram 通知失败重试
6. 增加 Gateway 断线重连
7. 增加本地日志

### 验收标准

- 重启 sidecar 后不会丢失未完成审批的映射信息
- 网络抖动后可自动恢复
- 相同审批不会重复发多条消息

---

## Phase 4：部署与运维

### 目标

把 sidecar 变成长期稳定运行的用户级服务。

### 任务

1. 增加启动脚本
2. 增加用户级 systemd service
3. 增加示例配置文件
4. 增加 README 使用说明
5. 增加日志查看命令说明
6. 增加升级说明：
   - OpenClaw 升级后 sidecar 无需重装
   - sidecar 单独版本管理

### 建议 systemd 单元

- `openclaw-telegram-approval-sidecar.service`

### 验收标准

- `systemctl --user start openclaw-telegram-approval-sidecar`
- 跟随 `openclaw-gateway.service` 正常运行
- 重启后自动恢复

---

## Phase 5：可选增强

### 可选增强 A：回调超长 shim

仅当 callback_data 64 字节限制挡住 `/approve` 直通时启用。

#### 方案

- sidecar 发送短 token 按钮
- 由一个轻量本地扩展/命令 shim 翻译成 `/approve <full-id> ...`
- 仍然不改 OpenClaw 核心源码

#### 为什么放到可选增强

- 先验证真实审批 id 长度，避免过度设计

### 可选增强 B：多目标审批

- 同时发给：
  - 原 Telegram 会话
  - 管理员私聊
  - 运维群线程

### 可选增强 C：审批卡片更丰富

- 显示 envKeys
- 显示 command argv
- 显示 sessionKey
- 显示 agent 名称与来源渠道

---

## 拟落地文件清单

后续实施时建议新增：

```text
openclaw-telegram-approval-sidecar/
  README.md
  IMPLEMENTATION_PLAN.md
  package.json
  tsconfig.json
  src/
    index.ts
    config.ts
    gateway-client.ts
    telegram-delivery.ts
    approval-store.ts
    approval-router.ts
    renderers/
      approval-message.ts
  config/
    sidecar.example.json
  scripts/
    run-sidecar.sh
  systemd/
    openclaw-telegram-approval-sidecar.service
```

---

## 测试计划

### 单元测试

- 审批消息渲染
- 路由逻辑
- callback_data 长度判断
- 状态存储读写

### 集成测试

- 模拟 Gateway 审批事件
- 模拟 Telegram 发送成功/失败
- 模拟 resolved/expired 更新

### 本机联调

1. 人工制造一条需要审批的 `system.run`
2. 观察 sidecar 是否收到事件
3. 观察 Telegram 是否收到按钮消息
4. 点击 `Allow once`
5. 确认 OpenClaw 审批通过
6. 再次触发审批并点击 `Deny`
7. 确认命令被拒绝

---

## 当前建议执行顺序

1. 完成 Phase 0 前置验证
2. 如果 callback_data 可直接承载 `/approve ...`，立即进入 Phase 1
3. 如果 callback_data 超长，再补“轻量 shim”设计
4. 完成 MVP 后再做 systemd 化与优化

---

## 决策结论

当前最推荐路线仍然是：

- **独立 sidecar 服务**作为主体
- **不修改 OpenClaw 核心源码**
- **尽量直接复用 `/approve` 命令**
- **必要时只增加轻量本地扩展作为兼容层**

这条路线在“升级不丢”“最少维护成本”“体验接近原生 Telegram 按钮”之间平衡最好。
