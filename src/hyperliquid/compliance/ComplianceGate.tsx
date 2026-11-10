import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { disconnectWallet } from "../wallet/connect.ts";
import { useHlSession } from "../session.ts";
import { readComplianceSettings } from "./config.ts";
import { checkGeo, decideGeo, type GeoDecision } from "./geo.ts";
import { isScreeningConfigured, screenAddress, useScreeningStore } from "./screen.ts";
import { TermsDialog } from "./TermsDialog.tsx";
import { hasAcceptedTerms, recordTermsAcceptance } from "./terms.ts";

function FullScreen({ title, children, role }: { title: string; children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div
      role={role}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground"
    >
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="max-w-md text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/**
 * Wrap the app (outside the terminal). Order of checks:
 *  1. Geo (only if VITE_GEO_CHECK_URL is set): children are NOT rendered until allowed,
 *     so nothing connects to Hyperliquid from a blocked region.
 *  2. Wallet screening (only if VITE_SCREEN_URL is set): runs when a wallet connects.
 *  3. Terms & risk acknowledgement, versioned (see TERMS_VERSION).
 *
 * This is advisory UX. It is trivially bypassed client-side; real enforcement
 * belongs at the edge (docs/COMPLIANCE_CHECKLIST.md).
 */
export const ComplianceGate: FC<{ children: ReactNode }> = ({ children }) => {
  const settings = useMemo(() => readComplianceSettings(), []);
  const geoConfigured = !!settings.geoUrl;
  const [geo, setGeo] = useState<GeoDecision | "checking">(geoConfigured ? "checking" : "allow");
  const [accepted, setAccepted] = useState<boolean>(() => hasAcceptedTerms());

  const address = useHlSession((s) => s.address);
  const screening = useScreeningStore();

  useEffect(() => {
    if (!settings.geoUrl) {
      if (settings.blockedCountries.size > 0) {
        console.error("[compliance] VITE_BLOCKED_COUNTRIES is set but VITE_GEO_CHECK_URL is not; the list is ignored.");
      } else if (import.meta.env.DEV) {
        console.warn("[compliance] No VITE_GEO_CHECK_URL configured: geo gate disabled. Not acceptable for production.");
      }
      return;
    }
    let live = true;
    void checkGeo(settings.geoUrl, { blockedCountries: settings.blockedCountries }).then((v) => {
      if (!live) return;
      if (v.kind === "unavailable" && settings.geoFailMode === "open") {
        console.warn(`[compliance] Geo check failed (${v.error}); VITE_GEO_FAIL_MODE=open, allowing access.`);
      }
      setGeo(decideGeo(v, settings.geoFailMode));
    });
    return () => {
      live = false;
    };
  }, [settings]);

  useEffect(() => {
    if (geo === "allow" && address && isScreeningConfigured()) void screenAddress(address);
  }, [geo, address]);

  if (geo === "checking") {
    return (
      <FullScreen title="Checking availability" role="status">
        One moment.
      </FullScreen>
    );
  }
  if (geo === "block") {
    return (
      <FullScreen title="Not available in your region" role="alert">
        This service is not available in your location. We are unable to offer access here.
      </FullScreen>
    );
  }

  const screenedFor = !!address && screening.address === address.toLowerCase();
  if (address && screenedFor && screening.status === "blocked") {
    return (
      <FullScreen title="This wallet can't be used" role="alert">
        <p className="mb-3">This wallet address is not eligible to use this service.</p>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground"
          onClick={() => void disconnectWallet().catch(() => undefined)}
        >
          Disconnect wallet
        </button>
      </FullScreen>
    );
  }

  return (
    <>
      {children}
      {address && screenedFor && screening.status === "checking" && (
        <FullScreen title="Verifying wallet" role="status">
          This only takes a moment.
        </FullScreen>
      )}
      {!accepted && (
        <TermsDialog
          onAccept={() => {
            recordTermsAcceptance();
            setAccepted(true);
          }}
        />
      )}
    </>
  );
};
