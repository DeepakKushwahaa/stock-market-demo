import React from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { WidgetDefinitions } from '../widgets';
import { GRID_CONFIG } from '../../utils/layoutDefaults';
import type { WidgetType, WidgetDragData } from '../../types/gridLayout.types';

export const WidgetPanel: React.FC = () => {
  const { resetLayout, addWidget, canAddWidget } = useLayout();

  const handleDragStart = (e: React.DragEvent, widgetId: string, symbol?: string, widgetName?: string) => {
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
    if (!canAddWidget()) {
      alert(`Maximum ${GRID_CONFIG.maxWidgets} widgets allowed`);
      return;
    }

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

  const getWidgetPreviewImage = (widgetId: string) => {
    // Simple colored placeholders for widget previews
    const previews: Record<string, string> = {
      chart: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      screener: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      watchlist: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    };
    return previews[widgetId] || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  };

  return (
    <div className="fixed right-0 top-0 h-screen w-80 bg-white shadow-2xl overflow-auto z-50 border-l border-gray-200">
      <div className="px-3!">
        <div className="flex items-center justify-between py-3! sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-gray-800">Add Widgets</h2>
          <button className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="space-y-3!">
          {WidgetDefinitions.map((widget) => (
            <div
              key={widget.id}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, widget.id, widget.symbol, widget.name)}
              onClick={() => handleAddWidget(widget.id, widget.symbol, widget.name)}
              className="bg-white border border-gray-200 rounded-lg cursor-move hover:border-blue-400 hover:shadow-md transition-all duration-200 overflow-hidden group"
            >
              {/* Preview Image */}
              <div
                className="w-full h-32 flex items-center justify-center text-white text-5xl"
                style={{ background: getWidgetPreviewImage(widget.id) }}
              >
                {widget.icon}
              </div>

              {/* Widget Info */}
              <div className="p-3!">
                <h3 className="font-semibold text-gray-800 text-sm mb-1!">{widget.name}</h3>
                <p className="text-xs text-gray-500">{widget.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4! py-4! border-t border-gray-200">
          <button
            onClick={resetLayout}
            className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 py-2.5! px-4! rounded-lg font-semibold! transition-colors text-sm uppercase cursor-pointer"
          >
            Reset Layout
          </button>
        </div>
      </div>
    </div>
  );
};
