import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RuntimeConfig } from "./types.js";

type JsonObject = Record<string, unknown>;
type AnyConfig = Record<string, any>;

export function buildRuntimeConfigFromPlugin(params: {
  openclawConfig: AnyConfig;
  pluginConfig?: Record<string, unknown>;
  stateFile?: string;
}): RuntimeConfig {
  const stateFile = params.stateFile ?? path.join(resolveDefaultPluginStateDir(), "approval-state.json");

  return buildRuntimeConfig({
    openclawConfig: params.openclawConfig,
    sidecarConfig: params.pluginConfig ?? {},
    sourceLabel: "plugin-config",
    stateFile,
  });
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function expandHome(inputPath: string): string {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

export function resolveDefaultPluginStateDir(): string {
  return path.join(os.tmpdir(), "telegram-approval-sidecar");
}

function buildRuntimeConfig(params: {
  openclawConfig: AnyConfig;
  sidecarConfig: AnyConfig;
  sourceLabel: string;
  stateFile: string;
}): RuntimeConfig {
  const { openclawConfig, sidecarConfig, sourceLabel, stateFile } = params;
  const telegramAccountId = readString(sidecarConfig.accountId ?? sidecarConfig.telegram?.accountId) ?? null;
  const openclawTelegramConfig = getOpenClawTelegramConfig(openclawConfig, telegramAccountId);
  const gatewayPort = readNumber(openclawConfig.gateway?.port) ?? 18789;
  const rawGatewayUrl =
    readString(sidecarConfig.gatewayUrl)
    ?? readString(sidecarConfig.gateway?.url)
    ?? readString(openclawConfig.gateway?.remote?.url)
    ?? `ws://127.0.0.1:${gatewayPort}`;

  const defaultTarget =
    readString(sidecarConfig.defaultTarget)
    ?? readString(sidecarConfig.telegram?.defaultTarget)
    ?? readString(sidecarConfig.routing?.fallbackTarget)
    ?? normalizeAllowTarget(openclawTelegramConfig.allowFrom?.[0])
    ?? null;

  const botToken =
    readString(sidecarConfig.botCredential) ?? readString(sidecarConfig.botToken)
    ?? readString(sidecarConfig.telegram?.botToken)
    ?? readString(openclawTelegramConfig.botToken)
    ?? readTokenFile(readString(openclawTelegramConfig.tokenFile));

  if (!botToken) {
    throw new Error("Telegram 机器人凭据缺失，请在宿主 Telegram 配置或插件配置中提供。");
  }

  return {
    sourceLabel,
    gateway: {
      url: normalizeWsUrl(rawGatewayUrl),
      token:
        readString(sidecarConfig.gatewayCredential) ?? readString(sidecarConfig.gatewayToken)
        ?? readString(sidecarConfig.gateway?.token)
        ?? readString(openclawConfig.gateway?.auth?.token)
        ?? readString(openclawConfig.gateway?.remote?.token)
        ?? null,
      password:
        readString(sidecarConfig.gatewayPassphrase) ?? readString(sidecarConfig.gatewayPassword)
        ?? readString(sidecarConfig.gateway?.password)
        ?? readString(openclawConfig.gateway?.auth?.password)
        ?? readString(openclawConfig.gateway?.remote?.password)
        ?? null,
      reconnectBaseMs: clamp(readNumber(sidecarConfig.reconnectBaseMs ?? sidecarConfig.gateway?.reconnectBaseMs) ?? 1_000, 250, 60_000),
      reconnectMaxMs: clamp(readNumber(sidecarConfig.reconnectMaxMs ?? sidecarConfig.gateway?.reconnectMaxMs) ?? 15_000, 1_000, 300_000),
    },
    telegram: {
      botToken,
      defaultTarget,
      threadId: normalizeThreadId(sidecarConfig.threadId ?? sidecarConfig.telegram?.threadId),
      apiBaseUrl: readString(sidecarConfig.apiBaseUrl ?? sidecarConfig.telegram?.apiBaseUrl) ?? "https://api.telegram.org",
      requestTimeoutMs: clamp(readNumber(sidecarConfig.requestTimeoutMs ?? sidecarConfig.telegram?.requestTimeoutMs) ?? 15_000, 1_000, 120_000),
      retryCount: clamp(readNumber(sidecarConfig.retryCount ?? sidecarConfig.telegram?.retryCount) ?? 3, 0, 10),
      retryBaseMs: clamp(readNumber(sidecarConfig.retryBaseMs ?? sidecarConfig.telegram?.retryBaseMs) ?? 750, 100, 30_000),
      accountId: telegramAccountId,
      proxyUrl:
        readString(sidecarConfig.networkProxyUrl) ?? readString(sidecarConfig.proxyUrl)
        ?? readString(sidecarConfig.telegram?.proxyUrl)
        ?? readString(openclawTelegramConfig.proxy)
        ?? null,
    },
    routing: {
      mode: normalizeRoutingMode(readString(sidecarConfig.routingMode ?? sidecarConfig.routing?.mode)),
      fallbackTarget:
        readString(sidecarConfig.fallbackTarget)
        ?? readString(sidecarConfig.routing?.fallbackTarget)
        ?? defaultTarget,
    },
    filters: {
      agentIds: normalizeStringArray(sidecarConfig.agentIds ?? sidecarConfig.filters?.agentIds),
      sessionKeyPatterns: normalizeStringArray(sidecarConfig.sessionKeyPatterns ?? sidecarConfig.filters?.sessionKeyPatterns),
    },
    storage: {
      stateFile,
    },
  };
}

function readTokenFile(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const resolved = expandHome(filePath);
  if (!fs.existsSync(resolved)) {
    return null;
  }

  const raw = fs.readFileSync(resolved, "utf8").trim();
  return raw || null;
}

function getOpenClawTelegramConfig(openclawConfig: AnyConfig, accountId: string | null): AnyConfig {
  const root = isPlainObject(openclawConfig.channels) && isPlainObject(openclawConfig.channels.telegram)
    ? openclawConfig.channels.telegram as AnyConfig
    : {};
  const accounts = isPlainObject(root.accounts) ? root.accounts as AnyConfig : {};

  if (accountId && isPlainObject(accounts[accountId])) {
    return {
      ...root,
      ...accounts[accountId],
    };
  }

  return root;
}

function normalizeAllowTarget(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  return readString(value);
}

function normalizeWsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  return parsed.toString();
}

function normalizeRoutingMode(value: string | null): RuntimeConfig["routing"]["mode"] {
  if (value === "default-target" || value === "session-or-default" || value === "targets-only") {
    return value;
  }

  return "session-or-default";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeThreadId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
