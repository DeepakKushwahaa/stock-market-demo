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

  const MAX_WIDGETS = 15;
  const WIDGETS_PER_ROW = 5;

  // Count total widgets in layout (count stacks, not components)
  const countWidgets = (item: any): number => {
    if (!item) return 0;
    if (item.type === 'stack') return 1;
    if (item.contentItems) {
      return item.contentItems.reduce((sum: number, child: any) => sum + countWidgets(child), 0);
    }
    return 0;
  };

  // Find the column container in the layout
  const findColumn = (item: any): any => {
    if (!item) return null;
    if (item.type === 'column') return item;
    if (item.contentItems) {
      for (const child of item.contentItems) {
        const found = findColumn(child);
        if (found) return found;
      }
    }
    return null;
  };

  // Count stacks in a row
  const countStacksInRow = (row: any): number => {
    if (!row || !row.contentItems) return 0;
    return row.contentItems.filter((item: any) => item.type === 'stack').length;
  };

  const handleAddWidget = (widgetId: string, symbol?: string, widgetName?: string) => {
    const layout = layoutInstance as any;

    if (!layout || !layout.isInitialised) {
      console.error('Layout instance not available or not initialized');
      return;
    }

    try {
      // Check if max widgets reached
      const currentWidgetCount = countWidgets(layout.root);
      if (currentWidgetCount >= MAX_WIDGETS) {
        alert(`Maximum ${MAX_WIDGETS} widgets allowed`);
        return;
      }

      // Determine component type based on widget ID
      let componentName = 'chart';
      if (widgetId.startsWith('chart-')) {
        componentName = 'chart';
      } else if (widgetId === 'screener') {
        componentName = 'screener';
      } else if (widgetId === 'watchlist') {
        componentName = 'watchlist';
      }

      const componentState = {
        widgetId: `${widgetId}-${Date.now()}`,
        ...(symbol && { symbol }),
      };
      const title = widgetName || widgetId.toUpperCase();

      // Component config for the widget
      const componentConfig = {
        type: 'component',
        componentType: componentName,
        componentState: componentState,
        title: title,
        content: [],
      };

      // Stack config wrapping the component
      const stackItemConfig = {
        type: 'stack',
        content: [componentConfig]
      };

      // Find or create the column structure
      const root = layout.root;
      let column = findColumn(root);

      if (!column) {
        // No column found, use root's first item or create structure
        if (root.contentItems && root.contentItems.length > 0) {
          const firstItem = root.contentItems[0];
          if (firstItem.type === 'row') {
            firstItem.addItem(stackItemConfig);
            return;
          }
        }
        // Fallback
        layout.newComponent(componentName, componentState, title);
        return;
      }

      // Find last row in column or create one
      const rows = column.contentItems.filter((item: any) => item.type === 'row');
      let targetRow = rows.length > 0 ? rows[rows.length - 1] : null;

      if (targetRow && countStacksInRow(targetRow) < WIDGETS_PER_ROW) {
        // Add to existing row
        targetRow.addItem(stackItemConfig);
      } else {
        // Create new row
        const newRowConfig = {
          type: 'row',
          content: [stackItemConfig]
        };
        column.addItem(newRowConfig);
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
