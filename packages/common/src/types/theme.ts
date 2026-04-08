/** Theming types */

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  panel: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  green: string;
  red: string;
  blue: string;
  accent: string;
}

export interface ChartTheme {
  id: string;
  name: string;
  colors: ThemeColors;
}

export const BUILT_IN_THEMES: ChartTheme[] = [
  {
    id: 'dark',
    name: 'Dark (Default)',
    colors: {
      bg: '#131722',
      bgSecondary: '#1e222d',
      panel: '#1e222d',
      border: '#2a2e39',
      text: '#d1d4dc',
      textSecondary: '#b2b5be',
      textMuted: '#787b86',
      green: '#26a69a',
      red: '#ef5350',
      blue: '#2962ff',
      accent: '#2962ff',
    },
  },
  {
    id: 'light',
    name: 'Light',
    colors: {
      bg: '#ffffff',
      bgSecondary: '#f0f3fa',
      panel: '#f0f3fa',
      border: '#e0e3eb',
      text: '#131722',
      textSecondary: '#4a4e59',
      textMuted: '#787b86',
      green: '#089981',
      red: '#f23645',
      blue: '#2962ff',
      accent: '#2962ff',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    colors: {
      bg: '#0d1117',
      bgSecondary: '#161b22',
      panel: '#161b22',
      border: '#30363d',
      text: '#c9d1d9',
      textSecondary: '#8b949e',
      textMuted: '#6e7681',
      green: '#3fb950',
      red: '#f85149',
      blue: '#58a6ff',
      accent: '#58a6ff',
    },
  },
  {
    id: 'sepia',
    name: 'Warm Sepia',
    colors: {
      bg: '#1a1612',
      bgSecondary: '#241f19',
      panel: '#241f19',
      border: '#3a332a',
      text: '#d4c8b0',
      textSecondary: '#b0a48c',
      textMuted: '#7a7060',
      green: '#6ab04c',
      red: '#e55039',
      blue: '#4a90d9',
      accent: '#d4a853',
    },
  },
];
