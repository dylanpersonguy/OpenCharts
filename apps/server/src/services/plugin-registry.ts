import type { PluginRegistration, PluginInfo, PluginIndicator } from '@opencharts/common';
import { logger } from './logger';

/**
 * PluginRegistry — manages registration and lifecycle of plugins.
 *
 * Plugins register via `register()` with their manifest, indicators,
 * panels, etc. The registry makes them available to the rest of the app.
 */
export class PluginRegistry {
  private plugins = new Map<string, { reg: PluginRegistration; status: 'active' | 'disabled' | 'error'; error?: string }>();

  register(reg: PluginRegistration): void {
    const { id } = reg.manifest;
    if (this.plugins.has(id)) {
      logger.warn({ pluginId: id }, '[Plugins] Plugin already registered, replacing');
    }

    try {
      this.plugins.set(id, { reg, status: 'active' });
      logger.info({ pluginId: id, name: reg.manifest.name, provides: reg.manifest.provides }, '[Plugins] Registered');
    } catch (err) {
      this.plugins.set(id, { reg, status: 'error', error: (err as Error).message });
      logger.error({ pluginId: id, err }, '[Plugins] Registration failed');
    }
  }

  unregister(pluginId: string): void {
    this.plugins.delete(pluginId);
    logger.info({ pluginId }, '[Plugins] Unregistered');
  }

  disable(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (entry) entry.status = 'disabled';
  }

  enable(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (entry && entry.status === 'disabled') entry.status = 'active';
  }

  /** Get all registered indicators from active plugins */
  getIndicators(): PluginIndicator[] {
    const indicators: PluginIndicator[] = [];
    for (const { reg, status } of this.plugins.values()) {
      if (status === 'active' && reg.indicators) {
        indicators.push(...reg.indicators);
      }
    }
    return indicators;
  }

  /** Get info about all plugins */
  list(): PluginInfo[] {
    return [...this.plugins.values()].map(({ reg, status, error }) => ({
      manifest: reg.manifest,
      status,
      error,
    }));
  }

  get(pluginId: string): PluginRegistration | undefined {
    const entry = this.plugins.get(pluginId);
    return entry?.reg;
  }

  getActive(): PluginRegistration[] {
    return [...this.plugins.values()]
      .filter(({ status }) => status === 'active')
      .map(({ reg }) => reg);
  }
}

export const pluginRegistry = new PluginRegistry();
