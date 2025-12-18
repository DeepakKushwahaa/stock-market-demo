// import { StockData, ChartDataPoint } from '../types/stock.types';

const STOCK_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'PG', name: 'Procter & Gamble Co.' },
  { symbol: 'MA', name: 'Mastercard Inc.' },
  { symbol: 'HD', name: 'Home Depot Inc.' },
  { symbol: 'DIS', name: 'Walt Disney Company' },
  { symbol: 'BAC', name: 'Bank of America Corp.' },
  { symbol: 'ADBE', name: 'Adobe Inc.' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'CRM', name: 'Salesforce Inc.' },
  { symbol: 'ORCL', name: 'Oracle Corporation' },
  { symbol: 'CSCO', name: 'Cisco Systems Inc.' },
  { symbol: 'INTC', name: 'Intel Corporation' },
  { symbol: 'AMD', name: 'Advanced Micro Devices Inc.' },
  { symbol: 'PYPL', name: 'PayPal Holdings Inc.' },
  { symbol: 'UBER', name: 'Uber Technologies Inc.' },
  { symbol: 'SPOT', name: 'Spotify Technology SA' },
  { symbol: 'SQ', name: 'Block Inc.' },
  { symbol: 'COIN', name: 'Coinbase Global Inc.' },
  { symbol: 'SHOP', name: 'Shopify Inc.' },
  { symbol: 'ZM', name: 'Zoom Video Communications' },
];

class MockDataService {
  private stockCache: Map<string, any> = new Map();
  private chartCache: Map<string, any[]> = new Map();

  constructor() {
    this.initializeStockData();
  }

  private initializeStockData(): void {
    STOCK_SYMBOLS.forEach(({ symbol, name }) => {
      const price = this.randomPrice(50, 500);
      const change = this.randomChange(-10, 10);
      const changePercent = (change / price) * 100;

      this.stockCache.set(symbol, {
        symbol,
        name,
        price,
        change,
        changePercent,
        volume: this.randomVolume(),
        marketCap: this.randomMarketCap(),
        high: price + Math.abs(change) * 1.5,
        low: price - Math.abs(change) * 1.5,
        open: price - change * 0.5,
        previousClose: price - change,
      });
    });
  }

  private randomPrice(min: number, max: number): number {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
  }

  private randomChange(min: number, max: number): number {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
  }

  private randomVolume(): number {
    return Math.floor(Math.random() * 50000000) + 1000000;
  }

  private randomMarketCap(): number {
    return Math.floor(Math.random() * 2000000000000) + 10000000000;
  }

  getStockData(symbol: string): any | undefined {
    return this.stockCache.get(symbol);
  }

  getAllStocks(): any[] {
    return Array.from(this.stockCache.values());
  }

  getChartData(symbol: string, interval: '1D' | '1W' | '1M' | '1Y' = '1D'): any[] {
    const cacheKey = `${symbol}-${interval}`;

    if (this.chartCache.has(cacheKey)) {
      return this.chartCache.get(cacheKey)!;
    }

    const stockData = this.getStockData(symbol);
    if (!stockData) {
      return [];
    }

    const dataPoints = this.generateChartData(stockData, interval);
    this.chartCache.set(cacheKey, dataPoints);

    return dataPoints;
  }

  private generateChartData(stock: any, interval: '1D' | '1W' | '1M' | '1Y'): any[] {
    const dataPoints: any[] = [];
    const now = Date.now();

    let numPoints: number;
    let timeInterval: number;

    switch (interval) {
      case '1D':
        numPoints = 78; // 6.5 hours * 12 (5-min intervals)
        timeInterval = 5 * 60 * 1000; // 5 minutes
        break;
      case '1W':
        numPoints = 35; // 5 trading days * 7 hours
        timeInterval = 60 * 60 * 1000; // 1 hour
        break;
      case '1M':
        numPoints = 21; // ~21 trading days
        timeInterval = 24 * 60 * 60 * 1000; // 1 day
        break;
      case '1Y':
        numPoints = 52; // 52 weeks
        timeInterval = 7 * 24 * 60 * 60 * 1000; // 1 week
        break;
    }

    let currentPrice = stock.previousClose;

    for (let i = numPoints - 1; i >= 0; i--) {
      const timestamp = now - i * timeInterval;
      const volatility = currentPrice * 0.02; // 2% volatility

      const open = currentPrice;
      const change = (Math.random() - 0.5) * volatility;
      const close = currentPrice + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      const volume = this.randomVolume();

      dataPoints.push({
        timestamp,
        date: new Date(timestamp).toISOString(),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume,
      });

      currentPrice = close;
    }

    return dataPoints;
  }

  updateStockPrices(): void {
    this.stockCache.forEach((stock, symbol) => {
      const volatility = stock.price * 0.005; // 0.5% volatility
      const priceChange = (Math.random() - 0.5) * volatility;
      const newPrice = parseFloat((stock.price + priceChange).toFixed(2));
      const newChange = parseFloat((stock.change + priceChange).toFixed(2));
      const newChangePercent = (newChange / stock.previousClose) * 100;

      this.stockCache.set(symbol, {
        ...stock,
        price: newPrice,
        change: newChange,
        changePercent: parseFloat(newChangePercent.toFixed(2)),
        high: Math.max(stock.high, newPrice),
        low: Math.min(stock.low, newPrice),
      });
    });

    // Clear chart cache to force regeneration
    this.chartCache.clear();
  }
}

export const mockDataService = new MockDataService();
