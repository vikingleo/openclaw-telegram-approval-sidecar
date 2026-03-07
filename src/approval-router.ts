import type { ApprovalRequestedEvent, RuntimeConfig, TelegramTarget } from "./types.js";

export function shouldForwardApproval(event: ApprovalRequestedEvent, config: RuntimeConfig): boolean {
  if (config.filters.agentIds.length > 0) {
    const agentId = event.request.agentId?.trim();
    if (!agentId || !config.filters.agentIds.includes(agentId)) {
      return false;
    }
  }

  if (config.filters.sessionKeyPatterns.length > 0) {
    const sessionKey = event.request.sessionKey?.trim() ?? "";
    if (!sessionKey) {
      return false;
    }

    const matched = config.filters.sessionKeyPatterns.some((pattern) => {
      try {
        return new RegExp(pattern).test(sessionKey);
      } catch {
        return false;
      }
    });

    if (!matched) {
      return false;
    }
  }

  return true;
}

export function resolveApprovalTarget(event: ApprovalRequestedEvent, config: RuntimeConfig): TelegramTarget | null {
  if (config.routing.mode !== "default-target") {
    const sessionTarget = resolveTargetFromRequest(event);
    if (sessionTarget) {
      return sessionTarget;
    }

    if (config.routing.mode === "targets-only") {
      return null;
    }
  }

  return resolveFallbackTarget(config);
}

function resolveTargetFromRequest(event: ApprovalRequestedEvent): TelegramTarget | null {
  const request = event.request;
  if (request.turnSourceChannel?.trim().toLowerCase() !== "telegram") {
    return null;
  }

  const baseTarget = parseTelegramTarget(request.turnSourceTo ?? "");
  if (!baseTarget) {
    return null;
  }

  const threadId = normalizeThreadId(request.turnSourceThreadId) ?? baseTarget.threadId;
  return {
    chatId: baseTarget.chatId,
    threadId,
    source: "session",
  };
}

function resolveFallbackTarget(config: RuntimeConfig): TelegramTarget | null {
  const fallback = config.routing.fallbackTarget ?? config.telegram.defaultTarget;
  if (!fallback) {
    return null;
  }

  const parsed = parseTelegramTarget(fallback);
  if (!parsed) {
    return null;
  }

  return {
    chatId: parsed.chatId,
    threadId: parsed.threadId ?? config.telegram.threadId,
    source: "default",
  };
}

function parseTelegramTarget(raw: string): { chatId: string; threadId: number | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const withPrefix = trimmed.match(/^telegram:(-?\d+)(?::topic:(\d+))?$/i);
  if (withPrefix) {
    return {
      chatId: withPrefix[1],
      threadId: normalizeThreadId(withPrefix[2]),
    };
  }

  const plainTopic = trimmed.match(/^(-?\d+):topic:(\d+)$/i);
  if (plainTopic) {
    return {
      chatId: plainTopic[1],
      threadId: normalizeThreadId(plainTopic[2]),
    };
  }

  if (/^-?\d+$/.test(trimmed)) {
    return {
      chatId: trimmed,
      threadId: null,
    };
  }

  return null;
}

function normalizeThreadId(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  return null;
}
