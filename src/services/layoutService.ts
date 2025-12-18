// import { GoldenLayoutConfig } from '../types/layout.types';
import { STORAGE_KEYS } from '../utils/constants';

export const layoutService = {
  saveLayout(config: any): void {
    try {
      localStorage.setItem(STORAGE_KEYS.LAYOUT, JSON.stringify(config));
    } catch (error) {
      console.error('Failed to save layout:', error);
    }
  },

  loadLayout(): any | null {
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
};
