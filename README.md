# Telegram Approval Sidecar

一个用于 宿主的 **可移植 Telegram 审批插件**。

它的作用是：当 `OpenClaw` 产生 `exec` / `system.run` 一类需要人工确认的审批请求时，自动把审批卡片推送到 Telegram，并允许你直接在 Telegram 里点击中文按钮完成审批。

## 插件定位

本项目当前的正式形态是：

- **OpenClaw 插件**，不是必须单独常驻的外部 sidecar
- 通过 宿主的插件 `service` 生命周期启动，跟随 `openclaw-gateway` 一起运行
- **不修改 OpenClaw 核心源码**
- 默认复用本机 宿主的：
  - Gateway 地址与鉴权
  - Telegram 机器人凭据
  - Telegram 代理配置

本仓库当前以插件形态发布，推荐直接作为宿主插件安装使用。

## 解决的问题

OpenClaw 原生已经具备：

- `exec.approval.requested`
- `exec.approval.resolved`
- `/approve <id> allow-once|allow-always|deny`
- Telegram inline button 回调会把 `callback_data` 继续当作一条文本命令处理

这个插件补上的，是“把审批事件自动发到 Telegram，并渲染成中文按钮审批卡片”的最后一段体验。

## 工作原理

### 事件流

1. `OpenClaw Gateway` 发出 `exec.approval.requested`
2. 插件里的后台 service 通过 WebSocket 订阅到该事件
3. 插件把审批请求渲染成 Telegram 中文卡片
4. 插件调用 Telegram Bot API 发消息
5. 用户在 Telegram 点击按钮：
   - `允许一次`
   - `始终允许`
   - `拒绝`
6. Telegram 把按钮的 `callback_data` 回传给 OpenClaw Telegram 通道
7. OpenClaw 把 `callback_data` 视作文本命令继续处理，例如：
   - `/approve <id> allow-once`
   - `/approve <id> allow-always`
   - `/approve <id> deny`
8. OpenClaw 完成原生审批校验与决策
9. `OpenClaw Gateway` 发出 `exec.approval.resolved`
10. 插件收到 resolved 事件后，回写原 Telegram 消息为完成态

### 责任边界

插件负责：

- 监听审批事件
- 路由审批消息到正确 Telegram 目标
- 生成中文审批卡片和中文按钮
- 保存 `approval id -> chat/message` 映射
- 在审批完成或过期后更新原消息

OpenClaw 继续负责：

- 判定是否需要审批
- 保存审批约束
- 校验审批是否过期
- 执行 `/approve`
- 最终允许或拒绝命令

## 为什么现在推荐做成插件

相比独立 sidecar 进程，插件模式更适合长期使用：

- **部署更简单**：跟随 `openclaw-gateway` 启停
- **配置更统一**：直接复用 `OpenClaw` 配置
- **可移植性更好**：整个仓库可直接作为插件安装
- **升级更稳定**：不需要改 OpenClaw 安装目录
- **运维更简单**：日志集中在 Gateway 服务里

## 当前特性

- 订阅 `exec.approval.requested` 与 `exec.approval.resolved`
- Telegram 中文审批卡片
- Telegram 中文按钮：`允许一次` / `始终允许` / `拒绝`
- 默认优先回发原 Telegram 会话
- 回不到原会话时可回退到管理员 Telegram
- 本地持久化保存审批消息映射
- 审批完成后编辑原消息
- 审批过期后编辑原消息
- Gateway 自动重连
- Telegram API 基础重试
- 自动复用 `宿主的网络代理配置`
- 自动处理 Telegram `callback_data` 64 字节限制：
  - 如果 `/approve ...` 不超长，直接用按钮命令
  - 如果超长，则退回手工审批命令文案

## 中文消息样式

### 审批中

标题：

- `执行审批请求`

按钮：

- `允许一次`
- `始终允许`
- `拒绝`

### 已完成

状态文案：

- `已允许（一次）`
- `已允许（始终）`
- `已拒绝`
- `审批已过期`

## 仓库结构

```text
telegram-approval-sidecar/
  index.ts
  openclaw.plugin.json
  package.json
  README.md
  src/
    service.ts
    config.ts
    gateway-client.ts
    telegram-delivery.ts
    approval-router.ts
    approval-store.ts
    types.ts
    renderers/
      approval-message.ts
```

核心入口：

- 插件入口：`index.ts:1`
- 后台 service：`src/service.ts:12`
- 配置解析：`src/config.ts:31`
- Telegram 发送：`src/telegram-delivery.ts:8`
- 中文卡片渲染：`src/renderers/approval-message.ts:14`

## 安装方式

### 方式一：本地开发链接安装

适合你现在这种本地仓库直接接入 OpenClaw。

```bash
cd /path/to/telegram-approval-sidecar
openclaw plugins install -l .
openclaw gateway restart
```

### 方式二：本地目录安装（复制）

```bash
openclaw plugins install /path/to/telegram-approval-sidecar
openclaw gateway restart
```

### 方式三：作为可移植插件目录搬运

只要把整个插件目录拷走，并确保包含以下文件即可：

- `index.ts`
- 插件清单
- 包清单
- `src/`

然后在目标机器执行：

```bash
openclaw plugins install /path/to/telegram-approval-sidecar
openclaw gateway restart
```

