import { request } from "./request";

export interface AiTraderActionResult {
  actionIndex: number;
  type: string;
  status: string;
  data?: Record<string, unknown>;
  error?: { message?: string };
}

export interface AiTraderExecutionMetrics {
  balance: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  openPositions: number;
  openOrders: number;
  dailyPnl: number;
  overallPnl: number;
}

export interface AiTraderPlan {
  planId: string | null;
  parsedIntentSummary: string;
  assumptions: string[];
  actionPlan: Record<string, unknown> | null;
  validations: Array<Record<string, unknown>>;
  dryRun: Record<string, unknown> | null;
  warnings: string[];
  requiresConfirmation: boolean;
  clarification?: string;
  suggestedQuestions?: string[];
  infoResponse?: Record<string, unknown>;
  autoExecuted?: boolean;
  executionResult?: {
    executionId: string;
    results: AiTraderActionResult[];
    metrics: AiTraderExecutionMetrics;
  };
}

export interface AiTraderExecutionResult {
  executionId: string;
  results: AiTraderActionResult[];
  finalAccountMetrics: AiTraderExecutionMetrics;
}

export interface AiTraderHistoryEntry {
  id: string;
  accountId: string;
  role: string;
  content: string;
  createdAt: string;
  plan?: {
    id?: string;
    actionPlan?: Record<string, unknown>;
    executionResult?: {
      executionId: string;
      results: AiTraderActionResult[];
      metrics: AiTraderExecutionMetrics;
    };
  } | null;
}

export interface AiSupportCitationMap {
  ruleViolationIds?: string[];
  orderIds?: string[];
  fillIds?: string[];
  positionIds?: string[];
  ledgerEntryIds?: string[];
  equitySnapshotIds?: string[];
  riskEvalIds?: string[];
  executionProfileIds?: string[];
  symbolSpecRefs?: string[];
  tickIds?: string[];
}

export interface AiSupportMessage {
  id: string;
  caseId: string;
  role: "USER" | "AI" | "SYSTEM";
  content: string;
  citations?: AiSupportCitationMap;
  createdAt: string;
}

export interface AiSupportCase {
  id: string;
  accountId: string;
  status: "OPEN" | "ESCALATED" | "RESOLVED" | "CLOSED" | string;
  incidentType: string;
  createdAt: string;
  updatedAt: string;
  label?: string | null;
  messageCount?: number;
  lastMessage?: { content?: string | null } | null;
  runs?: Array<{ confidence?: string }>;
  messages?: AiSupportMessage[];
  [key: string]: unknown;
}

export const aiApi = {
  // ── AI Trader ──
  isAiTraderEnabled: () =>
    request<{ enabled: boolean; readOnlyDefault: boolean }>("/ai-trader/enabled"),

  createAiTraderPlan: (data: {
    accountId: string;
    message: string;
    context?: {
      selectedSymbol?: string;
      timezone?: string;
      deterministicMode?: boolean;
      readOnlyMode?: boolean;
    };
  }) =>
    request<AiTraderPlan>("/ai-trader/plan", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  executeAiTraderPlan: (data: { planId: string; accountId: string; confirm: true }) =>
    request<AiTraderExecutionResult>("/ai-trader/execute", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getAiTraderHistory: (accountId: string) =>
    request<AiTraderHistoryEntry[]>(`/ai-trader/history?accountId=${accountId}`),

  clearAiTraderHistory: (accountId: string) =>
    request<void>(`/ai-trader/history?accountId=${accountId}`, {
      method: "DELETE",
    }),

  // ── AI Support ──
  getAiSupportCases: (accountId?: string) =>
    request<{ items: AiSupportCase[]; total: number; page: number }>(
      `/ai-support/cases${accountId ? `?accountId=${accountId}` : ""}`,
    ),

  getAiSupportCase: (id: string) => request<AiSupportCase>(`/ai-support/cases/${id}`),

  createAiSupportCase: (data: {
    accountId: string;
    incidentType?: string;
    ruleViolationId?: string;
  }) =>
    request<{ case: AiSupportCase; messages: AiSupportMessage[] }>("/ai-support/cases", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  sendAiSupportMessage: (caseId: string, content: string) =>
    request<{ userMessage: AiSupportMessage; aiMessage: AiSupportMessage; confidence: string }>(
      `/ai-support/cases/${caseId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    ),

  escalateAiSupportCase: (caseId: string, reason?: string) =>
    request<{ ticketId: string; caseStatus: string }>(`/ai-support/cases/${caseId}/escalate`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};
