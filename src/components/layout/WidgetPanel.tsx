import React from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { WidgetDefinitions } from '../widgets';
import { LAYOUT_PRESETS } from '../../utils/layoutDefaults';
import type { WidgetType, WidgetDragData, PresetName } from '../../types/gridLayout.types';

export const WidgetPanel: React.FC = () => {
  const { resetLayout, addWidget, setWidgetPanelOpen, loadPreset, setPreviewWidget } = useLayout();

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

  const handleLoadPreset = (presetName: PresetName) => {
    loadPreset(presetName);
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
    <div className="h-full w-full bg-white overflow-auto">
      <div className="p-4!">
        {/* Header */}
        <div className="flex items-center justify-between mb-5! sticky top-0 bg-white py-2! -mt-2! z-10 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">Add Widgets</h2>
          <button
            type="button"
            onClick={() => setWidgetPanelOpen(false)}
            className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Layout Presets Section */}
        <div className="mb-5!">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3!">Quick Layouts</h3>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(LAYOUT_PRESETS) as PresetName[]).map((presetKey) => {
              const preset = LAYOUT_PRESETS[presetKey];
              return (
                <button
                  key={presetKey}
                  onClick={() => handleLoadPreset(presetKey)}
                  className="bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-emerald-400 rounded-xl p-3! text-center transition-all duration-200 cursor-pointer group"
                >
                  <span className="text-xl block mb-1!">{preset.icon}</span>
                  <span className="text-xs text-slate-600 group-hover:text-emerald-600 font-medium">{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100 mb-5!"></div>

        {/* Available Widgets Section */}
        <div className="mb-5!">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3!">Widgets</h3>
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
                className="bg-white border border-slate-200 rounded-xl transition-all duration-200 overflow-hidden group relative cursor-pointer hover:border-emerald-400 hover:shadow-md"
              >
                {/* Preview Image */}
                <div
                  className="w-full h-20 flex items-center justify-center text-white text-3xl"
                  style={{ background: getWidgetPreviewGradient(widget.id) }}
                >
                  {widget.icon}
                </div>

                {/* Widget Info */}
                <div className="p-3! bg-white">
                  <h3 className="font-semibold text-slate-700 text-sm mb-0.5!">{widget.name}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{widget.description}</p>
                </div>

                {/* Hover indicator */}
                <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/5 transition-colors pointer-events-none" />
              </div>
              );
            })}
          </div>
        </div>

        {/* Reset Button */}
        <div className="pt-4! border-t border-slate-100">
          <button
            onClick={resetLayout}
            className="w-full bg-slate-100 border border-slate-200 hover:bg-rose-50 hover:border-rose-300 text-slate-600 hover:text-rose-600 py-2.5! px-4! rounded-xl font-medium transition-all duration-200 text-sm cursor-pointer"
          >
            Reset Layout
          </button>
        </div>
      </div>
    </div>
  );
};
