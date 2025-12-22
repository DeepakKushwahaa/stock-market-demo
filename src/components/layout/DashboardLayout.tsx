import React, { useCallback, useRef, useState, useEffect } from 'react';
import GridLayout from '@eleung/react-grid-layout';
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
  const [containerHeight, setContainerHeight] = useState(0);
  const { layouts, widgets, updateLayouts, removeWidget, addWidgetAtPosition, canAddWidget, setMaxRows } = useLayout();

  // Store the last valid layout to revert to if resize pushes widgets outside viewport
  const lastValidLayoutRef = useRef<GridItemLayout[]>(layouts);
  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Keep lastValidLayoutRef in sync when layouts change externally (adding/removing widgets)
  useEffect(() => {
    // Only update if not currently resizing or dragging
    if (!isResizingRef.current && !isDraggingRef.current) {
      lastValidLayoutRef.current = layouts;
    }
  }, [layouts]);

  // Calculate max rows based on viewport height
  const maxRows = Math.floor((containerHeight - GRID_CONFIG.containerPadding[1] * 2) / (GRID_CONFIG.rowHeight + GRID_CONFIG.margin[1]));

  // Update maxRows in context when it changes
  useEffect(() => {
    if (maxRows > 0) {
      setMaxRows(maxRows);
    }
  }, [maxRows, setMaxRows]);

  // Track container dimensions for GridLayout
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
        setContainerHeight(containerRef.current.offsetHeight);
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Try to adjust layout to keep widgets within viewport by shifting horizontally
  const adjustLayoutForViewport = useCallback((newLayout: GridItemLayout[]): GridItemLayout[] | null => {
    const cols = GRID_CONFIG.cols;
    const adjustedLayout = newLayout.map(item => ({ ...item }));

    // Check if any widget is outside viewport vertically
    for (const item of adjustedLayout) {
      if (item.y + item.h > maxRows) {
        // Widget is outside viewport - try to find space in same row or above
        // This means the layout change pushed something out - reject it
        return null;
      }
    }

    // Check horizontal bounds and adjust
    for (const item of adjustedLayout) {
      if (item.x + item.w > cols) {
        // Try to shift left
        const newX = cols - item.w;
        if (newX >= 0) {
          item.x = newX;
        } else {
          return null; // Can't fit
        }
      }
      if (item.x < 0) {
        item.x = 0;
      }
    }

    return adjustedLayout;
  }, [maxRows]);

  const handleLayoutChange = useCallback((newLayout: GridItemLayout[]) => {
    // Try to adjust layout to fit within viewport
    const adjustedLayout = adjustLayoutForViewport(newLayout);

    if (!adjustedLayout) {
      // Can't fit - revert to last valid layout
      updateLayouts(lastValidLayoutRef.current);
      return;
    }

    // Update layouts while preserving minW/minH
    const updatedLayouts: GridItemLayout[] = adjustedLayout.map((item: GridItemLayout) => {
      const existingLayout = layouts.find(l => l.i === item.i);
      return {
        ...item,
        minW: existingLayout?.minW ?? item.minW,
        minH: existingLayout?.minH ?? item.minH,
      };
    });

    // Store as last valid layout
    lastValidLayoutRef.current = updatedLayouts;
    updateLayouts(updatedLayouts);
  }, [layouts, updateLayouts, adjustLayoutForViewport]);

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

  // Handle resize start - store the current valid layout
  const handleResizeStart = useCallback((_layout: GridItemLayout[], _oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isResizingRef.current = true;
    lastValidLayoutRef.current = layouts.map(l => ({ ...l }));
  }, [layouts]);

  // Handle resize stop - check if layout is valid, revert if not
  const handleResizeStop = useCallback((newLayout: GridItemLayout[], _oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isResizingRef.current = false;

    // Check if any widget is outside viewport
    const isInvalid = newLayout.some(item => item.y + item.h > maxRows);

    if (isInvalid) {
      // Revert to last valid layout
      updateLayouts(lastValidLayoutRef.current);
    } else {
      // Update the last valid layout ref
      const validLayout = newLayout.map(item => {
        const existingLayout = layouts.find(l => l.i === item.i);
        return {
          ...item,
          minW: existingLayout?.minW ?? item.minW,
          minH: existingLayout?.minH ?? item.minH,
        };
      });
      lastValidLayoutRef.current = validLayout;
      updateLayouts(validLayout);
    }
  }, [layouts, maxRows, updateLayouts]);

  // Handle drag start
  const handleDragStart = useCallback((_layout: GridItemLayout[], _oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isDraggingRef.current = true;
    lastValidLayoutRef.current = layouts.map(l => ({ ...l }));
  }, [layouts]);

  // Handle drag stop - check if layout is valid, revert if not
  const handleDragStop = useCallback((newLayout: GridItemLayout[], _oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isDraggingRef.current = false;

    // Check if any widget is outside viewport
    const isInvalid = newLayout.some(item => item.y + item.h > maxRows);

    if (isInvalid) {
      // Revert to last valid layout
      updateLayouts(lastValidLayoutRef.current);
    } else {
      // Update the last valid layout ref
      const validLayout = newLayout.map(item => {
        const existingLayout = layouts.find(l => l.i === item.i);
        return {
          ...item,
          minW: existingLayout?.minW ?? item.minW,
          minH: existingLayout?.minH ?? item.minH,
        };
      });
      lastValidLayoutRef.current = validLayout;
      updateLayouts(validLayout);
    }
  }, [layouts, maxRows, updateLayouts]);

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
      className="w-full h-full overflow-hidden bg-gray-900 transition-all duration-300"
      style={{ height: '100vh' }}
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
          onResizeStart={handleResizeStart}
          onResizeStop={handleResizeStop}
          onDragStart={handleDragStart}
          onDragStop={handleDragStop}
          isDroppable={true}
          droppingItem={droppingItem}
          draggableHandle=".widget-drag-handle"
          resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 'n', 's']}
          useCSSTransforms={true}
          compactType="horizontal"
          preventCollision={false}
          maxRows={maxRows}
          isBounded={true}
          allowOverlap={false}
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
