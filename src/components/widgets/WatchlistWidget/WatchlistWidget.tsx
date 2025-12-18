import React, { useState, useEffect } from 'react';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { mockDataService } from '../../../services/mockDataService';
// import { StockData } from '../../../types/stock.types';
// import { WatchlistWidgetProps } from './types';
import { DEFAULT_STOCKS, STORAGE_KEYS } from '../../../utils/constants';

export const WatchlistWidget: React.FC<any> = ({ symbols: initialSymbols }) => {
  const [watchlist, setWatchlist] = useLocalStorage<string[]>(
    STORAGE_KEYS.WATCHLIST,
    initialSymbols || DEFAULT_STOCKS
  );
  const [stocksData, setStocksData] = useState<any[]>([]);
  const [newSymbol, setNewSymbol] = useState('');

  useEffect(() => {
    const updateData = () => {
      const data = watchlist
        .map((symbol) => mockDataService.getStockData(symbol))
        .filter((stock): stock is any => stock !== undefined);
      setStocksData(data);
    };

    updateData();
    const interval = setInterval(updateData, 3000);

    return () => clearInterval(interval);
  }, [watchlist]);

  const handleAddSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    const symbol = newSymbol.toUpperCase().trim();

    if (!symbol) return;

    if (watchlist.includes(symbol)) {
      alert(`${symbol} is already in your watchlist`);
      return;
    }

    const stockData = mockDataService.getStockData(symbol);
    if (!stockData) {
      alert(`Symbol ${symbol} not found`);
      return;
    }

    setWatchlist([...watchlist, symbol]);
    setNewSymbol('');
  };

  const handleRemove = (symbol: string) => {
    setWatchlist(watchlist.filter((s) => s !== symbol));
  };

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white p-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold mb-3">Watchlist</h2>
        <form onSubmit={handleAddSymbol} className="flex gap-2">
          <input
            type="text"
            placeholder="Add symbol (e.g. AAPL)"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition-colors text-sm"
          >
            Add
          </button>
        </form>
      </div>

      {/* Stock List */}
      <div className="flex-1 overflow-auto space-y-2">
        {stocksData.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No stocks in watchlist</div>
        ) : (
          stocksData.map((stock) => {
            const changeColor = stock.change >= 0 ? 'text-green-500' : 'text-red-500';
            const bgColor = stock.change >= 0 ? 'bg-green-500/10' : 'bg-red-500/10';

            return (
              <div
                key={stock.symbol}
                className="bg-gray-800 rounded-lg p-3 hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg">{stock.symbol}</h3>
                      <button
                        onClick={() => handleRemove(stock.symbol)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove from watchlist"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="text-gray-400 text-sm truncate">{stock.name}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-lg">{formatPrice(stock.price)}</div>
                    <div className={`text-sm font-medium ${changeColor}`}>
                      {stock.change >= 0 ? '+' : ''}
                      {formatPrice(stock.change)} ({stock.change >= 0 ? '+' : ''}
                      {stock.changePercent.toFixed(2)}%)
                    </div>
                  </div>
                </div>

                {/* Additional stats */}
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <div>
                    <div className="text-gray-400">Open</div>
                    <div className="font-medium">{formatPrice(stock.open)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">High</div>
                    <div className="font-medium text-green-400">{formatPrice(stock.high)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Low</div>
                    <div className="font-medium text-red-400">{formatPrice(stock.low)}</div>
                  </div>
                </div>

                {/* Volume bar */}
                <div className="mt-2">
                  <div className="text-xs text-gray-400 mb-1">
                    Volume: {(stock.volume / 1000000).toFixed(2)}M
                  </div>
                  <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${bgColor} rounded-full`}
                      style={{ width: `${Math.min((stock.volume / 50000000) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
