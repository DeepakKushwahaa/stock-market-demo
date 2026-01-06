import React from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { useTheme } from '../../contexts/ThemeContext';
import { WidgetDefinitions } from '../widgets';
import type { WidgetType, WidgetDragData } from '../../types/gridLayout.types';

export const WidgetPanel: React.FC = () => {
  const { resetLayout, addWidget, setWidgetPanelOpen, setPreviewWidget } = useLayout();
  const { isDark } = useTheme();

  const handleDragStart = (e: React.DragEvent, widgetId: string, symbol?: string, widgetName?: string) => {
    // Keep preview visible during drag (don't clear it)
    // The preview shows where the widget will be added

    // Determine component type
    let type: WidgetType = 'chart';
    if (widgetId.startsWith('chart-')) {
      type = 'chart';
    } else if (widgetId === 'screener') {
      type = 'screener';
    } else if (widgetId === 'watchlist') {
      type = 'watchlist';
    }

    const dragData: WidgetDragData = {
      type,
      title: widgetName || widgetId.toUpperCase(),
      props: {
        widgetId: `${widgetId}-${Date.now()}`,
        ...(symbol && { symbol }),
      },
    };

    e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleAddWidget = (widgetId: string, symbol?: string, widgetName?: string) => {
    // Determine component type based on widget ID
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

  const getWidgetType = (widgetId: string): WidgetType => {
    if (widgetId.startsWith('chart-')) return 'chart';
    if (widgetId === 'screener') return 'screener';
    if (widgetId === 'watchlist') return 'watchlist';
    return 'chart';
  };

  const handleWidgetHover = (widgetId: string, widgetName: string) => {
    const type = getWidgetType(widgetId);
    setPreviewWidget(type, widgetName);
  };

  const handleWidgetLeave = () => {
    setPreviewWidget(null);
  };

  const handleDragEnd = () => {
    // Clear preview after drag ends
    setPreviewWidget(null);
  };

  return (
    <div className={`h-full w-full overflow-auto transition-colors duration-300 ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
      <div className="p-4!">
        {/* Header */}
        <div className={`flex items-center justify-between mb-5! sticky top-0 py-2! -mt-2! z-10 border-b transition-colors duration-300 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
          <h2 className={`text-lg font-semibold transition-colors ${isDark ? 'text-white' : 'text-slate-800'}`}>Add Widgets</h2>
          <button
            type="button"
            onClick={() => setWidgetPanelOpen(false)}
            className={`transition-colors cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg ${isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Available Widgets Section */}
        <div className="mb-5!">
          <div className="space-y-3!">
            {WidgetDefinitions.map((widget) => {
              return (
              <div
                key={widget.id}
                draggable
                onClick={() => handleAddWidget(widget.id, widget.symbol, widget.name)}
                onDragStart={(e) => handleDragStart(e, widget.id, widget.symbol, widget.name)}
                onDragEnd={handleDragEnd}
                onMouseEnter={() => handleWidgetHover(widget.id, widget.name)}
                onMouseLeave={handleWidgetLeave}
                className={`border rounded-xl transition-all duration-200 overflow-hidden group relative cursor-pointer hover:border-emerald-400 hover:shadow-md ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-white border-slate-200'}`}
              >
                {/* Preview Image */}
                <div
                  className="w-full h-20 flex items-center justify-center text-white text-3xl"
                  style={{ background: getWidgetPreviewGradient(widget.id) }}
                >
                  {widget.icon}
                </div>

                {/* Widget Info */}
                <div className={`p-3! transition-colors ${isDark ? 'bg-slate-700' : 'bg-white'}`}>
                  <h3 className={`font-semibold text-sm mb-0.5! ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{widget.name}</h3>
                  <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{widget.description}</p>
                </div>

                {/* Hover indicator */}
                <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/5 transition-colors pointer-events-none" />
              </div>
              );
            })}
          </div>
        </div>

        {/* Reset Button */}
        <div className={`pt-4! border-t ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
          <button
            onClick={resetLayout}
            className={`w-full border py-2.5! px-4! rounded-xl font-medium transition-all duration-200 text-sm cursor-pointer ${isDark ? 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-rose-900/50 hover:border-rose-700 hover:text-rose-400' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600'}`}
          >
            Reset Layout
          </button>
        </div>
      </div>
    </div>
  );
};
