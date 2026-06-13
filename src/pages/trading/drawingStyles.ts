import { readTraderPrefs, writeTraderPrefs } from "../../hooks/useTraderPreferences.ts";
import { useAuthStore } from "../../services/store.tsx";
import type { DrawingLine } from "./constants.ts";

// Per-user, persisted drawing style defaults (new drawings inherit the default
// for their type) and named style templates (apply a saved look to a drawing).

export type StylePatch = Partial<
  Pick<
    DrawingLine,
    | "color"
    | "width"
    | "lineStyle"
    | "fillColor"
    | "fillOpacity"
    | "arrowStart"
    | "arrowEnd"
    | "fontSize"
  >
>;

export interface DrawingTemplate {
  name: string;
  style: StylePatch;
}

export const DRAWING_STYLES_EVENT = "drawing-styles-updated";
const DEFAULTS_KEY = "drawingDefaults";
const TEMPLATES_KEY = "drawingTemplates";

function userId(): string | undefined {
  return useAuthStore.getState().user?.id;
}

function parse<T>(raw: string | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: unknown): void {
  const id = userId();
  writeTraderPrefs({ ...readTraderPrefs(id), [key]: JSON.stringify(value) }, id);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DRAWING_STYLES_EVENT));
}

/** Style-only fields of a drawing (drops anchors/visibility/alert state). */
export function pickStyle(d: DrawingLine): StylePatch {
  return {
    color: d.color,
    width: d.width,
    lineStyle: d.lineStyle,
    fillColor: d.fillColor,
    fillOpacity: d.fillOpacity,
    arrowStart: d.arrowStart,
    arrowEnd: d.arrowEnd,
    fontSize: d.fontSize,
  };
}

export function getStyleDefaults(): Record<string, StylePatch> {
  return parse(readTraderPrefs(userId())[DEFAULTS_KEY], {});
}

export function setTypeDefault(type: string, d: DrawingLine): void {
  persist(DEFAULTS_KEY, { ...getStyleDefaults(), [type]: pickStyle(d) });
}

export function getTemplates(): DrawingTemplate[] {
  return parse(readTraderPrefs(userId())[TEMPLATES_KEY], []);
}

export function saveTemplate(name: string, d: DrawingLine): void {
  const templates = getTemplates().filter((t) => t.name !== name);
  templates.push({ name, style: pickStyle(d) });
  persist(TEMPLATES_KEY, templates);
}

export function deleteTemplate(name: string): void {
  persist(
    TEMPLATES_KEY,
    getTemplates().filter((t) => t.name !== name),
  );
}
