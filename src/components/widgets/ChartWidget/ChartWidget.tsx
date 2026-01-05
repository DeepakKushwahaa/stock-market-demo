import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useStockData, useChartData } from '../../../hooks/useStockData';
// import { ChartWidgetProps } from './types';

export const ChartWidget: React.FC<any> = ({ symbol = 'AAPL', interval: initialInterval = '1D' }) => {
  const [interval, setInterval] = useState<'1D' | '1W' | '1M' | '1Y'>(initialInterval);
  const { data: stockData, loading: stockLoading } = useStockData(symbol);
  const { data: chartData, loading: chartLoading } = useChartData(symbol, interval);

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    if (interval === '1D') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (interval === '1W') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  if (stockLoading || chartLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!stockData) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-slate-400">No data available</div>
      </div>
    );
  }

  const changeColor = stockData.change >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const lineColor = stockData.change >= 0 ? '#10b981' : '#f43f5e';

  return (
    <div className="h-full flex flex-col bg-white text-slate-800 p-4!">
      {/* Header */}
      <div className="mb-3!">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-bold text-slate-800">{symbol}</h2>
          <span className="text-slate-500 text-xs">{stockData.name}</span>
        </div>
        <div className="flex items-baseline gap-3 mt-1!">
          <span className="text-md font-semibold text-slate-900">{formatPrice(stockData.price)}</span>
          <span className={`text-xs font-medium ${changeColor}`}>
            {stockData.change >= 0 ? '+' : ''}{formatPrice(stockData.change)}
          </span>
          <span className={`text-xs ${changeColor}`}>
            ({stockData.changePercent >= 0 ? '+' : ''}{stockData.changePercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Interval Selector */}
      <div className="flex gap-1.5 mb-3!">
        {(['1D', '1W', '1M', '1Y'] as const).map((int) => (
          <button
            key={int}
            onClick={() => setInterval(int)}
            className={`px-2! py-1! rounded-md text-xs font-semibold transition-all ${
              interval === int
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {int}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatDate}
              stroke="#94a3b8"
              style={{ fontSize: '11px' }}
            />
            <YAxis
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              stroke="#94a3b8"
              style={{ fontSize: '11px' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                color: '#334155',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
              labelFormatter={(label) => formatDate(Number(label))}
              formatter={(value: any) => [formatPrice(value), 'Price']}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mt-3! pt-3! border-t border-slate-100">
        <div>
          <div className="text-slate-500 text-xs">Open</div>
          <div className="font-semibold text-slate-700 text-sm">{formatPrice(stockData.open)}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs">High</div>
          <div className="font-semibold text-emerald-600 text-sm">{formatPrice(stockData.high)}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs">Low</div>
          <div className="font-semibold text-rose-600 text-sm">{formatPrice(stockData.low)}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs">Volume</div>
          <div className="font-semibold text-slate-700 text-sm">{(stockData.volume / 1000000).toFixed(2)}M</div>
        </div>
      </div>
    </div>
  );
};
