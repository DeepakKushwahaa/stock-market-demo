import { useState, useRef, useEffect } from 'react';
import { LayoutProvider, useLayout } from './contexts/LayoutContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { WidgetDefinitions } from './components/widgets';
import type { WidgetType } from './types/gridLayout.types';

function AppContent() {
  const { addWidget, resetLayout } = useLayout();
  const { toggleTheme, isDark } = useTheme();
  const [isAddWidgetOpen, setIsAddWidgetOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAddWidgetOpen(false);
      }
    };

    if (isAddWidgetOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddWidgetOpen]);

  const handleAddWidget = (widgetId: string, symbol?: string, widgetName?: string) => {
    let type: WidgetType = 'chart';
    if (widgetId.startsWith('chart-')) {
      type = 'chart';
    } else if (widgetId === 'screener') {
      type = 'screener';
    } else if (widgetId === 'watchlist') {
      type = 'watchlist';
    }

    const props = {
      widgetId: `${widgetId}-${Date.now()}`,
      ...(symbol && { symbol }),
    };

    addWidget(type, widgetName || widgetId.toUpperCase(), props);
    setIsAddWidgetOpen(false);
  };

  const getWidgetPreviewGradient = (widgetId: string) => {
    if (widgetId.startsWith('chart-')) {
      return 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    } else if (widgetId === 'screener') {
      return 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)';
    } else if (widgetId === 'watchlist') {
      return 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
    }
    return 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  };

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden transition-colors duration-300 ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
      {/* Top Header Bar */}
      <header className={`h-14 border-b flex items-center justify-between px-4! shrink-0 z-50 transition-colors duration-300 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
        {/* Left: Logo and Dashboard Name */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <h1 className={`text-lg font-semibold transition-colors ${isDark ? 'text-white' : 'text-slate-800'}`}>Trading Dashboard</h1>
            <button className={`transition-colors cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-md mx-8!">
          <div className="relative">
            <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search symbols, widgets..."
              className={`w-full pl-10! pr-4! py-2! border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all ${
                isDark
                  ? 'bg-slate-700 border-slate-600 text-slate-200 placeholder-slate-400'
                  : 'bg-slate-100 border-slate-200 text-slate-700 placeholder-slate-400'
              }`}
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Add Widget Button with Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsAddWidgetOpen(!isAddWidgetOpen)}
              className={`flex items-center gap-2 px-3! py-1.5! rounded-lg transition-all cursor-pointer font-medium text-sm ${
                isAddWidgetOpen
                  ? 'bg-emerald-500 text-white'
                  : isDark
                    ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Widget
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${isAddWidgetOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            <div
              className={`absolute right-0 top-full mt-2! w-[450px] rounded-xl shadow-xl border overflow-hidden z-50 transform transition-all duration-200 origin-top-right ${
                isAddWidgetOpen
                  ? 'opacity-100 scale-100 translate-y-0'
                  : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
              } ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}
            >
              <div className={`px-4! py-3! border-b flex items-center justify-between ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
                <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>Add Widgets</p>
                <button
                  onClick={() => {
                    resetLayout();
                    setIsAddWidgetOpen(false);
                  }}
                  className={`p-1.5! rounded-lg transition-all cursor-pointer ${isDark ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-900/30' : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'}`}
                  title="Reset Layout"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <div className="max-h-125 overflow-y-auto p-3!">
                <div className="grid grid-cols-2 gap-3!">
                  {WidgetDefinitions.map((widget, index) => (
                    <div
                      key={widget.id}
                      onClick={() => handleAddWidget(widget.id, widget.symbol, widget.name)}
                      className={`border rounded-xl overflow-hidden cursor-pointer hover:border-emerald-400 hover:shadow-md ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-white border-slate-200'}`}
                      style={{
                        opacity: isAddWidgetOpen ? 1 : 0,
                        transform: isAddWidgetOpen ? 'translateY(0) scale(1)' : 'translateY(-16px) scale(0.95)',
                        transition: `opacity 350ms cubic-bezier(0.4, 0, 0.2, 1), transform 350ms cubic-bezier(0.4, 0, 0.2, 1), border-color 200ms ease, box-shadow 200ms ease`,
                        transitionDelay: isAddWidgetOpen ? `${index * 50}ms` : '0ms',
                        willChange: 'opacity, transform',
                      }}
                    >
                      {/* Preview Image */}
                      <div
                        className="w-full h-16 flex items-center justify-center text-white text-2xl"
                        style={{ background: getWidgetPreviewGradient(widget.id) }}
                      >
                        {widget.icon}
                      </div>
                      {/* Widget Info */}
                      <div className={`p-2! transition-colors ${isDark ? 'bg-slate-700' : 'bg-white'}`}>
                        <h3 className={`font-semibold text-xs mb-0.5! ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{widget.name}</h3>
                        <p className={`text-[10px] leading-tight line-clamp-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{widget.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={`w-px h-6 mx-1! ${isDark ? 'bg-slate-600' : 'bg-slate-200'}`}></div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className={`p-2! rounded-lg transition-all cursor-pointer ${
              isDark
                ? 'text-yellow-400 hover:text-yellow-300 hover:bg-slate-700'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            }`}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? (
              // Sun icon for dark mode (click to switch to light)
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              // Moon icon for light mode (click to switch to dark)
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          <button className={`p-2! rounded-lg transition-all cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>
          <button className={`p-2! rounded-lg transition-all cursor-pointer ${isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <div className={`w-px h-6 mx-1! ${isDark ? 'bg-slate-600' : 'bg-slate-200'}`}></div>
          <button className="w-8 h-8 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center text-white text-sm font-medium cursor-pointer">
            JD
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Dashboard Canvas */}
        <div className="flex-1 h-full min-h-0">
          <DashboardLayout />
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LayoutProvider>
        <AppContent />
      </LayoutProvider>
    </ThemeProvider>
  );
}

export default App;
