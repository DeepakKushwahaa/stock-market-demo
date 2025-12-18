export const STORAGE_KEYS = {
  LAYOUT: 'stock-dashboard-layout',
  WATCHLIST: 'stock-dashboard-watchlist',
} as const;

export const DEFAULT_STOCKS = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA'];

export const UPDATE_INTERVALS = {
  STOCK_DATA: 3000, // 3 seconds
  CHART_DATA: 5000, // 5 seconds
} as const;
