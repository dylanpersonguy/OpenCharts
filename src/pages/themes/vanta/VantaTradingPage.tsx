import { TradingPage } from "../../TradingPage.tsx";
import { useDarkThemeScope } from "../theme-kit";
import "./vanta.css";

/**
 * Vanta trading desk — the classic full-featured desk wearing the
 * Vanta token scope, so the gold/near-black palette carries from
 * the bento dashboard into the terminal.
 */
export function VantaTradingPage() {
  useDarkThemeScope("vanta");
  return <TradingPage />;
}
