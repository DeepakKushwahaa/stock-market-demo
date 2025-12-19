import React, { useCallback, useRef, useState, useEffect } from 'react';
import GridLayout from 'react-grid-layout';
import { useLayout } from '../../contexts/LayoutContext';
import { WidgetWrapper } from './WidgetWrapper';
import { WidgetRegistry } from '../widgets';
import { GRID_CONFIG, DEFAULT_WIDGET_SIZES } from '../../utils/layoutDefaults';
import type { WidgetDragData, GridItemLayout } from '../../types/gridLayout.types';

// Cast GridLayout to any to work around type definition issues
const RGL = GridLayout as any;

export const DashboardLayout: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const { layouts, widgets, updateLayouts, removeWidget, addWidgetAtPosition, canAddWidget } = useLayout();

  // Track container width for GridLayout
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleLayoutChange = useCallback((newLayout: GridItemLayout[]) => {
    // Update layouts while preserving minW/minH
    const updatedLayouts: GridItemLayout[] = newLayout.map((item: GridItemLayout) => {
      const existingLayout = layouts.find(l => l.i === item.i);
      return {
        ...item,
        minW: existingLayout?.minW ?? item.minW,
        minH: existingLayout?.minH ?? item.minH,
      };
    });
    updateLayouts(updatedLayouts);
  }, [layouts, updateLayouts]);

  const handleDrop = useCallback((
    _layout: GridItemLayout[],
    layoutItem: GridItemLayout,
    event: Event
  ) => {
    const e = event as DragEvent;
    const dragDataStr = e.dataTransfer?.getData('text/plain');

    if (!dragDataStr) return;

    try {
      const dragData: WidgetDragData = JSON.parse(dragDataStr);

      if (!canAddWidget()) {
        alert(`Maximum ${GRID_CONFIG.maxWidgets} widgets allowed`);
        return;
      }

      addWidgetAtPosition(
        dragData.type,
        dragData.title,
        dragData.props,
        layoutItem.x,
        layoutItem.y
      );
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  }, [addWidgetAtPosition, canAddWidget]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Dropping item placeholder
  const droppingItem = {
    i: '__dropping-elem__',
    x: 0,
    y: 0,
    w: DEFAULT_WIDGET_SIZES.chart.w,
    h: DEFAULT_WIDGET_SIZES.chart.h,
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto bg-gray-900"
      style={{ height: '100vh', width: 'calc(100vw - 320px)' }}
      onDragOver={handleDragOver}
    >
      {containerWidth > 0 && (
        <RGL
          className="layout"
          layout={layouts}
          cols={GRID_CONFIG.cols}
          rowHeight={GRID_CONFIG.rowHeight}
          width={containerWidth}
          margin={GRID_CONFIG.margin}
          containerPadding={GRID_CONFIG.containerPadding}
          onLayoutChange={handleLayoutChange}
          onDrop={handleDrop}
          isDroppable={true}
          droppingItem={droppingItem}
          draggableHandle=".widget-drag-handle"
          resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 'n', 's']}
          useCSSTransforms={true}
          compactType="vertical"
          preventCollision={false}
        >
          {widgets.map(widget => {
            const WidgetComponent = WidgetRegistry[widget.type as keyof typeof WidgetRegistry];
            if (!WidgetComponent) {
              console.warn(`Unknown widget type: ${widget.type}`);
              return null;
            }

            return (
              <div key={widget.i}>
                <WidgetWrapper
                  title={widget.title}
                  onClose={() => removeWidget(widget.i)}
                >
                  <WidgetComponent {...widget.props} />
                </WidgetWrapper>
              </div>
            );
          })}
        </RGL>
      )}
    </div>
  );
};
