import type { DashboardLayoutState } from '../types/gridLayout.types';
import { STORAGE_KEYS } from '../utils/constants';

export const layoutService = {
  saveLayout(state: DashboardLayoutState): void {
    try {
      localStorage.setItem(STORAGE_KEYS.LAYOUT, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save layout:', error);
    }
  },

  loadLayout(): DashboardLayoutState | null {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LAYOUT);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error('Failed to load layout:', error);
      return null;
    }
  },

  clearLayout(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.LAYOUT);
    } catch (error) {
      console.error('Failed to clear layout:', error);
    }
  },

  // Check if stored layout is old Golden Layout format
  isLegacyFormat(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    // Golden Layout format has 'root' or 'content' at top level
    return 'root' in obj || 'content' in obj;
  },
};
