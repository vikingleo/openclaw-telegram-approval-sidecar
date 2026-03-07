import { ApprovalStore } from "./approval-store.js";
import { resolveApprovalTarget, shouldForwardApproval } from "./approval-router.js";
import { GatewayClient } from "./gateway-client.js";
import {
  renderExpiredApproval,
  renderRequestedApproval,
  renderResolvedApproval,
} from "./renderers/approval-message.js";
import { TelegramDelivery } from "./telegram-delivery.js";
import type { LoggerLike, RuntimeConfig } from "./types.js";

export class ApprovalForwarderService {
  private readonly config: RuntimeConfig;

  private readonly logger: LoggerLike;

  private readonly version: string;

  private readonly store: ApprovalStore;

  private readonly telegram: TelegramDelivery;

  private readonly gateway: GatewayClient;

  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(params: { config: RuntimeConfig; logger: LoggerLike; version: string }) {
    this.config = params.config;
    this.logger = params.logger;
    this.version = params.version;
    this.store = new ApprovalStore(this.config.storage.stateFile);
    this.telegram = new TelegramDelivery(this.config);
    this.gateway = new GatewayClient(this.config, this.version);
  }

  start(): void {
    this.logger.info(`[telegram-approval-sidecar] 配置来源: ${this.config.sourceLabel}`);
    this.logger.info(`[telegram-approval-sidecar] 后台转发服务已启动`);

    this.gateway.on("connected", () => {
      this.logger.info("[telegram-approval-sidecar] 已连接 OpenClaw Gateway");
    });

    this.gateway.on("disconnected", (reason) => {
      this.logger.warn(`[telegram-approval-sidecar] Gateway 已断开: ${reason}`);
    });

    this.gateway.on("error", (error) => {
      this.logger.error(`[telegram-approval-sidecar] ${error.message}`);
    });

    this.gateway.on("requested", async (event) => {
      try {
        if (!shouldForwardApproval(event, this.config)) {
          return;
        }

        const existing = this.store.get(event.id);
        if (existing?.status === "pending") {
          this.logger.info(`[telegram-approval-sidecar] 跳过重复审批: ${event.id}`);
          return;
        }

        const target = resolveApprovalTarget(event, this.config);
        if (!target) {
          this.logger.warn(`[telegram-approval-sidecar] 审批 ${event.id} 未解析出 Telegram 目标`);
          return;
        }

        const rendered = renderRequestedApproval(event);
        const result = await this.telegram.sendMessage(target, rendered);
        this.store.upsert({
          approvalId: event.id,
          status: "pending",
          chatId: target.chatId,
          threadId: target.threadId,
          messageId: result.messageId,
          createdAtMs: event.createdAtMs,
          expiresAtMs: event.expiresAtMs,
          sentAtMs: Date.now(),
          routeSource: target.source,
          request: event.request,
        });
        this.logger.info(`[telegram-approval-sidecar] 已转发审批 ${event.id} 到 Telegram ${target.chatId}`);
      } catch (error) {
        this.logger.error(`[telegram-approval-sidecar] 处理 requested 失败: ${String(error)}`);
      }
    });

    this.gateway.on("resolved", async (event) => {
      try {
        const record = this.store.get(event.id);
        if (!record) {
          this.logger.warn(`[telegram-approval-sidecar] resolved 审批 ${event.id} 没有本地映射`);
          return;
        }

        await this.telegram.editMessage(
          {
            chatId: record.chatId,
            threadId: record.threadId,
            source: record.routeSource,
          },
          record.messageId,
          renderResolvedApproval(record, event),
        );

        this.store.update(event.id, (current) => ({
          ...current,
          status: "resolved",
          decision: event.decision,
          resolvedBy: event.resolvedBy ?? null,
          resolvedAtMs: event.ts,
        }));
        this.logger.info(`[telegram-approval-sidecar] 审批 ${event.id} 已处理为 ${event.decision}`);
      } catch (error) {
        this.logger.error(`[telegram-approval-sidecar] 处理 resolved 失败: ${String(error)}`);
      }
    });

    this.expiryTimer = setInterval(() => {
      this.processExpired().catch((error) => {
        this.logger.error(`[telegram-approval-sidecar] 处理过期审批失败: ${String(error)}`);
      });
    }, 15_000);
    this.expiryTimer.unref?.();

    this.gateway.start();
  }

  stop(): void {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    this.gateway.stop();
  }

  private async processExpired(): Promise<void> {
    const expired = this.store.listExpiredPending(Date.now());
    for (const record of expired) {
      try {
        await this.telegram.editMessage(
          {
            chatId: record.chatId,
            threadId: record.threadId,
            source: record.routeSource,
          },
          record.messageId,
          renderExpiredApproval(record),
        );
      } catch (error) {
        this.logger.error(`[telegram-approval-sidecar] 更新过期消息失败 ${record.approvalId}: ${String(error)}`);
      } finally {
        this.store.update(record.approvalId, (current) => ({
          ...current,
          status: "expired",
          expiredAtMs: Date.now(),
        }));
      }
    }
  }
}
