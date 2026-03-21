import type { OpenClawPluginApi, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";

import { buildRuntimeConfigFromPlugin } from "./src/config.js";
import { registerTelegramApprovalCli } from "./src/plugin-cli.js";
import { ApprovalForwarderService } from "./src/service.js";
import type { LoggerLike } from "./src/types.js";

let runtimeService: ApprovalForwarderService | null = null;

const plugin = {
  id: "telegram-approval-sidecar",
  name: "Telegram Approval Sidecar",
  description: "将 exec 审批请求转发到 Telegram，并在消息内按钮审批。",
  register(api: OpenClawPluginApi) {
    api.registerCli(
      ({ program }) => {
        registerTelegramApprovalCli({
          program,
          openclawConfig: api.config as Record<string, unknown>,
          pluginConfig: api.pluginConfig,
          logger: {
            info: (message) => api.logger.info(message),
            warn: (message) => api.logger.warn(message),
            error: (message) => api.logger.error(message),
            debug: (message) => api.logger.debug?.(message),
          },
        });
      },
      { commands: ["approval-telegram"] },
    );

    api.registerService({
      id: "telegram-approval-sidecar",
      start: async (ctx: OpenClawPluginServiceContext) => {
        if (runtimeService) {
          return;
        }

        const config = buildRuntimeConfigFromPlugin({
          openclawConfig: api.config as Record<string, unknown>,
          pluginConfig: api.pluginConfig,
        });
        const logger: LoggerLike = {
          info: (message) => api.logger.info(message),
          warn: (message) => api.logger.warn(message),
          error: (message) => api.logger.error(message),
          debug: (message) => api.logger.debug?.(message),
        };

        runtimeService = new ApprovalForwarderService({
          config,
          logger,
          version: api.version ?? "0.3.0",
        });
        runtimeService.start();
      },
      stop: async () => {
        runtimeService?.stop();
        runtimeService = null;
      },
    });
  },
};

export default plugin;
