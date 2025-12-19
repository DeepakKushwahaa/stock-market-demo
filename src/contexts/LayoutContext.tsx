import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { GridItemLayout, WidgetInstance, WidgetType, DashboardLayoutState } from '../types/gridLayout.types';
import { defaultLayoutState, GRID_CONFIG, createLayoutItem, DEFAULT_WIDGET_SIZES } from '../utils/layoutDefaults';
import { layoutService } from '../services/layoutService';

interface LayoutContextType {
  layouts: GridItemLayout[];
  widgets: WidgetInstance[];
  updateLayouts: (newLayouts: GridItemLayout[]) => void;
  addWidget: (type: WidgetType, title: string, props: Record<string, unknown>) => void;
  addWidgetAtPosition: (type: WidgetType, title: string, props: Record<string, unknown>, x: number, y: number) => void;
  removeWidget: (widgetId: string) => void;
  resetLayout: () => void;
  canAddWidget: () => boolean;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

interface LayoutProviderProps {
  children: React.ReactNode;
}

// Helper to get initial config synchronously
const getInitialLayoutState = (): DashboardLayoutState => {
  const saved = layoutService.loadLayout();

  if (!saved) {
    return defaultLayoutState;
  }

  // Detect old Golden Layout format
  if (layoutService.isLegacyFormat(saved)) {
    console.warn('Legacy Golden Layout format detected. Resetting to default.');
    layoutService.clearLayout();
    return defaultLayoutState;
  }

  // Validate version
  if (saved.version !== 1) {
    console.warn('Unknown layout version. Resetting to default.');
    layoutService.clearLayout();
    return defaultLayoutState;
  }

  // Validate structure
  if (!Array.isArray(saved.layouts) || !Array.isArray(saved.widgets)) {
    console.warn('Invalid layout structure. Resetting to default.');
    layoutService.clearLayout();
    return defaultLayoutState;
  }

  return saved;
};

export const LayoutProvider: React.FC<LayoutProviderProps> = ({ children }) => {
  const initialState = getInitialLayoutState();
  const [layouts, setLayouts] = useState<GridItemLayout[]>(initialState.layouts);
  const [widgets, setWidgets] = useState<WidgetInstance[]>(initialState.widgets);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save to localStorage
  const saveState = useCallback((newLayouts: GridItemLayout[], newWidgets: WidgetInstance[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      layoutService.saveLayout({
        version: 1,
        layouts: newLayouts,
        widgets: newWidgets,
      });
    }, 500);
  }, []);

  const updateLayouts = useCallback((newLayouts: GridItemLayout[]) => {
    setLayouts(newLayouts);
    saveState(newLayouts, widgets);
  }, [widgets, saveState]);

  const canAddWidget = useCallback(() => {
    return widgets.length < GRID_CONFIG.maxWidgets;
  }, [widgets.length]);

  const addWidget = useCallback((type: WidgetType, title: string, props: Record<string, unknown>) => {
    if (!canAddWidget()) {
      alert(`Maximum ${GRID_CONFIG.maxWidgets} widgets allowed`);
      return;
    }

    const newId = `${type}-${Date.now()}`;
    const newWidget: WidgetInstance = { i: newId, type, title, props };
    const newLayout = createLayoutItem(newId, type, layouts);

    const newWidgets = [...widgets, newWidget];
    const newLayouts = [...layouts, newLayout];

    setWidgets(newWidgets);
    setLayouts(newLayouts);
    saveState(newLayouts, newWidgets);
  }, [layouts, widgets, canAddWidget, saveState]);

  const addWidgetAtPosition = useCallback((
    type: WidgetType,
    title: string,
    props: Record<string, unknown>,
    x: number,
    y: number
  ) => {
    if (!canAddWidget()) {
      alert(`Maximum ${GRID_CONFIG.maxWidgets} widgets allowed`);
      return;
    }

    const newId = `${type}-${Date.now()}`;
    const newWidget: WidgetInstance = { i: newId, type, title, props };

    // Get size config for this widget type
    const size = DEFAULT_WIDGET_SIZES[type];

    const newLayout: GridItemLayout = {
      i: newId,
      x,
      y,
      w: size.w,
      h: size.h,
      minW: size.minW,
      minH: size.minH,
    };

    const newWidgets = [...widgets, newWidget];
    const newLayouts = [...layouts, newLayout];

    setWidgets(newWidgets);
    setLayouts(newLayouts);
    saveState(newLayouts, newWidgets);
  }, [layouts, widgets, canAddWidget, saveState]);

  const removeWidget = useCallback((widgetId: string) => {
    const newWidgets = widgets.filter(w => w.i !== widgetId);
    const newLayouts = layouts.filter(l => l.i !== widgetId);

    setWidgets(newWidgets);
    setLayouts(newLayouts);
    saveState(newLayouts, newWidgets);
  }, [widgets, layouts, saveState]);

  const resetLayout = useCallback(() => {
    setWidgets([]);
    setLayouts([]);
    layoutService.clearLayout();
  }, []);

  const value: LayoutContextType = {
    layouts,
    widgets,
    updateLayouts,
    addWidget,
    addWidgetAtPosition,
    removeWidget,
    resetLayout,
    canAddWidget,
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
