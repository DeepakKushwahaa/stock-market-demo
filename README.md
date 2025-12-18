# Stock Market Dashboard

A fully functional, draggable stock market dashboard built with React, TypeScript, Vite, Golden Layout, and Tailwind CSS.

## Features

- **Draggable Widgets**: Drag and drop widgets to customize your dashboard layout
- **Multiple Widget Types**:
  - **Chart Widget** 📈: Interactive stock price charts with multiple timeframes (1D, 1W, 1M, 1Y)
  - **Screener Widget** 🔍: Sortable stock screener table with search functionality
  - **Watchlist Widget** ⭐: Personal watchlist with real-time price updates
- **Layout Persistence**: Your dashboard layout is automatically saved to localStorage
- **Mock Data**: Realistic mock stock market data with live updates
- **Dark Theme**: Modern dark theme with custom Golden Layout styling
- **Responsive Design**: Works on different screen sizes

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Golden Layout 2.x** - Multi-window layout manager
- **Recharts** - Chart visualization
- **Tailwind CSS** - Utility-first CSS
- **SCSS** - Custom styling for Golden Layout

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (v9 or higher)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser and navigate to:
```
http://localhost:5173
```

### Build for Production

```bash
npm run build
```

The production-ready files will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
src/
├── assets/
│   └── styles/
│       └── global.scss              # Global styles + Tailwind + Golden Layout theme
├── components/
│   ├── layout/
│   │   ├── DashboardLayout.tsx      # Main Golden Layout container
│   │   └── WidgetPanel.tsx          # Widget selection panel
│   └── widgets/
│       ├── ChartWidget/             # Stock chart component
│       ├── ScreenerWidget/          # Stock screener table
│       ├── WatchlistWidget/         # User watchlist
│       └── index.ts                 # Widget registry
├── contexts/
│   └── LayoutContext.tsx            # Layout state management
├── hooks/
│   ├── useLocalStorage.ts           # localStorage hook
│   └── useStockData.ts              # Mock data hooks
├── services/
│   ├── layoutService.ts             # Layout persistence
│   └── mockDataService.ts           # Mock stock data
├── types/
│   ├── layout.types.ts              # Layout type definitions
│   ├── widget.types.ts              # Widget type definitions
│   └── stock.types.ts               # Stock data types
├── utils/
│   ├── layoutDefaults.ts            # Default layout config
│   └── constants.ts                 # App constants
├── App.tsx                          # Root component
└── main.tsx                         # Entry point
```

## Usage

### Adding Widgets

1. Click on any widget card in the right panel to add it to your dashboard
2. Available widgets: Chart, Screener, Watchlist

### Rearranging Widgets

1. **Drag tabs** to reorder widgets within a stack
2. **Drag tabs to edges** to split panels horizontally or vertically
3. **Drag tabs to other stacks** to move widgets between containers

### Widget Actions

- **Maximize**: Click the maximize icon to expand a widget to full screen
- **Close**: Click the × icon to remove a widget from the dashboard

### Resetting Layout

Click the "Reset Layout" button at the bottom of the widget panel to restore the default layout.

## Widget Details

### Chart Widget 📈

- Displays stock price chart with OHLC data
- Switch between timeframes: 1D, 1W, 1M, 1Y
- Shows current price, change, and key statistics
- Real-time updates every 5 seconds

### Screener Widget 🔍

- Displays all available stocks in a sortable table
- Search by symbol or company name
- Click column headers to sort
- Shows price, change, volume, and market cap
- Real-time updates every 3 seconds

### Watchlist Widget ⭐

- Add stocks to your personal watchlist
- Remove stocks with the × button
- Shows detailed price information and volume
- Persists watchlist to localStorage
- Real-time updates every 3 seconds

## Available Stocks

The dashboard includes mock data for 30 major stocks including:
- AAPL, GOOGL, MSFT, AMZN, TSLA, META, NVDA
- JPM, V, WMT, JNJ, PG, MA, HD, DIS, BAC
- ADBE, NFLX, CRM, ORCL, CSCO, INTC, AMD
- PYPL, UBER, SPOT, SQ, COIN, SHOP, ZM

## Customization

### Adding New Widgets

1. Create a new widget component in `src/components/widgets/`
2. Add the widget to the `WidgetRegistry` in `src/components/widgets/index.ts`
3. Add widget definition to `WidgetDefinitions` array
4. Update TypeScript types in `src/types/widget.types.ts`

### Changing Theme Colors

Edit `tailwind.config.js` and `src/assets/styles/global.scss` to customize colors.

### Modifying Default Layout

Edit `src/utils/layoutDefaults.ts` to change the initial dashboard configuration.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Known Issues

- Golden Layout has some TypeScript type limitations (handled with custom type definitions)
- Layout reset requires a page reload for proper Golden Layout reinitialization

## License

MIT

## Credits

Built with:
- [Golden Layout](https://golden-layout.github.io/golden-layout/) - Layout manager
- [Recharts](https://recharts.org/) - Chart library
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework
- [Vite](https://vitejs.dev/) - Build tool
