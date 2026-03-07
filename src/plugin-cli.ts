import { buildRuntimeConfigFromPlugin, resolveDefaultPluginStateDir } from "./config.js";
import { TelegramDelivery } from "./telegram-delivery.js";
import type { LoggerLike } from "./types.js";

export function registerTelegramApprovalCli(params: {
  program: any;
  openclawConfig: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  logger: LoggerLike;
}) {
  const { program, openclawConfig, pluginConfig, logger } = params;
  const root = program
    .command("approval-telegram")
    .description("Telegram 审批插件工具")
    .addHelpText("after", () => "\n示例:\n  openclaw approval-telegram status\n  openclaw approval-telegram self-test\n  openclaw approval-telegram self-test --send\n");

  root
    .command("status")
    .description("显示插件当前生效配置摘要")
    .action(() => {
      const config = resolveCliRuntimeConfig({ openclawConfig, pluginConfig });
      console.log(JSON.stringify(summarizeConfig(config), null, 2));
    });

  root
    .command("self-test")
    .description("执行插件自检，可选发送一条 Telegram 测试消息")
    .option("--send", "发送 Telegram 测试消息", false)
    .option("--target <chatId>", "覆盖测试消息目标")
    .action(async (options: { send?: boolean; target?: string }) => {
      const config = resolveCliRuntimeConfig({ openclawConfig, pluginConfig });
      const summary = summarizeConfig(config);
      const checks = {
        gatewayUrl: Boolean(config.gateway.url),
        gatewayCredential: Boolean(config.gateway.token || config.gateway.password),
        botCredential: Boolean(config.telegram.botToken),
        telegramTarget: Boolean(options.target || config.telegram.defaultTarget || config.routing.fallbackTarget),
      };

      console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), checks, summary }, null, 2));

      if (!options.send) {
        return;
      }

      const target = options.target?.trim() || config.telegram.defaultTarget || config.routing.fallbackTarget;
      if (!target) {
        throw new Error("没有可用的 Telegram 目标；请补充插件目标配置或传入 --target。");
      }

      const telegram = new TelegramDelivery(config);
      const now = new Date().toLocaleString("zh-CN", { hour12: false });
      const sent = await telegram.sendMessage(
        { chatId: target, threadId: config.telegram.threadId, source: "default" },
        {
          text: `<b>Telegram 审批插件自检成功</b>\n\n<b>时间</b> ${now}\n<b>目标</b> <code>${target}</code>\n<b>模式</b> 插件 CLI 自检`,
        },
      );

      logger.info(`[telegram-approval-sidecar] self-test 已发送测试消息 (messageId=${sent.messageId})`);
      console.log(JSON.stringify({ sent: true, messageId: sent.messageId }, null, 2));
    });
}

function resolveCliRuntimeConfig(params: {
  openclawConfig: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
}) {
  return buildRuntimeConfigFromPlugin({
    openclawConfig: params.openclawConfig,
    pluginConfig: params.pluginConfig,
    stateFile: `${resolveDefaultPluginStateDir()}/approval-state.json`,
  });
}

function summarizeConfig(config: ReturnType<typeof resolveCliRuntimeConfig>) {
  return {
    gatewayUrl: config.gateway.url,
    hasGatewayCredential: Boolean(config.gateway.token),
    hasGatewayPassphrase: Boolean(config.gateway.password),
    hasBotCredential: Boolean(config.telegram.botToken),
    defaultTarget: config.telegram.defaultTarget,
    fallbackTarget: config.routing.fallbackTarget,
    routingMode: config.routing.mode,
    networkProxyUrl: config.telegram.proxyUrl,
    accountId: config.telegram.accountId,
    agentIds: config.filters.agentIds,
    sessionKeyPatterns: config.filters.sessionKeyPatterns,
  };
}
