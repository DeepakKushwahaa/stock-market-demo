import { useState, useEffect } from 'react';
// import { StockData, ChartDataPoint } from '../types/stock.types';
import { mockDataService } from '../services/mockDataService';

export function useStockData(symbol?: string) {
  const [data, setData] = useState<any | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const stockData = mockDataService.getStockData(symbol);
    setData(stockData);
    setLoading(false);

    // Update every 3 seconds
    const interval = setInterval(() => {
      const updated = mockDataService.getStockData(symbol);
      setData(updated);
    }, 3000);

    return () => clearInterval(interval);
  }, [symbol]);

  return { data, loading };
}

export function useChartData(symbol?: string, interval: '1D' | '1W' | '1M' | '1Y' = '1D') {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const chartData = mockDataService.getChartData(symbol, interval);
    setData(chartData);
    setLoading(false);

    // Refresh chart data every 5 seconds
    const intervalId = setInterval(() => {
      const updated = mockDataService.getChartData(symbol, interval);
      setData(updated);
    }, 5000);

    return () => clearInterval(intervalId);
  }, [symbol, interval]);

  return { data, loading };
}

export function useAllStocks() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const allStocks = mockDataService.getAllStocks();
    setData(allStocks);
    setLoading(false);

    // Update every 3 seconds
    const interval = setInterval(() => {
      mockDataService.updateStockPrices();
      const updated = mockDataService.getAllStocks();
      setData(updated);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return { data, loading };
}
