import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { GridItemLayout, WidgetInstance, WidgetType, DashboardLayoutState, PresetName } from '../types/gridLayout.types';
import { defaultLayoutState, GRID_CONFIG, DEFAULT_WIDGET_SIZES, LAYOUT_PRESETS } from '../utils/layoutDefaults';
import { layoutService } from '../services/layoutService';
import { calculateAutoAdjustForNewWidget, type WidgetMinSizes } from '../utils/gridHelpers';

// Preview widget position type
interface PreviewWidget {
  type: WidgetType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  // Preview widget on hover
  previewWidget: PreviewWidget | null;
  setPreviewWidget: (type: WidgetType | null, title?: string) => void;
  // Newly added widget highlight
  newlyAddedWidgetId: string | null;
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
  const [previewWidget, setPreviewWidgetState] = useState<PreviewWidget | null>(null);
  const [newlyAddedWidgetId, setNewlyAddedWidgetId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const addWidget = useCallback((type: WidgetType, title: string, props: Record<string, unknown>) => {
    const size = DEFAULT_WIDGET_SIZES[type];

    // Build widget min sizes map for auto-adjustment
    const widgetMinSizes: WidgetMinSizes = {};
    for (const widget of widgets) {
      const widgetSize = DEFAULT_WIDGET_SIZES[widget.type];
      widgetMinSizes[widget.i] = { minW: widgetSize.minW, minH: widgetSize.minH };
    }

    // Use auto-adjust to find space, shrinking existing widgets if needed
    const autoAdjust = calculateAutoAdjustForNewWidget(
      layouts,
      size.w,
      size.h,
      GRID_CONFIG.cols,
      maxRows,
      widgetMinSizes,
      GRID_CONFIG.maxWidgets
    );

    if (!autoAdjust.canAdd || !autoAdjust.newWidgetPosition) {
      alert('Not enough space for this widget. Please remove existing widgets.');
      return;
    }

    const newId = `${type}-${Date.now()}`;
    const newWidget: WidgetInstance = { i: newId, type, title, props };

    // Create new layout at the found position
    const newLayout: GridItemLayout = {
      i: newId,
      x: autoAdjust.newWidgetPosition.x,
      y: autoAdjust.newWidgetPosition.y,
      w: size.w,
      h: size.h,
      minW: size.minW,
      minH: size.minH,
    };

    // Use adjusted layouts (which may have shrunk existing widgets)
    const newWidgets = [...widgets, newWidget];
    const newLayouts = [...autoAdjust.adjustedLayouts, newLayout];

    setWidgets(newWidgets);
    setLayouts(newLayouts);
    saveState(newLayouts, newWidgets);

    // Highlight newly added widget for 2 seconds
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    setNewlyAddedWidgetId(newId);
    highlightTimeoutRef.current = setTimeout(() => {
      setNewlyAddedWidgetId(null);
    }, 2000);
  }, [layouts, widgets, maxRows, saveState]);

  const addWidgetAtPosition = useCallback((
    type: WidgetType,
    title: string,
    props: Record<string, unknown>,
    x: number,
    y: number
  ) => {
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
  }, [layouts, widgets, saveState]);

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

  // Set preview widget - calculates position automatically
  const setPreviewWidget = useCallback((type: WidgetType | null, title?: string) => {
    if (!type) {
      setPreviewWidgetState(null);
      return;
    }

    // Check if there's space for this widget
    const size = DEFAULT_WIDGET_SIZES[type];
    const cols = GRID_CONFIG.cols;
    const widgetWidth = size.w;
    const widgetHeight = size.h;

    // Use a reasonable minimum maxRows if not set yet
    const effectiveMaxRows = Math.max(maxRows, 10);

    // If maxRows is too small for the widget, no space available
    if (effectiveMaxRows < widgetHeight) {
      setPreviewWidgetState(null);
      return;
    }

    // Create a grid to track occupied cells
    const grid: boolean[][] = [];
    for (let row = 0; row < effectiveMaxRows; row++) {
      grid[row] = new Array(cols).fill(false);
    }

    // Mark occupied cells
    for (const layout of layouts) {
      for (let row = layout.y; row < layout.y + layout.h && row < effectiveMaxRows; row++) {
        for (let col = layout.x; col < layout.x + layout.w && col < cols; col++) {
          if (row >= 0 && row < effectiveMaxRows && col >= 0 && col < cols) {
            grid[row][col] = true;
          }
        }
      }
    }

    // Find first available position for the widget
    for (let row = 0; row <= effectiveMaxRows - widgetHeight; row++) {
      for (let col = 0; col <= cols - widgetWidth; col++) {
        let canFit = true;
        for (let r = row; r < row + widgetHeight && canFit; r++) {
          for (let c = col; c < col + widgetWidth && canFit; c++) {
            if (grid[r] && grid[r][c]) {
              canFit = false;
            }
          }
        }
        if (canFit) {
          setPreviewWidgetState({
            type,
            title: title || type.toUpperCase(),
            x: col,
            y: row,
            w: widgetWidth,
            h: widgetHeight,
          });
          return;
        }
      }
    }

    // No space available
    setPreviewWidgetState(null);
  }, [layouts, maxRows]);

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
    previewWidget,
    setPreviewWidget,
    newlyAddedWidgetId,
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
