export interface ScreenerWidgetProps {
  widgetId: string;
}

export type SortField = 'symbol' | 'name' | 'price' | 'change' | 'changePercent' | 'volume' | 'marketCap';
export type SortDirection = 'asc' | 'desc';
