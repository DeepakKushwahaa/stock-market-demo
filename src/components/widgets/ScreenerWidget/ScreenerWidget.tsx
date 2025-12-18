import React, { useState, useMemo } from 'react';
import { useAllStocks } from '../../../hooks/useStockData';
// import { StockData } from '../../../types/stock.types';
// import { ScreenerWidgetProps, SortField, SortDirection } from './types';

export const ScreenerWidget: React.FC<any> = () => {
  const { data: stocks, loading } = useAllStocks();
  const [sortField, setSortField] = useState<any>('symbol');
  const [sortDirection, setSortDirection] = useState<any>('asc');
  const [searchQuery, setSearchQuery] = useState('');

  const sortedAndFilteredStocks = useMemo(() => {
    let filtered = stocks;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = stocks.filter(
        (stock) =>
          stock.symbol.toLowerCase().includes(query) || stock.name.toLowerCase().includes(query)
      );
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [stocks, sortField, sortDirection, searchQuery]);

  const handleSort = (field: any) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;
  const formatVolume = (volume: number) => {
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(2)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(2)}K`;
    return volume.toString();
  };
  const formatMarketCap = (marketCap: number) => {
    if (marketCap >= 1000000000000) return `$${(marketCap / 1000000000000).toFixed(2)}T`;
    if (marketCap >= 1000000000) return `$${(marketCap / 1000000000).toFixed(2)}B`;
    return `$${(marketCap / 1000000).toFixed(2)}M`;
  };

  const SortIcon = ({ field }: { field: any }) => {
    if (sortField !== field) return <span className="text-gray-600">⇅</span>;
    return <span className="text-blue-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white p-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold mb-3">Stock Screener</h2>
        <input
          type="text"
          placeholder="Search by symbol or name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-800 z-10">
            <tr className="border-b border-gray-700">
              <th
                className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => handleSort('symbol')}
              >
                <div className="flex items-center gap-2">
                  Symbol <SortIcon field="symbol" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-2">
                  Name <SortIcon field="name" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => handleSort('price')}
              >
                <div className="flex items-center justify-end gap-2">
                  Price <SortIcon field="price" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => handleSort('change')}
              >
                <div className="flex items-center justify-end gap-2">
                  Change <SortIcon field="change" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => handleSort('changePercent')}
              >
                <div className="flex items-center justify-end gap-2">
                  Change % <SortIcon field="changePercent" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => handleSort('volume')}
              >
                <div className="flex items-center justify-end gap-2">
                  Volume <SortIcon field="volume" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-right font-semibold cursor-pointer hover:bg-gray-700 transition-colors"
                onClick={() => handleSort('marketCap')}
              >
                <div className="flex items-center justify-end gap-2">
                  Market Cap <SortIcon field="marketCap" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAndFilteredStocks.map((stock) => {
              const changeColor = stock.change >= 0 ? 'text-green-500' : 'text-red-500';
              return (
                <tr
                  key={stock.symbol}
                  className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{stock.symbol}</td>
                  <td className="px-4 py-3 text-gray-400">{stock.name}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatPrice(stock.price)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${changeColor}`}>
                    {stock.change >= 0 ? '+' : ''}
                    {formatPrice(stock.change)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${changeColor}`}>
                    {stock.changePercent >= 0 ? '+' : ''}
                    {stock.changePercent.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">{formatVolume(stock.volume)}</td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {formatMarketCap(stock.marketCap)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedAndFilteredStocks.length === 0 && (
          <div className="text-center text-gray-400 py-8">No stocks found</div>
        )}
      </div>
    </div>
  );
};
