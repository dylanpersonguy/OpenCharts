export interface Alert {
  id: string;
  userId: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  message?: string;
  active: boolean;
  triggered: boolean;
  triggeredAt?: string;
  createdAt: string;
}

export type AlertCondition = 'crosses_above' | 'crosses_below' | 'greater_than' | 'less_than';

export interface CreateAlertRequest {
  symbol: string;
  condition: AlertCondition;
  price: number;
  message?: string;
  /** Optional webhook URL to POST when alert triggers */
  webhookUrl?: string;
  /** Optional webhook headers (e.g. Authorization) */
  webhookHeaders?: Record<string, string>;
}

export interface WebhookPayload {
  alertId: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  currentPrice: number;
  message?: string;
  triggeredAt: string;
}
