import os from "node:os";
import crypto from "node:crypto";
import EventEmitter from "node:events";
import WebSocket from "ws";

import type { ApprovalRequestedEvent, ApprovalResolvedEvent, RuntimeConfig } from "./types.js";

const PROTOCOL_VERSION = 3;

interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
}

type GatewayFrame = ResponseFrame | EventFrame;

export interface GatewayClientEvents {
  requested: [ApprovalRequestedEvent];
  resolved: [ApprovalResolvedEvent];
  connected: [];
  disconnected: [string];
  error: [Error];
}

export class GatewayClient extends EventEmitter<GatewayClientEvents> {
  private readonly config: RuntimeConfig;

  private readonly version: string;

  private socket: WebSocket | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private reconnectAttempt = 0;

  private shouldStop = false;

  private connectRequestId: string | null = null;

  constructor(config: RuntimeConfig, version: string) {
    super();
    this.config = config;
    this.version = version;
  }

  start(): void {
    this.shouldStop = false;
    this.connect();
  }

  stop(): void {
    this.shouldStop = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    const socket = new WebSocket(this.config.gateway.url);
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.connectRequestId = crypto.randomUUID();
      this.send({
        type: "req",
        id: this.connectRequestId,
        method: "connect",
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          role: "operator",
          scopes: ["operator.approvals"],
          client: {
            id: "gateway-client",
            displayName: "Telegram Approval Sidecar",
            version: this.version,
            platform: `${os.platform()}-${os.release()}`,
            mode: "backend",
            instanceId: os.hostname(),
          },
          auth: {
            ...(this.config.gateway.token ? { token: this.config.gateway.token } : {}),
            ...(this.config.gateway.password ? { password: this.config.gateway.password } : {}),
          },
        },
      });
    });

    socket.on("message", (buffer) => {
      try {
        const frame = JSON.parse(buffer.toString("utf8")) as GatewayFrame;
        this.handleFrame(frame);
      } catch (error) {
        this.emit("error", toError(error));
      }
    });

    socket.on("close", (code, reasonBuffer) => {
      const reason = reasonBuffer.toString("utf8") || `close code ${code}`;
      this.emit("disconnected", reason);
      this.socket = null;
      if (!this.shouldStop) {
        this.scheduleReconnect();
      }
    });

    socket.on("error", (error) => {
      this.emit("error", toError(error));
    });
  }

  private handleFrame(frame: GatewayFrame): void {
    if (frame.type === "res") {
      if (frame.id === this.connectRequestId) {
        if (!frame.ok) {
          const message = frame.error?.message ?? "Gateway connect failed";
          throw new Error(message);
        }

        this.emit("connected");
      }
      return;
    }

    if (frame.type !== "event") {
      return;
    }

    if (frame.event === "exec.approval.requested") {
      this.emit("requested", frame.payload as ApprovalRequestedEvent);
      return;
    }

    if (frame.event === "exec.approval.resolved") {
      this.emit("resolved", frame.payload as ApprovalResolvedEvent);
    }
  }

  private scheduleReconnect(): void {
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const delayMs = Math.min(
      this.config.gateway.reconnectMaxMs,
      Math.round(this.config.gateway.reconnectBaseMs * 2 ** attempt),
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private send(frame: RequestFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway socket is not connected");
    }

    this.socket.send(JSON.stringify(frame));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
