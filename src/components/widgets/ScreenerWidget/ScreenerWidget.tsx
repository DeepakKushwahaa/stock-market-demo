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
    if (sortField !== field) return <span className="text-slate-300">⇅</span>;
    return <span className="text-emerald-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white text-slate-800 p-4!">
      {/* Header */}
      <div className="mb-3!">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by symbol or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10! pr-4! py-2! bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr className="border-b border-slate-200">
              <th
                className="px-3! py-2.5! text-xs text-left font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('symbol')}
              >
                <div className="flex items-center gap-1.5">
                  Symbol <SortIcon field="symbol" />
                </div>
              </th>
              <th
                className="px-3! py-2.5! text-xs text-left font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1.5">
                  Name <SortIcon field="name" />
                </div>
              </th>
              <th
                className="px-3! py-2.5! text-right text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('price')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  Price <SortIcon field="price" />
                </div>
              </th>
              <th
                className="px-3! py-2.5! text-xs text-right font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('change')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  Change <SortIcon field="change" />
                </div>
              </th>
              <th
                className="px-3! py-2.5! text-xs text-right font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('changePercent')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  % <SortIcon field="changePercent" />
                </div>
              </th>
              <th
                className="px-3! py-2.5! text-xs text-right font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('volume')}
              >
                <div className="flex items-center justify-end gap-1.5">
                  Vol <SortIcon field="volume" />
                </div>
              </th>
              <th
                className="px-3! py-2.5! text-xs text-right font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('marketCap')}
              >
                <div className="flex items-center justify-end gap-1.5 text-xs">
                  MCap <SortIcon field="marketCap" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAndFilteredStocks.map((stock, index) => {
              const changeColor = stock.change >= 0 ? 'text-emerald-600' : 'text-rose-600';
              return (
                <tr
                  key={stock.symbol}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                  }`}
                >
                  <td className="px-3! py-2! text-xs font-semibold text-slate-800">{stock.symbol}</td>
                  <td className="px-3! py-2! text-xs text-slate-500 truncate max-w-30">{stock.name}</td>
                  <td className="px-3! py-2! text-right text-xs font-medium text-slate-700">{formatPrice(stock.price)}</td>
                  <td className={`px-3! py-2! text-right text-xs font-medium ${changeColor}`}>
                    {stock.change >= 0 ? '+' : ''}
                    {formatPrice(stock.change)}
                  </td>
                  <td className={`px-3! py-2! text-right text-xs font-medium ${changeColor}`}>
                    {stock.changePercent >= 0 ? '+' : ''}
                    {stock.changePercent.toFixed(2)}%
                  </td>
                  <td className="px-3! py-2! text-right text-xs text-slate-500">{formatVolume(stock.volume)}</td>
                  <td className="px-3! py-2! text-right text-xs text-slate-500">
                    {formatMarketCap(stock.marketCap)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedAndFilteredStocks.length === 0 && (
          <div className="text-center text-slate-400 py-8!">No stocks found</div>
        )}
      </div>
    </div>
  );
};
