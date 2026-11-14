import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentIdSchema, type AgentId } from "@qoreops/shared-types";
import { AGENTS, assertToolAllowed, type Tool } from "./agents";

export const TASK_STATES = ["QUEUED", "RUNNING", "AWAITING_HUMAN", "COMPLETED", "FAILED", "PAUSED_AI_UNAVAILABLE"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export interface Task {
  id: string;
  organizationId: string;
  requestedBy: string; // user id
  agent: AgentId;
  intent: string;
  parentTaskId?: string;
  state: TaskState;
  toolCalls: Array<{ at: number; tool: Tool; ok: boolean }>;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Deterministic router. (A model may later *suggest* an intent, but routing stays an allow-list lookup.) */
const ROUTES: Array<{ intent: RegExp; agent: AgentId }> = [
  { intent: /invoice|bill|duplicate/i, agent: "InvoiceFraudAgent" },
  { intent: /tender|bid|procure|supplier|vendor select/i, agent: "ProcurementAgent" },
  { intent: /grant/i, agent: "GrantAgent" },
  { intent: /milestone|deliverable/i, agent: "MilestoneAgent" },
  { intent: /policy|limit|permission/i, agent: "PolicyAgent" },
  { intent: /threat|attack|suspicious|incident|pause|revoke/i, agent: "SecurityAgent" },
  { intent: /payroll|salary|contributor/i, agent: "PayrollAgent" },
  { intent: /revenue|receivable|collect/i, agent: "RevenueAgent" },
  { intent: /proposal|governance|vote/i, agent: "GovernanceAgent" },
  { intent: /dca|rebalanc|allocation/i, agent: "StrategyAgent" },
  { intent: /arbitrage|spread|quote/i, agent: "ArbitrageAgent" },
  { intent: /dispute|evidence|resolution/i, agent: "DisputeAgent" },
  { intent: /document|encrypt|decrypt|vault/i, agent: "DocumentAgent" },
  { intent: /treasury|balance|budget|forecast|cash/i, agent: "TreasuryAgent" },
];

export const TaskRequestSchema = z.object({
  organizationId: z.string().uuid(),
  requestedBy: z.string().min(1),
  intent: z.string().min(3).max(2000),
  agent: AgentIdSchema.optional(),
});

export interface TaskStore {
  insert(t: Task): Promise<void>;
  update(t: Task): Promise<void>;
  get(id: string): Promise<Task | undefined>;
}

export class InMemoryTaskStore implements TaskStore {
  private m = new Map<string, Task>();
  async insert(t: Task) { this.m.set(t.id, structuredClone(t)); }
  async update(t: Task) { this.m.set(t.id, structuredClone(t)); }
  async get(id: string) { const t = this.m.get(id); return t ? structuredClone(t) : undefined; }
  all(): Task[] { return [...this.m.values()].map((t) => structuredClone(t)); }
}

export class Coordinator {
  constructor(
    private readonly store: TaskStore,
    private readonly now: () => number = Date.now,
  ) {}

  route(intent: string): AgentId {
    return ROUTES.find((r) => r.intent.test(intent))?.agent ?? "TreasuryAgent";
  }

  async createTask(raw: unknown): Promise<Task> {
    const req = TaskRequestSchema.parse(raw);
    const t = this.now();
    const task: Task = {
      id: randomUUID(), organizationId: req.organizationId, requestedBy: req.requestedBy,
      agent: req.agent ?? this.route(req.intent), intent: req.intent, state: "QUEUED", toolCalls: [], createdAt: t, updatedAt: t,
    };
    await this.store.insert(task);
    return task;
  }

  /** Agents call tools only through this gate; denied calls are recorded and thrown. */
  async useTool<T>(taskId: string, tool: string, fn: () => Promise<T>): Promise<T> {
    const task = await this.must(taskId);
    try {
      assertToolAllowed(task.agent, tool);
    } catch (e) {
      task.toolCalls.push({ at: this.now(), tool: tool as Tool, ok: false });
      task.updatedAt = this.now();
      await this.store.update(task);
      throw e;
    }
    try {
      const out = await fn();
      task.toolCalls.push({ at: this.now(), tool, ok: true });
      return out;
    } catch (e) {
      task.toolCalls.push({ at: this.now(), tool, ok: false });
      throw e;
    } finally {
      task.updatedAt = this.now();
      await this.store.update(task);
    }
  }

  async setState(taskId: string, state: TaskState, extra: { result?: unknown; error?: string } = {}): Promise<Task> {
    const task = await this.must(taskId);
    task.state = state;
    if (extra.result !== undefined) task.result = extra.result;
    if (extra.error !== undefined) task.error = extra.error;
    task.updatedAt = this.now();
    await this.store.update(task);
    return task;
  }

  /** Creates a child task for another agent (handoff). The caller must be allowed to message that agent. */
  async handoff(parentId: string, to: AgentId, intent: string): Promise<Task> {
    const parent = await this.must(parentId);
    if (!(AGENTS[parent.agent].mayMessage as readonly AgentId[]).includes(to)) {
      throw new Error(`${parent.agent} may not hand off to ${to}`);
    }
    const t = this.now();
    const child: Task = {
      id: randomUUID(), organizationId: parent.organizationId, requestedBy: parent.requestedBy, agent: to, intent,
      parentTaskId: parent.id, state: "QUEUED", toolCalls: [], createdAt: t, updatedAt: t,
    };
    await this.store.insert(child);
    return child;
  }

  private async must(id: string): Promise<Task> {
    const t = await this.store.get(id);
    if (!t) throw new Error(`task ${id} not found`);
    return t;
  }
}
