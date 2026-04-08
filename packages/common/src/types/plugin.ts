/** Plugin system types */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** Entry point types the plugin provides */
  provides: PluginCapability[];
}

export type PluginCapability =
  | 'indicator'
  | 'data-provider'
  | 'drawing-tool'
  | 'panel'
  | 'theme'
  | 'strategy';

export interface PluginIndicator {
  type: string;
  name: string;
  description: string;
  defaultParams?: Record<string, number>;
  compute: (closes: number[], params?: Record<string, number>) => Record<string, (number | null)[]>;
}

export interface PluginPanel {
  id: string;
  title: string;
  icon?: string;
  /** React component name */
  component: string;
}

export interface PluginRegistration {
  manifest: PluginManifest;
  indicators?: PluginIndicator[];
  panels?: PluginPanel[];
}

export type PluginStatus = 'active' | 'disabled' | 'error';

export interface PluginInfo {
  manifest: PluginManifest;
  status: PluginStatus;
  error?: string;
}
