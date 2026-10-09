import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { HistoryManifest } from "../../services/replay/data/codec.ts";
import { REPLAY_TIMEFRAMES, type ReplayTimeframe } from "../../services/replay/data/aggregate.ts";
import type { ReplaySymbol } from "../../services/replay/engine/types.ts";
import { REPLAY_INSTRUMENT_DEFAULTS } from "../../services/replay/instruments.ts";
import { validateSessionInput } from "../../services/replay/sessions.ts";
import type { CreateSessionInput } from "../../services/replay/session-types.ts";

interface CreateSessionDialogProps {
  manifest: HistoryManifest;
  submitting: boolean;
  onSubmit: (input: CreateSessionInput) => void;
  onCancel: () => void;
}

const DAY = 86_400;
const toDateInput = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const fromDateInput = (value: string) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 1000);

/** Default start: a year before the data ends, but never before the first week of history. */
function defaultStart(range: { from: number; to: number } | undefined): string {
  if (!range) return toDateInput(0);
  return toDateInput(Math.max(range.from + 7 * DAY, range.to - 365 * DAY));
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

const inputClass =
  "h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

/** Modal form for a new backtesting session. */
export function CreateSessionDialog({ manifest, submitting, onSubmit, onCancel }: CreateSessionDialogProps) {
  const symbols = Object.keys(manifest.symbols).filter((s): s is ReplaySymbol => s in REPLAY_INSTRUMENT_DEFAULTS);
  const [symbol, setSymbol] = useState<ReplaySymbol>(symbols[0] ?? "XAUUSD");
  const range = manifest.symbols[symbol];
  const minDate = toDateInput((range?.from ?? 0) + 7 * DAY);
  const maxDate = toDateInput(range?.to ?? 0);

  const [name, setName] = useState("");
  const [balance, setBalance] = useState("10000");
  const [startDate, setStartDate] = useState(() => defaultStart(range));
  const [timeframe, setTimeframe] = useState<ReplayTimeframe>("15m");
  const [spread, setSpread] = useState(String(REPLAY_INSTRUMENT_DEFAULTS[symbol].defaultSpread));
  const [commission, setCommission] = useState("0");
  const [leverage, setLeverage] = useState("100");
  const [error, setError] = useState<string | null>(null);

  const changeSymbol = (next: ReplaySymbol) => {
    setSymbol(next);
    setStartDate(defaultStart(manifest.symbols[next]));
    setSpread(String(REPLAY_INSTRUMENT_DEFAULTS[next].defaultSpread));
  };

  const input = useMemo<CreateSessionInput>(
    () => ({
      name: name || `${symbol} from ${startDate}`,
      symbol,
      startingBalance: Number(balance),
      startTime: fromDateInput(startDate),
      timeframe,
      spread: Number(spread),
      commissionPerLotPerSide: Number(commission),
      leverage: Number(leverage),
    }),
    [name, symbol, balance, startDate, timeframe, spread, commission, leverage],
  );

  const submit = () => {
    const problem = validateSessionInput(input, range?.from ?? 0, range?.to ?? 0);
    setError(problem);
    if (!problem) onSubmit(input);
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <form
          className="pointer-events-auto w-full max-w-md bg-card border border-border rounded-xl shadow-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">New backtesting session</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 p-5">
            <div className="col-span-2">
              <Field label="Name">
                <input className={inputClass} value={name} placeholder={`${symbol} from ${startDate}`} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <Field
              label="Symbol"
              hint={manifest.symbols.XAUUSD ? undefined : "XAUUSD: import gold files with npm run import:history"}
            >
              <select className={inputClass} value={symbol} onChange={(e) => changeSymbol(e.target.value as ReplaySymbol)}>
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start date (UTC)" hint={`${minDate} → ${maxDate}`}>
              <input type="date" className={inputClass} value={startDate} min={minDate} max={maxDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Starting balance ($)">
              <input type="number" className={inputClass} value={balance} min={100} step={100} onChange={(e) => setBalance(e.target.value)} />
            </Field>
            <Field label="Chart timeframe">
              <select className={inputClass} value={timeframe} onChange={(e) => setTimeframe(e.target.value as ReplayTimeframe)}>
                {REPLAY_TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Spread (price)">
              <input type="number" className={inputClass} value={spread} min={0} step="any" onChange={(e) => setSpread(e.target.value)} />
            </Field>
            <Field label="Commission / lot / side ($)">
              <input type="number" className={inputClass} value={commission} min={0} step="any" onChange={(e) => setCommission(e.target.value)} />
            </Field>
            <Field label="Leverage">
              <input type="number" className={inputClass} value={leverage} min={1} max={1000} onChange={(e) => setLeverage(e.target.value)} />
            </Field>
          </div>
          {error && <p className="px-5 -mt-2 pb-3 text-xs text-sell">{error}</p>}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={submitting}>
              Create session
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
