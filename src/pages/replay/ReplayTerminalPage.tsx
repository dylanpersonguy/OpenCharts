import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TradingPage } from "../TradingPage.tsx";
import { ReplayControlsBar } from "./ReplayControlsBar.tsx";
import { ReplayJournalPanel } from "./ReplayJournalPanel.tsx";
import { useReplayBindings } from "./useReplayBindings.tsx";
import { useReplayController } from "./useReplayController.ts";
import { useReplayHotkeys } from "./useReplayHotkeys.ts";
import { useHistoryManifest } from "./useReplaySessions.ts";
import type { ReplayController } from "../../services/replay/controller.ts";
import { useReplayStore } from "../../services/replay/store.ts";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ReplayTerminal({ sessionId, controller }: { sessionId: string; controller: ReplayController }) {
  useReplayHotkeys({
    onStep: () => void controller.step(),
    onTogglePlay: () => (useReplayStore.getState().status === "playing" ? controller.pause() : controller.play()),
  });
  const slots = useMemo(
    () => ({
      controls: <ReplayControlsBar controller={controller} />,
      nav: (
        <div className="flex items-center gap-0.5 shrink-0">
          <Link to="/replay" className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Sessions
          </Link>
          <Link
            to={`/replay/${sessionId}/stats`}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <BarChart3 className="h-3 w-3" /> Stats
          </Link>
        </div>
      ),
      journal: <ReplayJournalPanel sessionId={sessionId} />,
    }),
    [controller, sessionId],
  );
  const replay = useReplayBindings(controller, slots);
  if (!replay) return <Centered>Loading session…</Centered>;
  return (
    <div className="h-screen">
      <TradingPage replay={replay} />
    </div>
  );
}

/** Route `/replay/:sessionId` — the trading terminal running against a replay session. */
export function ReplayTerminalPage() {
  const { sessionId } = useParams();
  const manifest = useHistoryManifest();
  const { controller, error } = useReplayController(sessionId, manifest.data);

  if (manifest.isSuccess && !manifest.data) {
    return (
      <Centered>
        <p>No market history downloaded. Run <code className="font-mono">npm run fetch:history</code>, then reload.</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/replay">Back to sessions</Link>
        </Button>
      </Centered>
    );
  }
  if (error) {
    return (
      <Centered>
        <p className="text-sell">Could not open session: {error}</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/replay">Back to sessions</Link>
        </Button>
      </Centered>
    );
  }
  if (!controller || !sessionId) return <Centered>Loading history…</Centered>;
  return <ReplayTerminal key={sessionId} sessionId={sessionId} controller={controller} />;
}
