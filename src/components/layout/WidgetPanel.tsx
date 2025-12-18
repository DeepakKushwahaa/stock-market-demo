import React from 'react';
import { useLayout } from '../../contexts/LayoutContext';
import { WidgetDefinitions } from '../widgets';

export const WidgetPanel: React.FC = () => {
  const { resetLayout, layoutInstance } = useLayout();

  const handleDragStart = (e: React.DragEvent, widgetId: string, symbol?: string, widgetName?: string) => {
    const layout = layoutInstance as any;
    if (!layout || !layout.isInitialised) return;

    // Determine component type
    let componentName = 'chart';
    if (widgetId.startsWith('chart-')) {
      componentName = 'chart';
    } else if (widgetId === 'screener') {
      componentName = 'screener';
    } else if (widgetId === 'watchlist') {
      componentName = 'watchlist';
    }

    const dragData = {
      type: 'component',
      componentName: componentName,
      componentState: {
        widgetId: `${widgetId}-${Date.now()}`,
        ...(symbol && { symbol }),
      },
      title: widgetName || widgetId.toUpperCase(),
    };

    e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAddWidget = (widgetId: string, symbol?: string, widgetName?: string) => {
    console.log('handleAddWidget called with:', { widgetId, symbol, widgetName });
    const layout = layoutInstance as any;

    console.log('Layout instance:', layout);
    console.log('Layout initialized:', layout?.isInitialised);

    if (!layout || !layout.isInitialised) {
      console.error('Layout instance not available or not initialized');
      return;
    }

    try {
      // Determine component type based on widget ID
      let componentName = 'chart';
      if (widgetId.startsWith('chart-')) {
        componentName = 'chart';
      } else if (widgetId === 'screener') {
        componentName = 'screener';
      } else if (widgetId === 'watchlist') {
        componentName = 'watchlist';
      }

      const newItemConfig = {
        type: 'component',
        componentName: componentName,
        componentState: {
          widgetId: `${widgetId}-${Date.now()}`,
          ...(symbol && { symbol }),
        },
        title: widgetName || widgetId.toUpperCase(),
      };

      // Use Golden Layout's addItem method instead of manipulating structure
      console.log('Adding widget to layout...');

      // Golden Layout v2 uses addItem or newItem methods
      if (layout.addItem) {
        console.log('Using layout.addItem method');
        layout.addItem(newItemConfig);
      } else if (layout.newItem) {
        console.log('Using layout.newItem method');
        layout.newItem(newItemConfig);
      } else {
        // Fallback: try to add directly to root
        console.log('Using fallback method');
        const config = layout.toConfig();

        if (!config.content || config.content.length === 0) {
          config.content = [{
            type: 'row',
            content: [{
              type: 'stack',
              content: [newItemConfig]
            }]
          }];
        } else {
          // Find first stack and add to it
          const findAndAddToStack = (items: any[]): boolean => {
            for (const item of items) {
              if (item.type === 'stack') {
                if (!item.content) item.content = [];
                item.content.push(newItemConfig);
                return true;
              }
              if (item.content && findAndAddToStack(item.content)) {
                return true;
              }
            }
            return false;
          };

          if (!findAndAddToStack(config.content)) {
            // No stack found, add to first row
            if (config.content[0].content) {
              config.content[0].content.push({
                type: 'stack',
                content: [newItemConfig]
              });
            }
          }
        }

        // Reload with new config
        layout.destroy();
        setTimeout(() => window.location.reload(), 100);
      }
    } catch (error) {
      console.error('Error adding widget:', error);
    }
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
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-800">Add Widgets</h2>
          <button className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="space-y-3">
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
              <div className="p-3">
                <h3 className="font-semibold text-gray-800 text-sm mb-1">{widget.name}</h3>
                <p className="text-xs text-gray-500">{widget.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <button
            onClick={resetLayout}
            className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 py-2.5 px-4 rounded-lg font-medium transition-colors text-sm"
          >
            Reset Layout
          </button>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Restore default layout
          </p>
        </div>
      </div>
    </div>
  );
};
