import { z } from "zod";

// ── Auth ──────────────────────────────────────────────────
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  roles: z.array(z.string()),
  status: z.string(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Accounts ──────────────────────────────────────────────
export const AccountSchema = z.object({
  id: z.string(),
  userId: z.string(),
  templateId: z.string(),
  label: z.string().nullable(),
  status: z.string(),
  balance: z.number(),
  equity: z.number(),
  margin: z.number(),
  freeMargin: z.number(),
  phase: z.string(),
  startDate: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isHftMode: z.boolean().optional().default(false),
  template: z
    .object({
      name: z.string(),
      startingBalance: z.number(),
      instrumentType: z.enum(["FOREX", "FUTURES", "CRYPTO", "EQUITIES"]).optional(),
    })
    .optional(),
});
export type Account = z.infer<typeof AccountSchema>;

export const AccountStatsSchema = z.object({
  totalTrades: z.number(),
  winRate: z.number(),
  avgWin: z.number(),
  avgLoss: z.number(),
  profitFactor: z.number(),
  bestTrade: z.number(),
  worstTrade: z.number(),
  sharpeRatio: z.number().optional(),
  maxDrawdown: z.number().optional(),
  expectancy: z.number().optional(),
});
export type AccountStats = z.infer<typeof AccountStatsSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  type: z.string(),
  amount: z.number(),
  balance: z.number(),
  description: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdAt: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const EquityPointSchema = z.object({
  equity: z.number(),
  balance: z.number(),
  timestamp: z.string(),
});
export type EquityPoint = z.infer<typeof EquityPointSchema>;

// ── Trading ───────────────────────────────────────────────
export const OrderSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  symbolName: z.string(),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT", "STOP"]),
  quantity: z.number(),
  price: z.number().nullable(),
  stopPrice: z.number().nullable(),
  takeProfit: z.number().nullable(),
  stopLoss: z.number().nullable(),
  status: z.string(),
  filledQuantity: z.number(),
  avgFillPrice: z.number().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const PositionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  symbolName: z.string(),
  side: z.enum(["LONG", "SHORT"]),
  quantity: z.number(),
  entryPrice: z.number(),
  currentPrice: z.number().optional(),
  unrealizedPnl: z.number(),
  // margin is computed from symbol contractSize + account leverage at REST time.
  // WS-sourced positions use 0 and are corrected on the next REST sync.
  margin: z.number().default(0),
  // contractSize is included so UI components (e.g. PositionModifyDialog) can
  // compute correct per-instrument P&L estimates without hardcoding 100000.
  contractSize: z.number().optional(),
  openedAt: z.string(),
  takeProfit: z.number().nullable(),
  stopLoss: z.number().nullable(),
});
export type Position = z.infer<typeof PositionSchema>;

export const FillSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  accountId: z.string(),
  symbolName: z.string(),
  side: z.string(),
  quantity: z.number(),
  price: z.number(),
  commission: z.number(),
  realizedPnl: z.number().nullable(),
  createdAt: z.string(),
});
export type Fill = z.infer<typeof FillSchema>;

export const ClosedPositionSchema = z.object({
  id: z.string(),
  accountId: z.string().optional(),
  symbolName: z.string(),
  side: z.string(),
  quantity: z.number(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  realizedPnl: z.number(),
  commission: z.number(),
  swap: z.number(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  isPartialClose: z.boolean().optional(),
});
export type ClosedPosition = z.infer<typeof ClosedPositionSchema>;

export const SymbolSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  category: z.string(),
  contractSize: z.number(),
  tickSize: z.number(),
  tickValue: z.number(),
  marginPercent: z.number(),
  maxLeverage: z.number(),
  commission: z.number(),
  swapLong: z.number(),
  swapShort: z.number(),
  tradingHoursStart: z.string().nullable(),
  tradingHoursEnd: z.string().nullable(),
  isActive: z.boolean(),
});
export type Symbol = z.infer<typeof SymbolSchema>;

export const CandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  timestamp: z.union([z.number(), z.string()]).optional(),
});
export type Candle = z.infer<typeof CandleSchema>;

// ── Paginated responses ───────────────────────────────────
export const PaginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });

// ── Input schemas (for validation) ────────────────────────
export const PlaceOrderInputSchema = z.object({
  accountId: z.string().uuid(),
  symbol: z.string().min(1).max(20),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]),
  quantity: z.number().positive().max(1000),
  price: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
});
export type PlaceOrderInput = z.infer<typeof PlaceOrderInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const RegisterInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;
