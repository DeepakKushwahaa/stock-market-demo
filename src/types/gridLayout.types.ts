// Widget types available in the application
export type WidgetType = 'chart' | 'screener' | 'watchlist';

// Widget instance stored in our layout
export interface WidgetInstance {
  i: string;              // Unique identifier (matches Layout.i)
  type: WidgetType;       // Widget component type
  title: string;          // Display title for header
  props: Record<string, unknown>;  // Props to pass to widget component
}

// Grid item layout - matches react-grid-layout's Layout interface
export interface GridItemLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  moved?: boolean;
  isBounded?: boolean;
}

// Complete dashboard state for localStorage
export interface DashboardLayoutState {
  version: number;        // Schema version for migrations
  layouts: GridItemLayout[];
  widgets: WidgetInstance[];
}

// Default grid configuration constants
export interface GridConfig {
  cols: number;
  rowHeight: number;
  margin: [number, number];
  containerPadding: [number, number];
  maxWidgets: number;
}

// Drag data from WidgetPanel
export interface WidgetDragData {
  type: WidgetType;
  title: string;
  props: Record<string, unknown>;
}

// Widget size configuration
export interface WidgetSizeConfig {
  w: number;
  h: number;
  minW: number;
  minH: number;
}

// Layout preset type
export type PresetName = 'trading' | 'analysis' | 'compact';

// Layout preset configuration
export interface LayoutPreset {
  name: string;
  description: string;
  icon: string;
  layouts: GridItemLayout[];
  widgets: WidgetInstance[];
}
