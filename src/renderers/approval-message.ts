import type {
  ApprovalDecision,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  RenderedTelegramMessage,
  StoredApprovalRecord,
  TelegramReplyMarkup,
} from "../types.js";

const TELEGRAM_CALLBACK_LIMIT_BYTES = 64;
const COMMAND_PREVIEW_LIMIT = 900;
const PATH_PREVIEW_LIMIT = 180;

export function renderRequestedApproval(event: ApprovalRequestedEvent): RenderedTelegramMessage {
  const buttons = buildApprovalKeyboard(event.id);
  const lines = [
    "<b>执行审批请求</b>",
    "",
    `<b>命令：</b>\n<code>${escapeHtml(truncate(event.request.command ?? "<缺失>", COMMAND_PREVIEW_LIMIT))}</code>`,
    `<b>工作目录：</b>\n<code>${escapeHtml(truncate(event.request.cwd ?? "<未知>", PATH_PREVIEW_LIMIT))}</code>`,
    `<b>主机：</b> ${escapeHtml(event.request.host ?? "<未知>")}`,
    `<b>Agent：</b> ${escapeHtml(event.request.agentId ?? "<未知>")}`,
    `<b>过期时间：</b> ${escapeHtml(formatAbsoluteTime(event.expiresAtMs))}（${escapeHtml(formatRelativeMs(event.expiresAtMs - Date.now()))}）`,
    `<b>审批 ID：</b> <code>${escapeHtml(event.id)}</code>`,
  ];

  if (!buttons) {
    lines.push(
      "",
      "<b>手动审批：</b>",
      `<code>/approve ${escapeHtml(event.id)} allow-once</code>`,
      `<code>/approve ${escapeHtml(event.id)} allow-always</code>`,
      `<code>/approve ${escapeHtml(event.id)} deny</code>`,
    );
  }

  return {
    text: lines.join("\n"),
    ...(buttons ? { replyMarkup: buttons } : {}),
  };
}

export function renderResolvedApproval(
  record: StoredApprovalRecord,
  event: ApprovalResolvedEvent,
): RenderedTelegramMessage {
  return {
    text: [
      `<b>${escapeHtml(resolveDecisionLabel(event.decision))}</b>`,
      "",
      `<b>命令：</b>\n<code>${escapeHtml(truncate(record.request.command ?? "<缺失>", COMMAND_PREVIEW_LIMIT))}</code>`,
      `<b>工作目录：</b>\n<code>${escapeHtml(truncate(record.request.cwd ?? "<未知>", PATH_PREVIEW_LIMIT))}</code>`,
      `<b>主机：</b> ${escapeHtml(record.request.host ?? "<未知>")}`,
      `<b>Agent：</b> ${escapeHtml(record.request.agentId ?? "<未知>")}`,
      `<b>审批 ID：</b> <code>${escapeHtml(record.approvalId)}</code>`,
      `<b>处理人：</b> ${escapeHtml(event.resolvedBy ?? "<未知>")}`,
      `<b>处理时间：</b> ${escapeHtml(formatAbsoluteTime(event.ts))}`,
    ].join("\n"),
  };
}

export function renderExpiredApproval(record: StoredApprovalRecord): RenderedTelegramMessage {
  return {
    text: [
      "<b>审批已过期</b>",
      "",
      `<b>命令：</b>\n<code>${escapeHtml(truncate(record.request.command ?? "<缺失>", COMMAND_PREVIEW_LIMIT))}</code>`,
      `<b>工作目录：</b>\n<code>${escapeHtml(truncate(record.request.cwd ?? "<未知>", PATH_PREVIEW_LIMIT))}</code>`,
      `<b>主机：</b> ${escapeHtml(record.request.host ?? "<未知>")}`,
      `<b>Agent：</b> ${escapeHtml(record.request.agentId ?? "<未知>")}`,
      `<b>审批 ID：</b> <code>${escapeHtml(record.approvalId)}</code>`,
      `<b>过期时间：</b> ${escapeHtml(formatAbsoluteTime(record.expiresAtMs))}`,
    ].join("\n"),
  };
}

function buildApprovalKeyboard(approvalId: string): TelegramReplyMarkup | undefined {
  const allowOnce = `/approve ${approvalId} allow-once`;
  const allowAlways = `/approve ${approvalId} allow-always`;
  const deny = `/approve ${approvalId} deny`;

  const callbacks = [allowOnce, allowAlways, deny];
  if (callbacks.some((entry) => Buffer.byteLength(entry, "utf8") > TELEGRAM_CALLBACK_LIMIT_BYTES)) {
    return undefined;
  }

  return {
    inline_keyboard: [
      [
        { text: "允许一次", callback_data: allowOnce },
        { text: "始终允许", callback_data: allowAlways },
      ],
      [{ text: "拒绝", callback_data: deny }],
    ],
  };
}

function resolveDecisionLabel(decision: ApprovalDecision): string {
  switch (decision) {
    case "allow-once":
      return "已允许（一次）";
    case "allow-always":
      return "已允许（始终）";
    case "deny":
      return "已拒绝";
  }
}

function formatAbsoluteTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function formatRelativeMs(deltaMs: number): string {
  if (deltaMs <= 0) {
    return "已过期";
  }

  const totalSeconds = Math.ceil(deltaMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);
  return `${parts.join(" ")}后过期`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
