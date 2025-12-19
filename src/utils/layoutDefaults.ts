import type { DashboardLayoutState, GridConfig, WidgetSizeConfig, GridItemLayout, WidgetType } from '../types/gridLayout.types';

// Grid configuration constants
export const GRID_CONFIG: GridConfig = {
  cols: 12,
  rowHeight: 100,
  margin: [8, 8],
  containerPadding: [8, 8],
  maxWidgets: 15,
};

// Default widget dimensions (in grid units)
export const DEFAULT_WIDGET_SIZES: Record<WidgetType, WidgetSizeConfig> = {
  chart: { w: 4, h: 4, minW: 3, minH: 3 },
  screener: { w: 6, h: 4, minW: 4, minH: 3 },
  watchlist: { w: 3, h: 4, minW: 2, minH: 3 },
};

// Default empty layout state
export const defaultLayoutState: DashboardLayoutState = {
  version: 1,
  layouts: [],
  widgets: [],
};

// Calculate position for a new widget
export const calculateNewWidgetPosition = (
  existingLayouts: GridItemLayout[],
  widgetType: WidgetType
): { x: number; y: number } => {
  const size = DEFAULT_WIDGET_SIZES[widgetType];

  if (existingLayouts.length === 0) {
    return { x: 0, y: 0 };
  }

  // Find the lowest point in the grid
  const maxY = Math.max(...existingLayouts.map(l => l.y + l.h));

  // Try to find space in the last row
  const itemsInLastRows = existingLayouts.filter(l => l.y + l.h >= maxY - 4);

  // Calculate total width used in the area
  let x = 0;
  for (const item of itemsInLastRows.sort((a, b) => a.x - b.x)) {
    if (item.x >= x && item.x < x + size.w) {
      x = item.x + item.w;
    }
  }

  // If we can fit in the current row area, use it
  if (x + size.w <= GRID_CONFIG.cols) {
    const y = itemsInLastRows.length > 0
      ? Math.max(...itemsInLastRows.filter(l => l.x < x + size.w && l.x + l.w > x).map(l => l.y), 0)
      : 0;
    return { x, y };
  }

  // Otherwise, place at the bottom
  return { x: 0, y: maxY };
};

// Create a new layout item for a widget
export const createLayoutItem = (
  id: string,
  widgetType: WidgetType,
  existingLayouts: GridItemLayout[]
): GridItemLayout => {
  const size = DEFAULT_WIDGET_SIZES[widgetType];
  const position = calculateNewWidgetPosition(existingLayouts, widgetType);

  return {
    i: id,
    x: position.x,
    y: position.y,
    w: size.w,
    h: size.h,
    minW: size.minW,
    minH: size.minH,
  };
};
