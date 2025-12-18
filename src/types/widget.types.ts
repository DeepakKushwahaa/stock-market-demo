export type WidgetType = 'chart' | 'screener' | 'watchlist';

export interface BaseWidgetProps {
  widgetId: string;
}

export interface ChartWidgetProps extends BaseWidgetProps {
  symbol?: string;
  interval?: '1D' | '1W' | '1M' | '1Y';
}

export interface ScreenerWidgetProps extends BaseWidgetProps {
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    minVolume?: number;
    sector?: string;
  };
}

export interface WatchlistWidgetProps extends BaseWidgetProps {
  symbols?: string[];
}

export interface WidgetDefinition {
  id: any;
  name: any;
  icon: any;
  description: any;
  symbol?: string; // For chart widgets
}
