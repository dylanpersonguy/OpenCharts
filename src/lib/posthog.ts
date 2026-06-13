import posthog from "posthog-js";

const apiKey = import.meta.env.VITE_POSTHOG_API_KEY as string | undefined;
const host =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";

if (apiKey) {
  posthog.init(apiKey, {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
  });
}

export { posthog };

/**
 * Capture a PropSim platform-level event (not a firm tenant event).
 * Always injects { event_group: "platform", platform: "propsim" } so these
 * events are trivially separable from firm funnel events in PostHog dashboards.
 */
export function capturePlatform(event: string, properties?: Record<string, unknown>): void {
  posthog.capture(event, {
    event_group: "platform",
    platform: "propsim",
    ...properties,
  });
}
