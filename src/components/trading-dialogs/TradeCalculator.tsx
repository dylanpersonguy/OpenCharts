import { useState } from "react";
import { formatCurrency } from "@/lib/utils";
import {} from "lucide-react";

// ── Trade Calculator (#57) ──────────────────────────────────

interface TradeCalcProps {
  tick?: { bid: number; ask: number };
  symbolInfo?: {
    digits?: number;
    pip?: number;
    contractSize?: number;
    [key: string]: unknown;
  } | null;
}

export function TradeCalculator({ tick: _tick, symbolInfo }: TradeCalcProps) {
  const [riskPercent, setRiskPercent] = useState("1");
  const [accountBalance, setAccountBalance] = useState("100000");
  const [slPips, setSlPips] = useState("20");

  const balance = parseFloat(accountBalance) || 0;
  const risk = parseFloat(riskPercent) || 0;
  const slDistance = parseFloat(slPips) || 0;
  const pipValue = (symbolInfo?.contractSize || 100000) * 0.0001;
  const riskAmount = balance * (risk / 100);
  const recommendedLots = slDistance > 0 ? riskAmount / (slDistance * pipValue) : 0;

  return (
    <div className="p-3 space-y-2 text-xs">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Position Size Calculator
      </h4>
      <div>
        <label className="text-[10px] text-muted-foreground">Account Balance</label>
        <input
          type="number"
          value={accountBalance}
          onChange={(e) => setAccountBalance(e.target.value)}
          className="w-full mt-0.5 text-xs font-mono"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Risk %</label>
        <input
          type="number"
          value={riskPercent}
          onChange={(e) => setRiskPercent(e.target.value)}
          className="w-full mt-0.5 text-xs font-mono"
          step="0.5"
          min="0.1"
          max="10"
        />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Stop Loss (pips)</label>
        <input
          type="number"
          value={slPips}
          onChange={(e) => setSlPips(e.target.value)}
          className="w-full mt-0.5 text-xs font-mono"
        />
      </div>
      <div className="bg-secondary/50 rounded p-2 space-y-1 mt-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Risk Amount</span>
          <span className="font-mono text-accent">{formatCurrency(riskAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Pip Value/Lot</span>
          <span className="font-mono">{formatCurrency(pipValue)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Recommended Size</span>
          <span className="font-mono text-accent">{recommendedLots.toFixed(2)} lots</span>
        </div>
      </div>
    </div>
  );
}

// ── Order Modify Dialog (#30) ───────────────────────────────
