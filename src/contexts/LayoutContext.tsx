import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { GridItemLayout, WidgetInstance, WidgetType, DashboardLayoutState, PresetName } from '../types/gridLayout.types';
import { defaultLayoutState, GRID_CONFIG, DEFAULT_WIDGET_SIZES, LAYOUT_PRESETS } from '../utils/layoutDefaults';
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
  // Panel toggle
  isWidgetPanelOpen: boolean;
  toggleWidgetPanel: () => void;
  setWidgetPanelOpen: (open: boolean) => void;
  // Presets
  loadPreset: (presetName: PresetName) => void;
  // Max rows for viewport constraint
  setMaxRows: (rows: number) => void;
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
  const [isWidgetPanelOpen, setIsWidgetPanelOpen] = useState(true);
  const [maxRows, setMaxRowsState] = useState<number>(10);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMaxRows = useCallback((rows: number) => {
    setMaxRowsState(rows);
  }, []);

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

  // Check if there's enough space for a widget of given size
  const hasSpaceForWidget = useCallback((widgetType: WidgetType): { hasSpace: boolean; position: { x: number; y: number } | null } => {
    const size = DEFAULT_WIDGET_SIZES[widgetType];
    const cols = GRID_CONFIG.cols;

    // Use actual widget size (w, h) not minimum size
    const widgetWidth = size.w;
    const widgetHeight = size.h;

    // If maxRows is not set yet or too small, no space available
    if (maxRows < widgetHeight) {
      return { hasSpace: false, position: null };
    }

    // Create a grid to track occupied cells
    const grid: boolean[][] = [];
    for (let row = 0; row < maxRows; row++) {
      grid[row] = new Array(cols).fill(false);
    }

    // Mark occupied cells
    for (const layout of layouts) {
      for (let row = layout.y; row < layout.y + layout.h && row < maxRows; row++) {
        for (let col = layout.x; col < layout.x + layout.w && col < cols; col++) {
          if (grid[row]) {
            grid[row][col] = true;
          }
        }
      }
    }

    // Find first available position for the widget using actual size
    for (let row = 0; row <= maxRows - widgetHeight; row++) {
      for (let col = 0; col <= cols - widgetWidth; col++) {
        let canFit = true;
        // Check if the widget can fit at this position
        for (let r = row; r < row + widgetHeight && canFit; r++) {
          for (let c = col; c < col + widgetWidth && canFit; c++) {
            if (r >= maxRows || c >= cols || (grid[r] && grid[r][c])) {
              canFit = false;
            }
          }
        }
        if (canFit) {
          return { hasSpace: true, position: { x: col, y: row } };
        }
      }
    }

    return { hasSpace: false, position: null };
  }, [layouts, maxRows]);

  const addWidget = useCallback((type: WidgetType, title: string, props: Record<string, unknown>) => {
    if (!canAddWidget()) {
      alert(`Maximum ${GRID_CONFIG.maxWidgets} widgets allowed`);
      return;
    }

    // Check if there's space for this widget
    const spaceCheck = hasSpaceForWidget(type);
    if (!spaceCheck.hasSpace || !spaceCheck.position) {
      alert('Not enough space for this widget. Please remove or resize existing widgets.');
      return;
    }

    const newId = `${type}-${Date.now()}`;
    const newWidget: WidgetInstance = { i: newId, type, title, props };

    // Use the found position instead of auto-calculated one
    const size = DEFAULT_WIDGET_SIZES[type];
    const newLayout: GridItemLayout = {
      i: newId,
      x: spaceCheck.position.x,
      y: spaceCheck.position.y,
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
  }, [layouts, widgets, canAddWidget, hasSpaceForWidget, saveState]);

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

  const toggleWidgetPanel = useCallback(() => {
    setIsWidgetPanelOpen(prev => !prev);
  }, []);

  const setWidgetPanelOpen = useCallback((open: boolean) => {
    setIsWidgetPanelOpen(open);
  }, []);

  const loadPreset = useCallback((presetName: PresetName) => {
    const preset = LAYOUT_PRESETS[presetName];
    if (!preset) return;

    // Deep clone to avoid mutation issues
    const newLayouts = preset.layouts.map(l => ({ ...l }));
    const newWidgets = preset.widgets.map(w => ({ ...w, props: { ...w.props } }));

    setLayouts(newLayouts);
    setWidgets(newWidgets);
    saveState(newLayouts, newWidgets);
  }, [saveState]);

  const value: LayoutContextType = {
    layouts,
    widgets,
    updateLayouts,
    addWidget,
    addWidgetAtPosition,
    removeWidget,
    resetLayout,
    canAddWidget,
    isWidgetPanelOpen,
    toggleWidgetPanel,
    setWidgetPanelOpen,
    loadPreset,
    setMaxRows,
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
