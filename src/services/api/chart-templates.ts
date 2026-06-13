// Chart templates persist to localStorage in demo mode (no backend).

export interface ChartTemplateContent {
  version: 1;
  /** Snapshot of the TEMPLATE_PREF_KEYS subset of ChartPreferences. */
  prefs: Record<string, string | boolean>;
  indicators: string[];
  plugins: string[];
}

export interface ChartTemplate {
  id: string;
  name: string;
  layoutType: string;
  isDefault: boolean;
  panels: ChartTemplateContent[];
  updatedAt: string;
}

const KEY = "oc_chart_templates";

function readAll(): ChartTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeAll(list: ChartTemplate[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export const chartTemplatesApi = {
  list: () => Promise.resolve(readAll()),

  /** Upserts by name (unique per user). */
  save: (name: string, content: ChartTemplateContent, isDefault = false) => {
    const list = readAll().filter((t) => t.name !== name);
    const template: ChartTemplate = {
      id: crypto.randomUUID(),
      name,
      layoutType: "SINGLE",
      isDefault,
      panels: [content],
      updatedAt: new Date().toISOString(),
    };
    list.push(template);
    writeAll(list);
    return Promise.resolve(template);
  },

  remove: (id: string) => {
    writeAll(readAll().filter((t) => t.id !== id));
    return Promise.resolve({ deleted: true });
  },
};
