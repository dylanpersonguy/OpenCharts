/**
 * API facade.
 *
 * OpenCharts runs without a backend: everything the terminal needs is served by
 * the in-browser demo layer (services/demo). `api` is that implementation,
 * typed exactly — calling a method the demo layer does not provide is a compile
 * error, not a silent `null` at runtime.
 *
 * The Proxy is a runtime safety net for dynamic access (a method name built at
 * runtime, or code reached before a rebuild): it resolves to a benign no-op and
 * warns in development instead of throwing `is not a function`.
 */
import { demoApi } from "./demo/api.ts";

export const API_BASE = "";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = "API_ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// react-query rejects `undefined` query results, so resolve to null instead.
const benign = () => Promise.resolve(null);

export const api = new Proxy(demoApi as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    if (import.meta.env.DEV) {
      console.warn(`[api] "${String(prop)}" is not implemented by the demo layer — resolving null.`);
    }
    return benign;
  },
}) as typeof demoApi;
