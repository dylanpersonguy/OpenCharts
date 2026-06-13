/**
 * SessionTimeout — disabled.
 * Sessions are kept alive indefinitely via silent token refresh
 * in store.tsx (startTokenRefresh). No warning banner is needed.
 */
export function SessionTimeoutWarning() {
  return null;
}
