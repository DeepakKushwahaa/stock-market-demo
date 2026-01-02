import type { DashboardLayoutState, GridConfig, WidgetSizeConfig, GridItemLayout, WidgetType, LayoutPreset, PresetName } from '../types/gridLayout.types';

// Grid configuration constants
export const GRID_CONFIG: GridConfig = {
  cols: 25,
  rowHeight: 26,
  margin: [7, 7],
  containerPadding: [8, 8],
  maxWidgets: 10,
};

// Default widget dimensions (in grid units)
export const DEFAULT_WIDGET_SIZES: Record<WidgetType, WidgetSizeConfig> = {
  chart: { w: 8, h: 14, minW: 5, minH: 6 },
  screener: { w: 10, h: 14, minW: 5, minH: 6 },
  watchlist: { w: 6, h: 14, minW: 5, minH: 6 },
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

// Layout presets for quick setup
export const LAYOUT_PRESETS: Record<PresetName, LayoutPreset> = {
  trading: {
    name: 'Trading',
    description: 'Optimized for active trading with chart and watchlist',
    icon: '📊',
    layouts: [
      { i: 'chart-trading-1', x: 0, y: 0, w: 8, h: 8, minW: 3, minH: 6 },
      { i: 'watchlist-trading-1', x: 8, y: 0, w: 4, h: 8, minW: 2, minH: 6 },
    ],
    widgets: [
      { i: 'chart-trading-1', type: 'chart', title: 'AAPL Chart', props: { symbol: 'AAPL' } },
      { i: 'watchlist-trading-1', type: 'watchlist', title: 'Watchlist', props: {} },
    ],
  },
  analysis: {
    name: 'Analysis',
    description: 'Multiple charts with screener for market analysis',
    icon: '📈',
    layouts: [
      { i: 'chart-analysis-1', x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 6 },
      { i: 'chart-analysis-2', x: 6, y: 0, w: 6, h: 8, minW: 3, minH: 6 },
      { i: 'screener-analysis-1', x: 0, y: 8, w: 12, h: 6, minW: 4, minH: 6 },
    ],
    widgets: [
      { i: 'chart-analysis-1', type: 'chart', title: 'AAPL Chart', props: { symbol: 'AAPL' } },
      { i: 'chart-analysis-2', type: 'chart', title: 'GOOGL Chart', props: { symbol: 'GOOGL' } },
      { i: 'screener-analysis-1', type: 'screener', title: 'Screener', props: {} },
    ],
  },
  compact: {
    name: 'Compact',
    description: 'Minimal layout for quick overview',
    icon: '📱',
    layouts: [
      { i: 'chart-compact-1', x: 0, y: 0, w: 6, h: 6, minW: 3, minH: 6 },
      { i: 'watchlist-compact-1', x: 6, y: 0, w: 6, h: 6, minW: 2, minH: 6 },
    ],
    widgets: [
      { i: 'chart-compact-1', type: 'chart', title: 'AAPL Chart', props: { symbol: 'AAPL' } },
      { i: 'watchlist-compact-1', type: 'watchlist', title: 'Watchlist', props: {} },
    ],
  },
};
