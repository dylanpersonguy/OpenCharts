import { useMyFirm } from "../services/queries";
import { resolveTerminalTheme, type TerminalPageKind } from "./terminal-themes";

type FirmWithBranding = { branding?: Record<string, unknown> } | undefined;

/**
 * Renders the firm-selected theme variant of a terminal page.
 * The firm's choice lives in branding.terminalTheme; useMyFirm() hydrates
 * from localStorage so returning visitors resolve instantly with no flash.
 */
export function ThemedTerminalPage({ page }: { page: TerminalPageKind }) {
  const { data: firm, isLoading } = useMyFirm();
  // First-ever visit only: avoid flashing the default theme while the firm loads.
  if (isLoading && !firm) return null;
  const theme = resolveTerminalTheme((firm as FirmWithBranding)?.branding?.terminalTheme);
  const Page = page === "dashboard" ? theme.Dashboard : theme.Trading;
  return <Page />;
}
