export interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
}

export interface ChartDataPoint {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistItem {
  symbol: string;
  addedAt: number;
  notes?: string;
}

export interface ScreenerFilters {
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  sector?: string;
  minMarketCap?: number;
}
