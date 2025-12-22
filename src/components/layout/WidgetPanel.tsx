import React from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { WidgetDefinitions } from '../widgets';
import { GRID_CONFIG, LAYOUT_PRESETS } from '../../utils/layoutDefaults';
import type { WidgetType, WidgetDragData, PresetName } from '../../types/gridLayout.types';

export const WidgetPanel: React.FC = () => {
  const { resetLayout, addWidget, canAddWidget, setWidgetPanelOpen, loadPreset } = useLayout();

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

  const handleLoadPreset = (presetName: PresetName) => {
    loadPreset(presetName);
  };

  const getWidgetPreviewGradient = (widgetId: string) => {
    if (widgetId.startsWith('chart-')) {
      return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    } else if (widgetId === 'screener') {
      return 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
    } else if (widgetId === 'watchlist') {
      return 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
    }
    return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  };

  return (
    <div className="h-full w-full bg-gray-800 overflow-auto">
      <div className="p-4!">
        {/* Header */}
        <div className="flex items-center justify-between mb-6! sticky top-0 bg-gray-800 py-2! -mt-2 z-10">
          <h2 className="text-xl font-semibold text-white">Add Widgets</h2>
          <button
            type="button"
            onClick={() => setWidgetPanelOpen(false)}
            className="text-gray-400 hover:text-white text-2xl leading-none transition-colors cursor-pointer w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700"
          >
            ×
          </button>
        </div>

        {/* Layout Presets Section */}
        <div className="mb-6!">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3!">Layout Presets</h3>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(LAYOUT_PRESETS) as PresetName[]).map((presetKey) => {
              const preset = LAYOUT_PRESETS[presetKey];
              return (
                <button
                  key={presetKey}
                  onClick={() => handleLoadPreset(presetKey)}
                  className="bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-blue-500 rounded-lg p-3! text-center transition-all duration-200 cursor-pointer group"
                >
                  <span className="text-2xl block mb-1">{preset.icon}</span>
                  <span className="text-xs text-gray-300 group-hover:text-white font-medium">{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-700 mb-6!"></div>

        {/* Available Widgets Section */}
        <div className="mb-6!">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3!">Available Widgets</h3>
          <div className="space-y-3!">
            {WidgetDefinitions.map((widget) => (
              <div
                key={widget.id}
                draggable={true}
                onDragStart={(e) => handleDragStart(e, widget.id, widget.symbol, widget.name)}
                onClick={() => handleAddWidget(widget.id, widget.symbol, widget.name)}
                className="bg-gray-700 border border-gray-600 rounded-lg cursor-move hover:border-blue-500 hover:shadow-lg transition-all duration-200 overflow-hidden group"
              >
                {/* Preview Image */}
                <div
                  className="w-full h-24 flex items-center justify-center text-white text-4xl"
                  style={{ background: getWidgetPreviewGradient(widget.id) }}
                >
                  {widget.icon}
                </div>

                {/* Widget Info */}
                <div className="p-3! bg-gray-750">
                  <h3 className="font-semibold text-white text-sm mb-1!">{widget.name}</h3>
                  <p className="text-xs text-gray-400">{widget.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reset Button */}
        <div className="pt-4! border-t border-gray-700">
          <button
            onClick={resetLayout}
            className="w-full bg-gray-700 border border-gray-600 hover:bg-red-600 hover:border-red-600 text-gray-300 hover:text-white py-2.5! px-4! rounded-lg font-semibold transition-colors text-sm uppercase cursor-pointer"
          >
            Reset Layout
          </button>
        </div>
      </div>
    </div>
  );
};
