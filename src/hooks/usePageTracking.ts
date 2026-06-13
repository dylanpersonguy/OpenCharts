import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { request } from "../services/api/request";

export function usePageTracking() {
  const location = useLocation();
  const prev = useRef<string | undefined>(undefined);

  useEffect(() => {
    const previousPath = prev.current;
    prev.current = location.pathname;
    request("/analytics/pageview", {
      method: "POST",
      body: JSON.stringify({
        path: location.pathname,
        previousPath,
        title: document.title,
        referrer: document.referrer || undefined,
      }),
    }).catch(() => {});
  }, [location.pathname]);
}
