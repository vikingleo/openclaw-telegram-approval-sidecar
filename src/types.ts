export type ApprovalDecision = "allow-once" | "allow-always" | "deny";

export type ApprovalStatus = "pending" | "resolved" | "expired";

export interface ApprovalRequest {
  command?: string | null;
  cwd?: string | null;
  host?: string | null;
  security?: unknown;
  ask?: unknown;
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
  turnSourceChannel?: string | null;
  turnSourceTo?: string | null;
  turnSourceAccountId?: string | null;
  turnSourceThreadId?: string | number | null;
  nodeId?: string | null;
  systemRunPlan?: unknown;
}

export interface ApprovalRequestedEvent {
  id: string;
  request: ApprovalRequest;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface ApprovalResolvedEvent {
  id: string;
  decision: ApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
  request?: ApprovalRequest;
}

export interface TelegramTarget {
  chatId: string;
  threadId: number | null;
  source: "session" | "default";
}

export interface StoredApprovalRecord {
  approvalId: string;
  status: ApprovalStatus;
  chatId: string;
  threadId: number | null;
  messageId: number;
  createdAtMs: number;
  expiresAtMs: number;
  sentAtMs: number;
  routeSource: "session" | "default";
  request: ApprovalRequest;
  decision?: ApprovalDecision;
  resolvedBy?: string | null;
  resolvedAtMs?: number;
  expiredAtMs?: number;
}

export interface ApprovalStateFile {
  version: 1;
  approvals: Record<string, StoredApprovalRecord>;
}

export interface RuntimeConfig {
  sourceLabel: string;
  gateway: {
    url: string;
    token: string | null;
    password: string | null;
    reconnectBaseMs: number;
    reconnectMaxMs: number;
  };
  telegram: {
    botToken: string;
    defaultTarget: string | null;
    threadId: number | null;
    apiBaseUrl: string;
    requestTimeoutMs: number;
    retryCount: number;
    retryBaseMs: number;
    accountId: string | null;
    proxyUrl: string | null;
  };
  routing: {
    mode: "default-target" | "session-or-default" | "targets-only";
    fallbackTarget: string | null;
  };
  filters: {
    agentIds: string[];
    sessionKeyPatterns: string[];
  };
  storage: {
    stateFile: string;
  };
}

export interface SendMessageResult {
  messageId: number;
}

export interface RenderedTelegramMessage {
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export type TelegramReplyMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export interface LoggerLike {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
}
