/** Which backend the hosted app runs, decided at build time from env. See Root.tsx. */
export type AdapterChoice = "hyperliquid" | "binance" | "demo";

export function chooseAdapter(env: {
  VITE_ADAPTER?: string;
  VITE_HL_BUILDER_ADDRESS?: string;
}): AdapterChoice {
  const explicit = env.VITE_ADAPTER?.trim().toLowerCase();
  if (explicit === "hyperliquid" || explicit === "binance" || explicit === "demo") return explicit;
  return env.VITE_HL_BUILDER_ADDRESS?.trim() ? "hyperliquid" : "demo";
}
