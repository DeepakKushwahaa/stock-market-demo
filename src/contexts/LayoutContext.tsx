import React, { createContext, useContext, useState, useEffect } from 'react';
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

export const LayoutProvider: React.FC<LayoutProviderProps> = ({ children }) => {
  const [layoutConfig, setLayoutConfig] = useState<any>(defaultLayoutConfig);
  const [layoutInstance, setLayoutInstance] = useState<unknown | null>(null);

  // Load layout from localStorage on mount
  useEffect(() => {
    const saved = layoutService.loadLayout();
    if (saved) {
      setLayoutConfig(saved);
    }
  }, []);

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
