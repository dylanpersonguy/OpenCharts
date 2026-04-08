/** Economic calendar event types */

export type EconImpact = 'low' | 'medium' | 'high';

export interface EconEvent {
  id: string;
  title: string;
  country: string;
  /** ISO 8601 timestamp */
  date: string;
  impact: EconImpact;
  /** Forecasted value */
  forecast: string | null;
  /** Previous value */
  previous: string | null;
  /** Actual value, null if not yet released */
  actual: string | null;
  /** Currency code, e.g. 'USD' */
  currency: string;
}
