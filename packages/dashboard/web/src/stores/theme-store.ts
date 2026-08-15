import { create } from "zustand";

export type DashboardTheme = "dark" | "light";

const THEME_KEY = "paseo-dashboard-theme";
export const THEME_CHANGE_EVENT = "paseo-dashboard:theme-change";

function readTheme(): DashboardTheme {
  try {
    return globalThis.localStorage?.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: DashboardTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function persistTheme(theme: DashboardTheme): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    // localStorage may be unavailable in private browsing or tests.
  }
}

export interface ThemeState {
  theme: DashboardTheme;
  setTheme: (theme: DashboardTheme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const theme = readTheme();
  applyTheme(theme);
  return {
    theme,
    setTheme: (next) => {
      applyTheme(next);
      persistTheme(next);
      globalThis.dispatchEvent?.(new Event(THEME_CHANGE_EVENT));
      set({ theme: next });
    },
    toggleTheme: () => {
      const next = get().theme === "dark" ? "light" : "dark";
      applyTheme(next);
      persistTheme(next);
      globalThis.dispatchEvent?.(new Event(THEME_CHANGE_EVENT));
      set({ theme: next });
    },
  };
});
