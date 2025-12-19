import React, { createContext, useContext, useState } from 'react';
// import { GoldenLayoutConfig } from '../types/layout.types';
import { defaultLayoutConfig } from '../utils/layoutDefaults';
import { layoutService } from '../services/layoutService';

interface LayoutContextType {
  layoutConfig: any;
  updateLayout: (config: any) => void;
  resetLayout: () => void;
  layoutInstance: unknown | null;
  setLayoutInstance: (instance: unknown) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

interface LayoutProviderProps {
  children: any;
}

// Helper to get initial config synchronously
const getInitialLayoutConfig = () => {
  const saved = layoutService.loadLayout();
  if (saved) {
    // saveLayout() returns ResolvedLayoutConfig which has 'root' property
    // Check if it has valid structure (root with content)
    const hasValidStructure = saved.root &&
      saved.root.content &&
      saved.root.content.length > 0;

    if (hasValidStructure) {
      return saved;
    } else {
      // Clear invalid layout
      layoutService.clearLayout();
    }
  }
  return defaultLayoutConfig;
};

export const LayoutProvider: React.FC<LayoutProviderProps> = ({ children }) => {
  const [layoutConfig, setLayoutConfig] = useState<any>(getInitialLayoutConfig);
  const [layoutInstance, setLayoutInstance] = useState<unknown | null>(null);

  const updateLayout = (config: any) => {
    setLayoutConfig(config);
    layoutService.saveLayout(config);
  };

  const resetLayout = () => {
    setLayoutConfig(defaultLayoutConfig);
    layoutService.clearLayout();
    // Reload the page to reinitialize Golden Layout
    window.location.reload();
  };

  const value: LayoutContextType = {
    layoutConfig,
    updateLayout,
    resetLayout,
    layoutInstance,
    setLayoutInstance,
  };

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
};

export const useLayout = (): LayoutContextType => {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};
