import fs from "node:fs";

import { ensureParentDir } from "./config.js";
import type { ApprovalStateFile, StoredApprovalRecord } from "./types.js";

export class ApprovalStore {
  private readonly stateFile: string;

  private readonly approvals = new Map<string, StoredApprovalRecord>();

  constructor(stateFile: string) {
    this.stateFile = stateFile;
    this.load();
  }

  get(approvalId: string): StoredApprovalRecord | undefined {
    return this.approvals.get(approvalId);
  }

  has(approvalId: string): boolean {
    return this.approvals.has(approvalId);
  }

  upsert(record: StoredApprovalRecord): void {
    this.approvals.set(record.approvalId, record);
    this.save();
  }

  update(approvalId: string, updater: (current: StoredApprovalRecord) => StoredApprovalRecord): StoredApprovalRecord | undefined {
    const current = this.approvals.get(approvalId);
    if (!current) {
      return undefined;
    }

    const next = updater(current);
    this.approvals.set(approvalId, next);
    this.save();
    return next;
  }

  listExpiredPending(nowMs: number): StoredApprovalRecord[] {
    return [...this.approvals.values()].filter((record) => record.status === "pending" && record.expiresAtMs <= nowMs);
  }

  private load(): void {
    if (!fs.existsSync(this.stateFile)) {
      return;
    }

    const raw = fs.readFileSync(this.stateFile, "utf8");
    const parsed = JSON.parse(raw) as ApprovalStateFile;

    if (parsed.version !== 1 || !parsed.approvals || typeof parsed.approvals !== "object") {
      return;
    }

    for (const record of Object.values(parsed.approvals)) {
      this.approvals.set(record.approvalId, record);
    }
  }

  private save(): void {
    ensureParentDir(this.stateFile);

    const payload: ApprovalStateFile = {
      version: 1,
      approvals: Object.fromEntries(this.approvals.entries()),
    };

    const tempFile = `${this.stateFile}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tempFile, this.stateFile);
  }
}
