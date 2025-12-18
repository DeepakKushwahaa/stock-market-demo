import { ChartWidget } from './ChartWidget';
import { ScreenerWidget } from './ScreenerWidget';
import { WatchlistWidget } from './WatchlistWidget';
import type { WidgetDefinition, WidgetType } from '../../types/widget.types';

export const WidgetRegistry = {
  chart: ChartWidget,
  screener: ScreenerWidget,
  watchlist: WatchlistWidget,
} as const;

export const WidgetDefinitions: WidgetDefinition[] = [
  {
    id: 'chart-aapl',
    name: 'AAPL Chart',
    icon: '📈',
    description: 'Apple Inc. stock price chart',
    symbol: 'AAPL',
  },
  {
    id: 'chart-googl',
    name: 'GOOGL Chart',
    icon: '📊',
    description: 'Alphabet Inc. stock price chart',
    symbol: 'GOOGL',
  },
  {
    id: 'chart-msft',
    name: 'MSFT Chart',
    icon: '📉',
    description: 'Microsoft Corporation stock price chart',
    symbol: 'MSFT',
  },
  {
    id: 'chart-tsla',
    name: 'TSLA Chart',
    icon: '⚡',
    description: 'Tesla Inc. stock price chart',
    symbol: 'TSLA',
  },
  {
    id: 'chart-amzn',
    name: 'AMZN Chart',
    icon: '📦',
    description: 'Amazon.com Inc. stock price chart',
    symbol: 'AMZN',
  },
  {
    id: 'chart-nvda',
    name: 'NVDA Chart',
    icon: '🎮',
    description: 'NVIDIA Corporation stock price chart',
    symbol: 'NVDA',
  },
  {
    id: 'chart-meta',
    name: 'META Chart',
    icon: '👥',
    description: 'Meta Platforms Inc. stock price chart',
    symbol: 'META',
  },
  {
    id: 'screener',
    name: 'Screener',
    icon: '🔍',
    description: 'Stock screener with sortable columns',
  },
  {
    id: 'watchlist',
    name: 'Watchlist',
    icon: '⭐',
    description: 'Track your favorite stocks',
  },
];

export type { WidgetDefinition, WidgetType };
