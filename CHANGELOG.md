# Changelog

## Unreleased

- 默认审批状态文件改为持久化目录 `~/.local/state/openclaw-telegram-approval-sidecar/approval-state.json`
- 新增 `stateFile` 插件配置项、配置示例和 CLI 状态输出
- 避免默认把审批映射写到系统临时目录，减少重启或清理 `/tmp` 后状态丢失

## 0.3.0 - 2026-03-07

- 正式收尾为可移植 `OpenClaw` 插件，不再以独立 sidecar 作为推荐部署方式
- 新增插件后台 `service`，跟随 `openclaw-gateway` 生命周期启动和停止
- 新增中文审批卡片与中文按钮：`允许一次` / `始终允许` / `拒绝`
- 新增审批完成态与过期态中文文案
- 新增 Telegram 审批路由、状态持久化、消息回写和过期处理
- 新增自动复用宿主连接信息、消息通道凭据与网络代理的配置逻辑
- 新增插件配置示例文件 `config/plugin-config.example.json5`
- 新增插件 CLI 自检命令：
  - `openclaw approval-telegram status`
  - `openclaw approval-telegram self-test`
  - `openclaw approval-telegram self-test --send`
- 重写 README，补充原理说明、事件流、配置方法、排障方法与可移植安装说明

## 0.2.0 - 2026-03-07

- 初步实现 Telegram 审批转发 MVP
- 支持通过 Gateway 监听审批请求与审批完成事件
- 支持 Telegram inline keyboard 审批按钮
- 支持独立 sidecar 运行模式