## 使用方法

安装并重启 Gateway 后，插件会自动生效。

当 OpenClaw 产生审批事件时：

1. Telegram 收到中文审批卡片
2. 你直接点按钮
3. OpenClaw 原生审批链完成处理
4. 原消息被回写为最终状态

你不需要单独运行插件命令。

## 配置方法

插件配置写在 `OpenClaw` 主配置里：

```json5
{
  plugins: {
    entries: {
      "telegram-approval-sidecar": {
        enabled: true,
        config: {
          defaultTarget: "<TELEGRAM_TARGET>",
          routingMode: "session-or-default",
          fallbackTarget: "<TELEGRAM_TARGET>",
          agentIds: ["main", "coder", "company"]
        }
      }
    }
  }
}
```

### 配置字段说明

- `defaultTarget`
  - 默认 Telegram 目标 chat id
- `threadId`
  - 默认 Telegram 话题 id
- `routingMode`
  - 路由模式：
    - `default-target`
    - `session-or-default`
    - `targets-only`
- `fallbackTarget`
  - 回退 Telegram 目标
- `agentIds`
  - 允许转发的 agent id 白名单
- `sessionKeyPatterns`
  - sessionKey 正则过滤器
- `requestTimeoutMs`
  - Telegram 请求超时
- `retryCount`
  - Telegram 重试次数
- `retryBaseMs`
  - Telegram 重试退避基准
- `reconnectBaseMs`
  - Gateway 重连基准
- `reconnectMaxMs`
  - Gateway 最大重连等待
- `networkProxyUrl`
  - Telegram 出站代理 URL
- `gatewayUrl`
  - 手工覆盖 Gateway URL
- `gatewayCredential`
  - 手工覆盖 Gateway 凭据
- `gatewayPassphrase`
  - 手工覆盖 Gateway 口令
- `botCredential`
  - 手工覆盖 Telegram 机器人凭据
- `accountId`
  - 使用指定 Telegram account 配置

## 默认配置复用逻辑

插件会优先复用宿主已有的连接信息、消息通道凭据与网络代理设置，不需要在插件仓库里保存任何真实系统路径或敏感值。

若插件配置未显式填写，插件会自动尝试复用：

1. 宿主的 Gateway 配置
2. 宿主的 Telegram 配置
3. 环境变量中的 凭据 / 网络代理

重点包括：

- `宿主网关鉴权项`
- `宿主远端网关鉴权项`
- `channels.telegram.botCredential`
- `宿主 Telegram 凭据项`
- `宿主的网络代理配置`
- `宿主网关环境凭据`
- `宿主 Telegram 环境凭据`

## 路由逻辑

### `session-or-default`

推荐默认值。

逻辑：

- 如果审批本来来自 Telegram 会话，则优先回发原会话
- 如果无法解析原 Telegram 会话，则发给 `fallbackTarget`

### `default-target`

逻辑：

- 无论审批从哪里来，都统一发到 `defaultTarget`

### `targets-only`

逻辑：

- 只能发回可解析的 Telegram 原会话
- 如果无法解析原会话，则不发送

## 持久化与状态

插件会本地保存审批映射状态，用于：

- 避免重复投递
- resolved 时回写原消息
- expired 时回写原消息
- Gateway 重启后保留消息映射

插件模式默认状态文件位置：

- `OpenClaw 插件运行状态文件`

## 调试与排障

### 查看插件是否已加载

```bash
openclaw plugins info telegram-approval-sidecar
```

### 查看 Gateway 日志

```bash
journalctl --user -u openclaw-gateway.service -f
```

你应该能看到类似日志：

- `配置来源: plugin-config`
- `已连接 OpenClaw Gateway`
- `已转发审批 ... 到 Telegram ...`

### 常见问题

#### 1. Telegram 没收到审批消息

优先检查：

- `channels.telegram.botCredential` 是否有效
- 机器人是否能给目标 chat 发消息
- `defaultTarget` / `fallbackTarget` 是否正确
- 是否需要代理，且 `宿主的网络代理配置` 是否可用

#### 2. 按钮点了没反应

优先检查：

- OpenClaw 的 Telegram 通道是否正常在线
- 当前 Telegram 用户是否有权限执行 `/approve`
- OpenClaw 是否已启用 `operator.approvals` 审批链

#### 3. 消息发出但没有回写完成态

优先检查：

- `exec.approval.resolved` 是否产生
- 插件状态文件是否保存了该 `approval id`
- Telegram 编辑消息是否被网络/代理阻断

## 验收标准

一个成功的完整链路应该表现为：

1. OpenClaw 产生审批
2. Telegram 收到中文审批卡片
3. 点击中文按钮
4. OpenClaw 完成原生审批
5. Telegram 原消息更新为中文完成态

## 非目标

本插件**不**负责：

- 绕过 OpenClaw 原生审批
- 修改 OpenClaw 核心审批逻辑
- 替代 `/approve` 命令
- 篡改审批 id / 超时 / session 绑定

## 后续可增强方向

- 多目标同时通知（原会话 + 管理员）
- 更丰富的审批卡片字段
- callback_data 超长时的短 凭据 shim
- 更细粒度的 agent / session / target 路由规则

