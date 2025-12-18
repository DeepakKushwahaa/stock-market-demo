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
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!stockData) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-gray-400">No data available</div>
      </div>
    );
  }

  const changeColor = stockData.change >= 0 ? 'text-green-500' : 'text-red-500';
  const lineColor = stockData.change >= 0 ? '#10b981' : '#ef4444';

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white p-4">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-2xl font-bold">{symbol}</h2>
          <span className="text-gray-400 text-sm">{stockData.name}</span>
        </div>
        <div className="flex items-baseline gap-3 mt-2">
          <span className="text-3xl font-semibold">{formatPrice(stockData.price)}</span>
          <span className={`text-lg ${changeColor}`}>
            {stockData.change >= 0 ? '+' : ''}{formatPrice(stockData.change)}
          </span>
          <span className={`text-lg ${changeColor}`}>
            ({stockData.changePercent >= 0 ? '+' : ''}{stockData.changePercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Interval Selector */}
      <div className="flex gap-2 mb-4">
        {(['1D', '1W', '1M', '1Y'] as const).map((int) => (
          <button
            key={int}
            onClick={() => setInterval(int)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              interval === int
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
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
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatDate}
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              stroke="#9ca3af"
              style={{ fontSize: '12px' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#fff',
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
              animationDuration={300}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
        <div>
          <div className="text-gray-400">Open</div>
          <div className="font-semibold">{formatPrice(stockData.open)}</div>
        </div>
        <div>
          <div className="text-gray-400">High</div>
          <div className="font-semibold">{formatPrice(stockData.high)}</div>
        </div>
        <div>
          <div className="text-gray-400">Low</div>
          <div className="font-semibold">{formatPrice(stockData.low)}</div>
        </div>
        <div>
          <div className="text-gray-400">Volume</div>
          <div className="font-semibold">{(stockData.volume / 1000000).toFixed(2)}M</div>
        </div>
      </div>
    </div>
  );
};
