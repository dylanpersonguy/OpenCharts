/**
 * ConsentGate — Intercepts authenticated navigation when the firm has published
 * new legal documents that require acceptance since the user last consented.
 *
 * Two-layer acceptance tracking:
 *  1. Server  — ConsentRecord rows (authoritative, checked on every mount)
 *  2. localStorage — keyed by userId:slug:version (fast client-side cache,
 *     survives refreshes and new sessions so the gate never re-appears for a
 *     version the user has already acknowledged even if the server query lags)
 *
 * A new document VERSION will still correctly prompt for re-consent.
 */
import { useEffect, useState, useCallback } from "react";
import { ExternalLink, CheckSquare, Square, FileText, Loader2, ShieldCheck } from "lucide-react";
import { api } from "../services/api";
import { useAuthStore } from "../services/store";

/** Slug → ConsentType enum value (mirrors Prisma ConsentType) */
const CONSENT_TYPE_MAP: Record<string, string> = {
  "terms-of-service": "TERMS_ACCEPTED",
  "privacy-policy": "PRIVACY_ACCEPTED",
  "risk-disclosure": "DATA_PROCESSING",
  "simulation-disclosure": "DATA_PROCESSING",
  "refund-policy": "DATA_PROCESSING",
  "affiliate-terms": "DATA_PROCESSING",
  "kyc-policy": "DATA_PROCESSING",
  "aml-statement": "DATA_PROCESSING",
};

const LS_KEY = "propsim:consented_docs";

function getCachedConsents(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

function cacheConsents(userId: string, docs: { slug: string; version?: string }[]) {
  try {
    const existing = getCachedConsents();
    for (const doc of docs) {
      existing.add(`${userId}:${doc.slug}:${doc.version ?? ""}`);
    }
    localStorage.setItem(LS_KEY, JSON.stringify([...existing]));
  } catch {
    /* ignore storage errors */
  }
}

function isCachedConsented(userId: string, slug: string, version?: string): boolean {
  return getCachedConsents().has(`${userId}:${slug}:${version ?? ""}`);
}

interface PendingDoc {
  id: string;
  slug: string;
  title: string;
  version?: string;
}

export function ConsentGate({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [status, setStatus] = useState<"loading" | "clear" | "pending">("loading");
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Do not query pending consents until the auth store has hydrated the user.
    // Without a userId the cache key degrades to ":slug:version" which is shared
    // across users on the same device, and any API 401 would wrongly clear the gate.
    if (!userId) return;

    try {
      const docs = (await api.getPendingConsents()) as unknown as PendingDoc[];
      if (!docs || docs.length === 0) {
        setStatus("clear");
        return;
      }

      // Filter out docs the user has already accepted in a previous session.
      // This prevents the gate re-appearing due to transient DB query issues
      // or re-publishing the same content with a new document row ID.
      const reallyPending = docs.filter(
        (d) => !isCachedConsented(userId, d.slug, d.version),
      );

      if (reallyPending.length === 0) {
        setStatus("clear");
      } else {
        setPendingDocs(reallyPending);
        setStatus("pending");
      }
    } catch {
      // If the endpoint fails (e.g. transient network error), keep "loading"
      // rather than clearing the gate — we'll retry when userId changes or on
      // the next mount. Do NOT default-open on failure.
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) =>
    setAccepted((prev) => ({ ...prev, [id]: !prev[id] }));

  const allAccepted = pendingDocs.length > 0 && pendingDocs.every((d) => accepted[d.id]);

  const handleAcceptAll = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Sequential — prevents a race where two DATA_PROCESSING docs run in
      // parallel and each call withdraws the other's just-created consent record.
      for (const doc of pendingDocs) {
        await api.grantConsent(doc.id, CONSENT_TYPE_MAP[doc.slug] ?? "DATA_PROCESSING");
      }

      // Cache locally so the gate never re-appears for these slug+versions.
      // Wrapped separately so a localStorage quota/private-browsing error
      // never prevents setStatus("clear") from running.
      try {
        cacheConsents(userId, pendingDocs);
      } catch {
        /* ignore storage errors — server consent is already recorded */
      }

      setStatus("clear");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : null;
      setSubmitError(
        msg && msg !== "Internal Server Error"
          ? msg
          : "Failed to record your consent — please check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "clear") return <>{children}</>;

  return (
    <>
      {/* Blur the app behind the gate */}
      <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" />

      {/* Gate modal — cannot be dismissed */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-start gap-4 p-6 pb-4 border-b border-border">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">
                Updated Legal Documents
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Please review and accept the following documents to continue using the platform.
              </p>
            </div>
          </div>

          {/* Document list */}
          <div className="p-6 space-y-3">
            {pendingDocs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => toggle(doc.id)}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50 group"
              >
                <div className="mt-0.5 shrink-0">
                  {accepted[doc.id] ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">{doc.title}</span>
                    {doc.version && (
                      <span className="text-xs text-muted-foreground shrink-0">v{doc.version}</span>
                    )}
                  </div>
                  <a
                    href={`/legal/${doc.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Read document
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 space-y-3">
            {submitError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                {submitError}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              By clicking "I Agree", you confirm you have read and accept all of the documents
              listed above.
            </p>
            <button
              type="button"
              onClick={handleAcceptAll}
              disabled={!allAccepted || submitting}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </span>
              ) : (
                "I Agree — Continue to App"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Underlying app still mounts (preserves state) but is visually blocked */}
      <div className="invisible pointer-events-none" aria-hidden="true">
        {children}
      </div>
    </>
  );
}
