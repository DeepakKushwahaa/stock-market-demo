import React, { useState, useEffect } from 'react';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { mockDataService } from '../../../services/mockDataService';
import { useTheme } from '../../../contexts/ThemeContext';
import { DEFAULT_STOCKS, STORAGE_KEYS } from '../../../utils/constants';

export const WatchlistWidget: React.FC<any> = ({ symbols: initialSymbols }) => {
  const [watchlist, setWatchlist] = useLocalStorage<string[]>(
    STORAGE_KEYS.WATCHLIST,
    initialSymbols || DEFAULT_STOCKS
  );
  const [stocksData, setStocksData] = useState<any[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const { isDark } = useTheme();

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
    <div className={`h-full flex flex-col p-4! transition-colors ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-white text-slate-800'}`}>
      {/* Header */}
      <div className="mb-3!">
        <form onSubmit={handleAddSymbol} className="flex gap-2">
          <input
            type="text"
            placeholder="Add symbol (e.g. AAPL)"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            className={`flex-1 px-3! py-1.5! border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all ${
              isDark
                ? 'bg-slate-700 border-slate-600 text-slate-200 placeholder-slate-400'
                : 'bg-slate-50 border-slate-200 text-slate-700 placeholder-slate-400'
            }`}
          />
          <button
            type="submit"
            className="px-3! py-1.5! bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium transition-all text-sm shadow-sm cursor-pointer"
          >
            Add
          </button>
        </form>
      </div>

      {/* Stock List */}
      <div className="flex-1 overflow-auto space-y-2!">
        {stocksData.length === 0 ? (
          <div className={`text-center py-8! ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>No stocks in watchlist</div>
        ) : (
          stocksData.map((stock) => {
            const changeColor = stock.change >= 0 ? 'text-emerald-500' : 'text-rose-500';
            const bgColor = stock.change >= 0 ? 'bg-emerald-500' : 'bg-rose-500';
            const lightBgColor = isDark
              ? (stock.change >= 0 ? 'bg-emerald-900/30' : 'bg-rose-900/30')
              : (stock.change >= 0 ? 'bg-emerald-50' : 'bg-rose-50');

            return (
              <div
                key={stock.symbol}
                className={`${lightBgColor} rounded-xl p-3! hover:shadow-sm transition-all border ${isDark ? 'border-slate-700' : 'border-slate-100'}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-slate-800'}`}>{stock.symbol}</h3>
                      <button
                        onClick={() => handleRemove(stock.symbol)}
                        className={`transition-colors text-xs cursor-pointer ${isDark ? 'text-slate-500 hover:text-rose-400' : 'text-slate-400 hover:text-rose-500'}`}
                        title="Remove from watchlist"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <p className={`text-xs truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{stock.name}</p>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-slate-800'}`}>{formatPrice(stock.price)}</div>
                    <div className={`text-xs font-medium ${changeColor}`}>
                      {stock.change >= 0 ? '+' : ''}
                      {formatPrice(stock.change)} ({stock.change >= 0 ? '+' : ''}
                      {stock.changePercent.toFixed(2)}%)
                    </div>
                  </div>
                </div>

                {/* Additional stats */}
                <div className="grid grid-cols-3 gap-2 mt-2! text-xs">
                  <div>
                    <div className={isDark ? 'text-slate-400' : 'text-slate-500'}>Open</div>
                    <div className={`font-medium ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{formatPrice(stock.open)}</div>
                  </div>
                  <div>
                    <div className={isDark ? 'text-slate-400' : 'text-slate-500'}>High</div>
                    <div className="font-medium text-emerald-500">{formatPrice(stock.high)}</div>
                  </div>
                  <div>
                    <div className={isDark ? 'text-slate-400' : 'text-slate-500'}>Low</div>
                    <div className="font-medium text-rose-500">{formatPrice(stock.low)}</div>
                  </div>
                </div>

                {/* Volume bar */}
                <div className="mt-2!">
                  <div className={`text-xs mb-1! ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Volume: {(stock.volume / 1000000).toFixed(2)}M
                  </div>
                  <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`}>
                    <div
                      className={`h-full ${bgColor} rounded-full transition-all`}
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
