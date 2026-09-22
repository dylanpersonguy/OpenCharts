import prefixSelector from "postcss-prefix-selector";

/**
 * Scope every stylesheet rule under `.opencharts`.
 *
 * OpenCharts is embedded in other people's pages, and Tailwind's output is
 * global by default: its reset (`* { margin: 0 }`), element styles for inputs
 * and tables, and theme variables on `:root` named `--background`, `--primary`,
 * `--border` — the same names shadcn/ui uses. Unscoped, importing the terminal's
 * CSS would restyle the host page and overwrite a shadcn host's theme.
 *
 * Prefixing at build time scopes all of it without touching a single className
 * in the source. `<OpenChartsProvider>` renders the `.opencharts` element.
 */
const SCOPE = ".opencharts";

// Page-level selectors map onto the scope root itself rather than a descendant.
const ROOT_SELECTORS = new Set([":root", "html", "body", ":host"]);

function scope(prefix, selector, prefixedSelector, filePath) {
  // The demo's own page shell is intentionally global.
  if (filePath && /[\/]app\.css$/.test(filePath)) return selector;

  const trimmed = selector.trim();
  if (ROOT_SELECTORS.has(trimmed)) return prefix;

  // Theme classes are toggled on <html>, an ancestor of the scope root, or can
  // be set on the root itself.
  for (const theme of [".light", ".dark"]) {
    if (trimmed === theme) return `${theme} ${prefix}, ${prefix}${theme}`;
    if (trimmed.startsWith(`${theme} `)) {
      const rest = trimmed.slice(theme.length);
      return `${theme} ${prefix}${rest}, ${prefix}${theme}${rest}`;
    }
  }

  return prefixedSelector;
}

export default {
  plugins: [
    (await import("tailwindcss")).default,
    prefixSelector({ prefix: SCOPE, transform: scope }),
    (await import("autoprefixer")).default,
  ],
};
