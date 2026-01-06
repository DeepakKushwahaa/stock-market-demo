import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useStockData, useChartData } from '../../../hooks/useStockData';
import { useTheme } from '../../../contexts/ThemeContext';

export const ChartWidget: React.FC<any> = ({ symbol = 'AAPL', interval: initialInterval = '1D' }) => {
  const [interval, setInterval] = useState<'1D' | '1W' | '1M' | '1Y'>(initialInterval);
  const { data: stockData, loading: stockLoading } = useStockData(symbol);
  const { data: chartData, loading: chartLoading } = useChartData(symbol, interval);
  const { isDark } = useTheme();

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
      <div className={`h-full flex items-center justify-center ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
        <div className={isDark ? 'text-slate-500' : 'text-slate-400'}>Loading...</div>
      </div>
    );
  }

  if (!stockData) {
    return (
      <div className={`h-full flex items-center justify-center ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
        <div className={isDark ? 'text-slate-500' : 'text-slate-400'}>No data available</div>
      </div>
    );
  }

  const changeColor = stockData.change >= 0 ? 'text-emerald-500' : 'text-rose-500';
  const lineColor = stockData.change >= 0 ? '#10b981' : '#f43f5e';
  const gridColor = isDark ? '#334155' : '#e2e8f0';
  const axisColor = isDark ? '#64748b' : '#94a3b8';

  return (
    <div className={`h-full flex flex-col p-4! transition-colors ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-white text-slate-800'}`}>
      {/* Header */}
      <div className="mb-3!">
        <div className="flex items-baseline gap-2">
          <h2 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-800'}`}>{symbol}</h2>
          <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{stockData.name}</span>
        </div>
        <div className="flex items-baseline gap-3 mt-1!">
          <span className={`text-md font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>{formatPrice(stockData.price)}</span>
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
            className={`px-2! py-1! rounded-md text-xs font-semibold transition-all cursor-pointer ${
              interval === int
                ? 'bg-emerald-500 text-white shadow-sm'
                : isDark
                  ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
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
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatDate}
              stroke={axisColor}
              style={{ fontSize: '11px' }}
            />
            <YAxis
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              stroke={axisColor}
              style={{ fontSize: '11px' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#1e293b' : '#fff',
                border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                borderRadius: '8px',
                color: isDark ? '#e2e8f0' : '#334155',
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
      <div className={`grid grid-cols-4 gap-3 mt-3! pt-3! border-t ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
        <div>
          <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Open</div>
          <div className={`font-semibold text-sm ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{formatPrice(stockData.open)}</div>
        </div>
        <div>
          <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>High</div>
          <div className="font-semibold text-emerald-500 text-sm">{formatPrice(stockData.high)}</div>
        </div>
        <div>
          <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Low</div>
          <div className="font-semibold text-rose-500 text-sm">{formatPrice(stockData.low)}</div>
        </div>
        <div>
          <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Volume</div>
          <div className={`font-semibold text-sm ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{(stockData.volume / 1000000).toFixed(2)}M</div>
        </div>
      </div>
    </div>
  );
};
