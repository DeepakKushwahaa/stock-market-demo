import React, { useCallback, useRef, useState, useEffect } from 'react';
import GridLayout from '@eleung/react-grid-layout';
import { useLayout } from '../../contexts/LayoutContext';
import { WidgetWrapper } from './WidgetWrapper';
import { WidgetRegistry } from '../widgets';
import { GRID_CONFIG, DEFAULT_WIDGET_SIZES } from '../../utils/layoutDefaults';
import type { WidgetDragData, GridItemLayout } from '../../types/gridLayout.types';
import {
  createOccupancyGrid,
  canFitAt,
  findAllFitPositions,
  getWidgetAtPosition,
  calculatePush,
  calculateResizeSpace,
  calculateSwap,
  pixelToGridCoords,
  type SwapPreview,
  type GridZone,
  type WidgetMinSizes,
} from '../../utils/gridHelpers';
import { resizeLogger } from '../../utils/resizeDebugLogger';

// Cast GridLayout to any to work around type definition issues
const RGL = GridLayout as any;

export const DashboardLayout: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const { layouts, widgets, updateLayouts, removeWidget, addWidget, setMaxRows, previewWidget, newlyAddedWidgetId, maximizedWidgetId, toggleMaximizeWidget } = useLayout();

  // Store the last valid layout to revert to if resize pushes widgets outside viewport
  const lastValidLayoutRef = useRef<GridItemLayout[]>(layouts);
  // Store the layout at resize start (before any pushing happens)
  const resizeStartLayoutRef = useRef<GridItemLayout[]>(layouts);
  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);
  // Store DOM element references at resize start for direct manipulation
  const widgetDomMapRef = useRef<Map<string, HTMLElement>>(new Map());
  // Track the last pushed layout during resize to allow incremental pushing
  const lastPushedLayoutRef = useRef<GridItemLayout[] | null>(null);

  // Track available drop zones during drag
  const [availableZones, setAvailableZones] = useState<GridZone[]>([]);
  const [isDraggingWidget, setIsDraggingWidget] = useState(false);
  const draggingWidgetRef = useRef<{ id: string; w: number; h: number } | null>(null);

  // Track if there's space available for external drops (from widget panel)
  const [hasSpaceForDrop, setHasSpaceForDrop] = useState(true);

  // Track if dragging from external source (widget panel)
  const [isExternalDrag, setIsExternalDrag] = useState(false);

  // Feature 4: Swap detection state
  const [swapPreview, setSwapPreview] = useState<SwapPreview | null>(null);
  const swapPreviewRef = useRef<SwapPreview | null>(null);
  const dragStartLayoutRef = useRef<GridItemLayout | null>(null);

  // Feature 5: Push preview state (used internally in handleDrop)
  const [, setPushPreview] = useState<GridItemLayout[] | null>(null);

  // Feature 6: Resize space management preview
  const [resizePreview, setResizePreview] = useState<{
    newLayouts: GridItemLayout[];
    movedWidgets: string[];
    shrunkWidgets: string[];
  } | null>(null);

  // Clear resize debug logs on component mount (page refresh)
  useEffect(() => {
    resizeLogger.clear();
  }, []);

  // Keep lastValidLayoutRef in sync when layouts change externally (adding/removing widgets)
  useEffect(() => {
    // Only update if not currently resizing or dragging
    if (!isResizingRef.current && !isDraggingRef.current) {
      lastValidLayoutRef.current = layouts;
    }
  }, [layouts]);

  // Calculate max rows based on viewport height
  // Grid height for n rows = padding*2 + (rowHeight * n) + (margin * (n-1))
  const paddingY = GRID_CONFIG.containerPadding[1];
  const rowHeight = GRID_CONFIG.rowHeight;
  const marginY = GRID_CONFIG.margin[1];
  // Calculate available space for rows
  const availableForRows = containerHeight - (paddingY * 4) - marginY;
  // Each row unit takes: rowHeight + marginY
  // Use Math.ceil so widgets can resize to fill the entire viewport to the bottom
  const maxRows = Math.max(1, Math.ceil(availableForRows / (rowHeight + marginY)));

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

  // Calculate maxH and maxW for each widget based on available space in ALL directions
  // This allows resizing from left, right, top, and bottom handles
  const calculateMaxDimensions = useCallback((currentLayouts: GridItemLayout[]): Map<string, { maxH: number; maxW: number }> => {
    const maxDimensions = new Map<string, { maxH: number; maxW: number }>();
    const cols = GRID_CONFIG.cols;

    for (const item of currentLayouts) {
      const itemRight = item.x + item.w;
      const itemBottom = item.y + item.h;

      // Calculate space available to the LEFT (for left-side resize)
      const widgetsToLeft = currentLayouts
        .filter(other => {
          if (other.i === item.i) return false;
          // Widget is to the left (its right edge is <= our left edge)
          if (other.x + other.w > item.x) return false;
          // Check vertical overlap
          const otherBottom = other.y + other.h;
          const hasVerticalOverlap = !(other.y >= itemBottom || otherBottom <= item.y);
          return hasVerticalOverlap;
        });

      // Find the rightmost edge of widgets to the left
      let leftBoundary = 0;
      for (const widget of widgetsToLeft) {
        leftBoundary = Math.max(leftBoundary, widget.x + widget.w);
      }
      const spaceOnLeft = item.x - leftBoundary;

      // Calculate space available to the RIGHT (for right-side resize)
      const widgetsToRight = currentLayouts
        .filter(other => {
          if (other.i === item.i) return false;
          // Widget is to the right (its left edge is >= our right edge)
          if (other.x < itemRight) return false;
          // Check vertical overlap
          const otherBottom = other.y + other.h;
          const hasVerticalOverlap = !(other.y >= itemBottom || otherBottom <= item.y);
          return hasVerticalOverlap;
        });

      // Find the leftmost edge of widgets to the right
      let rightBoundary = cols;
      for (const widget of widgetsToRight) {
        rightBoundary = Math.min(rightBoundary, widget.x);
      }
      const spaceOnRight = rightBoundary - itemRight;

      // Calculate space available ABOVE (for top-side resize)
      const widgetsAbove = currentLayouts
        .filter(other => {
          if (other.i === item.i) return false;
          // Widget is above (its bottom edge is <= our top edge)
          if (other.y + other.h > item.y) return false;
          // Check horizontal overlap
          const otherRight = other.x + other.w;
          const hasHorizontalOverlap = !(other.x >= itemRight || otherRight <= item.x);
          return hasHorizontalOverlap;
        });

      // Find the bottommost edge of widgets above
      let topBoundary = 0;
      for (const widget of widgetsAbove) {
        topBoundary = Math.max(topBoundary, widget.y + widget.h);
      }
      const spaceAbove = item.y - topBoundary;

      // Calculate space available BELOW (for bottom-side resize)
      const widgetsBelow = currentLayouts
        .filter(other => {
          if (other.i === item.i) return false;
          // Widget is below (its top edge is >= our bottom edge)
          if (other.y < itemBottom) return false;
          // Check horizontal overlap
          const otherRight = other.x + other.w;
          const hasHorizontalOverlap = !(other.x >= itemRight || otherRight <= item.x);
          return hasHorizontalOverlap;
        });

      // Find the topmost edge of widgets below
      let bottomBoundary = maxRows;
      for (const widget of widgetsBelow) {
        bottomBoundary = Math.min(bottomBoundary, widget.y);
      }
      const spaceBelow = bottomBoundary - itemBottom;

      // maxW = current width + space on left + space on right
      const maxW = item.w + spaceOnLeft + spaceOnRight;

      // maxH = current height + space above + space below
      const maxH = item.h + spaceAbove + spaceBelow;

      maxDimensions.set(item.i, {
        maxH: Math.max(item.h, maxH),
        maxW: Math.max(item.w, maxW)
      });
    }

    return maxDimensions;
  }, [maxRows]);

  // Track when resize was applied to ignore subsequent layout changes from react-grid-layout
  const lastResizeApplyTimeRef = useRef<number>(0);

  const handleLayoutChange = useCallback((newLayout: GridItemLayout[]) => {
    // IMPORTANT: Skip layout change processing if we're in the middle of a resize
    // Our custom resize logic handles the layout changes directly
    // react-grid-layout's built-in collision detection can conflict with our push logic
    if (isResizingRef.current) {
      return;
    }

    // Also skip if we just applied a resize preview (within last 200ms)
    // React-grid-layout fires onLayoutChange after our state update with its own calculated layout
    // which may have collision detection that moves widgets - we want to ignore this
    const timeSinceResizeApply = Date.now() - lastResizeApplyTimeRef.current;
    if (timeSinceResizeApply < 200) {
      console.log('[DEBUG] Skipping handleLayoutChange - too soon after resize apply');
      return;
    }

    // Try to adjust layout to fit within viewport
    const adjustedLayout = adjustLayoutForViewport(newLayout);

    if (!adjustedLayout) {
      // Can't fit - revert to last valid layout
      updateLayouts(lastValidLayoutRef.current);
      return;
    }

    // Calculate maxH and maxW for each widget to prevent resizing beyond viewport/other widgets
    const maxDimensions = calculateMaxDimensions(adjustedLayout);

    // Update layouts while preserving minW/minH and adding maxH/maxW
    const updatedLayouts: GridItemLayout[] = adjustedLayout.map((item: GridItemLayout) => {
      const existingLayout = layouts.find(l => l.i === item.i);
      const dimensions = maxDimensions.get(item.i) ?? { maxH: maxRows - item.y, maxW: GRID_CONFIG.cols - item.x };
      return {
        ...item,
        minW: existingLayout?.minW ?? item.minW,
        minH: existingLayout?.minH ?? item.minH,
        maxH: dimensions.maxH,
        maxW: dimensions.maxW,
      };
    });

    // Store as last valid layout
    lastValidLayoutRef.current = updatedLayouts;
    updateLayouts(updatedLayouts);
  }, [layouts, updateLayouts, adjustLayoutForViewport, calculateMaxDimensions, maxRows]);

  // Check if there's any space available for a widget of given size
  const hasAnySpaceForWidget = useCallback((w: number, h: number): boolean => {
    const cols = GRID_CONFIG.cols;

    // Use a reasonable minimum maxRows if not set yet
    const effectiveMaxRows = Math.max(maxRows, 10);

    // If maxRows is too small for the widget, no space available
    if (effectiveMaxRows < h) {
      return false;
    }

    // Create a grid to track occupied cells
    const grid: boolean[][] = [];
    for (let row = 0; row < effectiveMaxRows; row++) {
      grid[row] = new Array(cols).fill(false);
    }

    // Mark occupied cells
    for (const layout of layouts) {
      for (let row = layout.y; row < layout.y + layout.h && row < effectiveMaxRows; row++) {
        for (let col = layout.x; col < layout.x + layout.w && col < cols; col++) {
          if (row >= 0 && row < effectiveMaxRows && col >= 0 && col < cols) {
            grid[row][col] = true;
          }
        }
      }
    }

    // Check if widget can fit anywhere
    for (let row = 0; row <= effectiveMaxRows - h; row++) {
      for (let col = 0; col <= cols - w; col++) {
        let canFit = true;
        for (let r = row; r < row + h && canFit; r++) {
          for (let c = col; c < col + w && canFit; c++) {
            if (grid[r] && grid[r][c]) {
              canFit = false;
            }
          }
        }
        if (canFit) {
          return true;
        }
      }
    }

    return false;
  }, [layouts, maxRows]);

  const handleDrop = useCallback((
    _layout: GridItemLayout[],
    layoutItem: GridItemLayout,
    event: Event
  ) => {
    // Reset external drag state
    setIsExternalDrag(false);
    setHasSpaceForDrop(true);
    setPushPreview(null);

    const e = event as DragEvent;
    const dragDataStr = e.dataTransfer?.getData('text/plain');

    if (!dragDataStr) return;

    try {
      const dragData: WidgetDragData = JSON.parse(dragDataStr);
      const size = DEFAULT_WIDGET_SIZES[dragData.type];

      // Feature 5: Try to place at drop location, with push if needed
      const targetX = layoutItem.x;
      const targetY = layoutItem.y;

      // Check if the target position is available
      const occupancy = createOccupancyGrid(layouts, GRID_CONFIG.cols, maxRows);
      const canPlaceDirectly = canFitAt(occupancy, targetX, targetY, size.w, size.h);

      if (canPlaceDirectly) {
        // Direct placement at target
        addWidget(dragData.type, dragData.title, dragData.props);
      } else {
        // Try to push widgets to make space
        const pushResult = calculatePush(
          layouts,
          targetX,
          targetY,
          size.w,
          size.h,
          GRID_CONFIG.cols,
          maxRows
        );

        if (pushResult.canPush && pushResult.pushedWidgets.length > 0) {
          // Apply pushed layouts first, then add the new widget
          const maxDimensions = calculateMaxDimensions(pushResult.newLayouts);
          const pushedLayouts = pushResult.newLayouts.map(item => {
            const widget = widgets.find(w => w.i === item.i);
            const sizes = widget ? DEFAULT_WIDGET_SIZES[widget.type] : DEFAULT_WIDGET_SIZES.chart;
            const dimensions = maxDimensions.get(item.i) ?? { maxH: maxRows - item.y, maxW: GRID_CONFIG.cols - item.x };
            return {
              ...item,
              minW: sizes.minW,
              minH: sizes.minH,
              maxH: dimensions.maxH,
              maxW: dimensions.maxW,
            };
          });
          updateLayouts(pushedLayouts);

          // Add the new widget after a brief delay to ensure layout is updated
          setTimeout(() => {
            addWidget(dragData.type, dragData.title, dragData.props);
          }, 50);
        } else {
          // Fall back to auto-placement (finds first available position)
          addWidget(dragData.type, dragData.title, dragData.props);
        }
      }
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  }, [addWidget, layouts, widgets, maxRows, updateLayouts, calculateMaxDimensions]);

  // Handle drag enter from widget panel - check if there's space
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    // Check if this is an external drag (from widget panel)
    const hasTextData = e.dataTransfer?.types.includes('text/plain');
    if (hasTextData && !isDraggingWidget) {
      setIsExternalDrag(true);
      const defaultSize = DEFAULT_WIDGET_SIZES.chart;
      const hasSpace = hasAnySpaceForWidget(defaultSize.w, defaultSize.h);
      setHasSpaceForDrop(hasSpace);
    }
  }, [hasAnySpaceForWidget, isDraggingWidget]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = hasSpaceForDrop ? 'copy' : 'none';
  }, [hasSpaceForDrop]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only reset when leaving the container completely
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setHasSpaceForDrop(true);
      setIsExternalDrag(false);
    }
  }, []);

  // Track resize state for mouse-based push detection
  const resizingWidgetIdRef = useRef<string | null>(null);
  const resizeStartMouseXRef = useRef<number>(0);
  const resizeStartMouseYRef = useRef<number>(0);
  const resizeDirectionRef = useRef<'e' | 'w' | 's' | 'n' | 'se' | 'sw' | 'ne' | 'nw' | null>(null);
  // Track the maximum gridDeltaX reached during this resize operation (for smooth reverse)
  const maxGridDeltaXRef = useRef<number>(0);

  // Handle resize start - store the current valid layout and build DOM element map
  const handleResizeStart = useCallback((currentLayout: GridItemLayout[], oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, e: MouseEvent, _element: HTMLElement) => {
    isResizingRef.current = true;
    resizingWidgetIdRef.current = oldItem.i;
    resizeStartMouseXRef.current = e.clientX;
    resizeStartMouseYRef.current = e.clientY;

    // Detect resize direction from the handle being used
    // IMPORTANT: Check corner handles (se, sw, ne, nw) BEFORE edge handles (e, w, s, n)
    // because 'react-resizable-handle-se' also includes 'react-resizable-handle-s'
    const handleClass = (e.target as HTMLElement)?.className || '';
    if (handleClass.includes('react-resizable-handle-se')) resizeDirectionRef.current = 'se';
    else if (handleClass.includes('react-resizable-handle-sw')) resizeDirectionRef.current = 'sw';
    else if (handleClass.includes('react-resizable-handle-ne')) resizeDirectionRef.current = 'ne';
    else if (handleClass.includes('react-resizable-handle-nw')) resizeDirectionRef.current = 'nw';
    else if (handleClass.includes('react-resizable-handle-e')) resizeDirectionRef.current = 'e';
    else if (handleClass.includes('react-resizable-handle-w')) resizeDirectionRef.current = 'w';
    else if (handleClass.includes('react-resizable-handle-s')) resizeDirectionRef.current = 's';
    else if (handleClass.includes('react-resizable-handle-n')) resizeDirectionRef.current = 'n';
    else resizeDirectionRef.current = 'e'; // Default to east

    resizeLogger.startSession(oldItem.i, resizeDirectionRef.current);

    // Store the original layout at resize start - this is used for calculating push operations
    // Use currentLayout from react-grid-layout (passed as first param) to ensure we have the latest state
    // Also use lastValidLayoutRef as a fallback if currentLayout doesn't have our widgets
    const baseLayout = currentLayout.length > 0 ? currentLayout : layouts;
    resizeStartLayoutRef.current = baseLayout.map(l => ({ ...l }));
    lastValidLayoutRef.current = baseLayout.map(l => ({ ...l }));
    lastPushedLayoutRef.current = null; // Reset for new resize operation
    maxGridDeltaXRef.current = 0; // Reset max expansion tracker
    setResizePreview(null);

    // Build widget DOM element map for direct manipulation during resize
    if (containerRef.current && containerWidth > 0) {
      const colWidth = (containerWidth - GRID_CONFIG.containerPadding[0] * 2 - GRID_CONFIG.margin[0] * (GRID_CONFIG.cols - 1)) / GRID_CONFIG.cols;
      const gridItems = Array.from(containerRef.current.querySelectorAll('.react-grid-item')) as HTMLElement[];

      widgetDomMapRef.current.clear();

      // Match each layout position to its DOM element
      // Use baseLayout which has the correct current positions
      for (const layout of baseLayout) {
        const expectedPixelX = GRID_CONFIG.containerPadding[0] + layout.x * (colWidth + GRID_CONFIG.margin[0]);
        const expectedPixelY = GRID_CONFIG.containerPadding[1] + layout.y * (GRID_CONFIG.rowHeight + GRID_CONFIG.margin[1]);

        const matchingElement = gridItems.find((htmlItem) => {
          const transform = htmlItem.style.transform;
          if (transform) {
            const match = transform.match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
            if (match) {
              const currentX = parseFloat(match[1]);
              const currentY = parseFloat(match[2]);
              return Math.abs(currentX - expectedPixelX) < 10 && Math.abs(currentY - expectedPixelY) < 10;
            }
          }
          return false;
        });

        if (matchingElement) {
          widgetDomMapRef.current.set(layout.i, matchingElement);
        }
      }
    }
  }, [layouts, containerWidth]);

  // Handle resize stop - apply space management or validate layout
  const handleResizeStop = useCallback((newLayout: GridItemLayout[], oldItem: GridItemLayout, newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    const cols = GRID_CONFIG.cols;

    resizeLogger.log('RESIZE STOP', {
      hasResizePreview: !!resizePreview,
      movedWidgets: resizePreview?.movedWidgets?.length ?? 0,
    });

    // Feature 6: Apply resize space management if preview is active
    if (resizePreview && resizePreview.newLayouts.length > 0) {
      resizeLogger.log('APPLYING PREVIEW', {
        layouts: resizePreview.newLayouts.map(l => `${l.i.slice(-8)}: x=${l.x}, y=${l.y}, w=${l.w}, h=${l.h}`)
      });
      resizeLogger.endSession();

      // Final validation: ensure no widget is outside viewport before applying
      const hasInvalidPosition = resizePreview.newLayouts.some(layout =>
        layout.x < 0 ||
        layout.x + layout.w > cols ||
        layout.y < 0 ||
        layout.y + layout.h > maxRows
      );

      if (hasInvalidPosition) {
        console.log('[DEBUG] handleResizeStop: Invalid layout in preview, reverting to last valid');
        updateLayouts(lastValidLayoutRef.current);
        setResizePreview(null);
        isResizingRef.current = false;
        return;
      }

      const maxDimensions = calculateMaxDimensions(resizePreview.newLayouts);
      const validLayout = resizePreview.newLayouts.map(item => {
        const widget = widgets.find(w => w.i === item.i);
        const sizes = widget ? DEFAULT_WIDGET_SIZES[widget.type] : DEFAULT_WIDGET_SIZES.chart;
        const dimensions = maxDimensions.get(item.i) ?? { maxH: maxRows - item.y, maxW: cols - item.x };
        return {
          ...item,
          minW: sizes.minW,
          minH: sizes.minH,
          maxH: dimensions.maxH,
          maxW: dimensions.maxW,
        };
      });
      lastValidLayoutRef.current = validLayout;
      // Mark the time we applied resize to ignore subsequent layout changes from react-grid-layout
      lastResizeApplyTimeRef.current = Date.now();
      updateLayouts(validLayout);
      setResizePreview(null);
      // Reset isResizing AFTER layout update to prevent handleLayoutChange from interfering
      isResizingRef.current = false;
      return;
    }

    // Reset isResizing flag
    isResizingRef.current = false;

    setResizePreview(null);

    // Feature 2: Enforce minimum dimensions
    const validatedLayout = newLayout.map(item => {
      const widget = widgets.find(w => w.i === item.i);
      const widgetType = widget?.type || 'chart';
      const minSizes = DEFAULT_WIDGET_SIZES[widgetType];
      return {
        ...item,
        w: Math.max(item.w, minSizes.minW),
        h: Math.max(item.h, minSizes.minH),
      };
    });

    // Check if any widget is outside viewport (vertical or horizontal)
    const isInvalid = validatedLayout.some(item =>
      item.y + item.h > maxRows || item.x + item.w > cols
    );

    if (isInvalid) {
      // Revert to last valid layout
      updateLayouts(lastValidLayoutRef.current);
    } else {
      // Feature 7: For shrinking, preserve other widget positions (don't compact)
      const isShrinking = newItem.w < oldItem.w || newItem.h < oldItem.h;

      let finalLayout: GridItemLayout[];
      if (isShrinking) {
        // Preserve positions of all other widgets
        finalLayout = validatedLayout.map(item => {
          if (item.i === newItem.i) {
            return item; // Apply shrink to the resized widget
          }
          // Keep original position for other widgets
          const original = lastValidLayoutRef.current.find(l => l.i === item.i);
          return original ? { ...item, x: original.x, y: original.y } : item;
        });
      } else {
        finalLayout = validatedLayout;
      }

      // Calculate maxH and maxW for the final layout
      const maxDimensions = calculateMaxDimensions(finalLayout);

      // Update with min/max dimensions
      const layoutWithDimensions = finalLayout.map(item => {
        const widget = widgets.find(w => w.i === item.i);
        const sizes = widget ? DEFAULT_WIDGET_SIZES[widget.type] : DEFAULT_WIDGET_SIZES.chart;
        const dimensions = maxDimensions.get(item.i) ?? { maxH: maxRows - item.y, maxW: cols - item.x };
        return {
          ...item,
          minW: sizes.minW,
          minH: sizes.minH,
          maxH: dimensions.maxH,
          maxW: dimensions.maxW,
        };
      });

      lastValidLayoutRef.current = layoutWithDimensions;
      updateLayouts(layoutWithDimensions);
    }
  }, [layouts, widgets, maxRows, updateLayouts, calculateMaxDimensions, resizePreview]);

  // Feature 3: Enhanced empty space detection using grid helpers
  // Returns exact-fit positions where the widget can be dropped
  const calculateAvailableZones = useCallback((widgetW: number, widgetH: number, excludeId: string): GridZone[] => {
    const occupancy = createOccupancyGrid(layouts, GRID_CONFIG.cols, maxRows, excludeId);
    return findAllFitPositions(occupancy, widgetW, widgetH);
  }, [layouts, maxRows]);

  // Helper to get grid position from mouse coordinates
  const getGridPositionFromMouse = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return pixelToGridCoords(
      clientX,
      clientY,
      rect,
      containerWidth,
      GRID_CONFIG.cols,
      GRID_CONFIG.rowHeight,
      GRID_CONFIG.margin,
      GRID_CONFIG.containerPadding,
      maxRows
    );
  }, [containerWidth, maxRows]);

  // Get widget minimum sizes map for resize calculations
  const getWidgetMinSizes = useCallback((): WidgetMinSizes => {
    const minSizes: WidgetMinSizes = {};
    for (const widget of widgets) {
      const sizes = DEFAULT_WIDGET_SIZES[widget.type];
      minSizes[widget.i] = { minW: sizes.minW, minH: sizes.minH };
    }
    return minSizes;
  }, [widgets]);

  // Move a widget's DOM element directly during resize for smooth visual feedback
  const moveWidgetDom = useCallback((widgetId: string, gridX: number, gridY: number) => {
    if (containerWidth === 0 || !containerRef.current) return;

    const colWidth = (containerWidth - GRID_CONFIG.containerPadding[0] * 2 - GRID_CONFIG.margin[0] * (GRID_CONFIG.cols - 1)) / GRID_CONFIG.cols;

    // Get the cached DOM element reference
    const targetElement = widgetDomMapRef.current.get(widgetId);
    if (!targetElement) return;

    // Calculate new pixel position
    const newPixelX = GRID_CONFIG.containerPadding[0] + gridX * (colWidth + GRID_CONFIG.margin[0]);
    const newPixelY = GRID_CONFIG.containerPadding[1] + gridY * (GRID_CONFIG.rowHeight + GRID_CONFIG.margin[1]);

    // Apply transform directly for smooth visual feedback
    targetElement.style.transform = `translate(${newPixelX}px, ${newPixelY}px)`;
  }, [containerWidth]);

  // Resize a widget's DOM element directly during resize for smooth visual feedback
  const resizeWidgetDom = useCallback((widgetId: string, gridW: number, gridH: number) => {
    if (containerWidth === 0 || !containerRef.current) return;

    const colWidth = (containerWidth - GRID_CONFIG.containerPadding[0] * 2 - GRID_CONFIG.margin[0] * (GRID_CONFIG.cols - 1)) / GRID_CONFIG.cols;

    // Get the cached DOM element reference
    const targetElement = widgetDomMapRef.current.get(widgetId);
    if (!targetElement) return;

    // Calculate new pixel dimensions
    const newPixelW = gridW * colWidth + (gridW - 1) * GRID_CONFIG.margin[0];
    const newPixelH = gridH * GRID_CONFIG.rowHeight + (gridH - 1) * GRID_CONFIG.margin[1];

    // Apply size directly for smooth visual feedback
    targetElement.style.width = `${newPixelW}px`;
    targetElement.style.height = `${newPixelH}px`;
  }, [containerWidth]);

  // Track mouse movement during resize to detect push needs (bypasses react-grid-layout collision detection)
  // IMPORTANT: This only activates when there's a COLLISION - otherwise let react-grid-layout handle it
  // Supports both horizontal (east/west) and vertical (south/north) push behavior
  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!isResizingRef.current) return;
      if (!resizingWidgetIdRef.current || !containerRef.current || containerWidth === 0) return;

      const direction = resizeDirectionRef.current;
      if (!direction) return;

      const isEastResize = direction.includes('e');
      const isWestResize = direction.includes('w');
      const isSouthResize = direction.includes('s');
      const isNorthResize = direction.includes('n');
      const isCornerResize = direction.length === 2; // se, sw, ne, nw

      const isHorizontalResize = isEastResize || isWestResize;
      const isVerticalResize = isSouthResize || isNorthResize;

      // If no resize direction we handle, return
      if (!isHorizontalResize && !isVerticalResize) return;

      const colWidth = (containerWidth - GRID_CONFIG.containerPadding[0] * 2 - GRID_CONFIG.margin[0] * (GRID_CONFIG.cols - 1)) / GRID_CONFIG.cols;
      const cellWidth = colWidth + GRID_CONFIG.margin[0];
      const cellHeight = GRID_CONFIG.rowHeight + GRID_CONFIG.margin[1];

      const baseLayouts = resizeStartLayoutRef.current;
      const resizingLayout = baseLayouts.find(l => l.i === resizingWidgetIdRef.current);
      if (!resizingLayout) return;

      // Calculate mouse deltas
      const mouseDeltaX = e.clientX - resizeStartMouseXRef.current;
      const mouseDeltaY = e.clientY - resizeStartMouseYRef.current;
      const absMouseDeltaX = Math.abs(mouseDeltaX);
      const absMouseDeltaY = Math.abs(mouseDeltaY);

      // For corner resizes, determine which direction is dominant
      let handleHorizontal = isHorizontalResize;
      let handleVertical = isVerticalResize;

      if (isCornerResize) {
        // For corner resizes, only handle one direction at a time based on dominant movement
        // Require 2x dominance to switch modes
        const isHorizontalDominant = absMouseDeltaX > absMouseDeltaY * 2;
        const isVerticalDominant = absMouseDeltaY > absMouseDeltaX * 2;

        if (isHorizontalDominant) {
          handleVertical = false;
        } else if (isVerticalDominant) {
          handleHorizontal = false;
        } else {
          // Neither is dominant enough - don't handle push, just constrain width if needed
          if (lastPushedLayoutRef.current) {
            for (const l of baseLayouts) {
              if (l.i !== resizingWidgetIdRef.current) {
                moveWidgetDom(l.i, l.x, l.y);
              }
            }
            setResizePreview(null);
            lastPushedLayoutRef.current = null;
          }
          // Constrain width to original during ambiguous corner resize
          const element = widgetDomMapRef.current.get(resizingWidgetIdRef.current);
          if (element) {
            const originalPixelW = resizingLayout.w * colWidth + (resizingLayout.w - 1) * GRID_CONFIG.margin[0];
            element.style.width = `${originalPixelW}px`;
          }
          return;
        }
      }

      // Calculate grid deltas
      const gridDeltaX = Math.round(mouseDeltaX / cellWidth);
      const gridDeltaY = Math.round(mouseDeltaY / cellHeight);

      // HORIZONTAL RESIZE HANDLING (east/west) - Push widgets until viewport edge
      if (handleHorizontal && !handleVertical) {
        const effectiveDeltaX = isEastResize ? gridDeltaX : -gridDeltaX;
        const requestedW = resizingLayout.w + effectiveDeltaX;
        const minW = resizingLayout.minW ?? 3;

        // If shrinking, dependent widgets should return to original position (not follow)
        if (requestedW <= resizingLayout.w) {
          const limitedW = Math.max(minW, requestedW);
          const limitedX = isWestResize
            ? resizingLayout.x + resizingLayout.w - limitedW
            : resizingLayout.x;

          resizeWidgetDom(resizingWidgetIdRef.current, limitedW, resizingLayout.h);
          if (isWestResize) {
            moveWidgetDom(resizingWidgetIdRef.current, limitedX, resizingLayout.y);
          }

          // Reset all dependent widgets to their ORIGINAL positions from baseLayouts
          // (baseLayouts is the layout at resize START, before any pushing)
          for (const l of baseLayouts) {
            if (l.i !== resizingWidgetIdRef.current) {
              moveWidgetDom(l.i, l.x, l.y);
            }
          }

          // Build new layouts with resizing widget at new size, others at original positions
          const newLayouts = baseLayouts.map(l => {
            if (l.i === resizingWidgetIdRef.current) {
              return { ...l, x: limitedX, w: limitedW };
            }
            return l; // Keep original position
          });

          setResizePreview({ newLayouts, movedWidgets: [], shrunkWidgets: [] });
          lastPushedLayoutRef.current = newLayouts;
          return;
        }

        // Expanding - need to push widgets until they hit viewport edge (CHAIN PUSHING)
        const originalRightEdge = resizingLayout.x + resizingLayout.w;
        const originalLeftEdge = resizingLayout.x;

        // Helper function to check if two widgets have vertical overlap
        const hasVerticalOverlapBetween = (w1: { y: number; h: number }, w2: { y: number; h: number }) => {
          const w1Top = w1.y;
          const w1Bottom = w1.y + w1.h;
          const w2Top = w2.y;
          const w2Bottom = w2.y + w2.h;
          return !(w1Bottom <= w2Top || w1Top >= w2Bottom);
        };

        // Helper function to check vertical overlap with resizing widget
        const hasVerticalOverlap = (widget: { y: number; h: number }) => {
          return hasVerticalOverlapBetween(resizingLayout, widget);
        };

        // CHAIN PUSH: Find ALL widgets that form a chain from resizing widget to viewport
        // A chain is formed when widgets block each other horizontally AND have vertical overlap
        const allWidgets = baseLayouts
          .filter(l => l.i !== resizingWidgetIdRef.current)
          .map(l => ({ id: l.i, x: l.x, w: l.w, y: l.y, h: l.h }));

        // Build the chain of widgets that need to be pushed
        const widgetsToPush: Array<{ id: string; x: number; w: number; y: number; h: number }> = [];
        const processed = new Set<string>();

        // Start with widgets directly ADJACENT to the resizing widget (touching, no gap)
        const directlyBlocked = allWidgets.filter(w => {
          if (!hasVerticalOverlap(w)) return false;
          if (isEastResize) {
            // Widget must START exactly at resizing widget's right edge (no gap)
            return w.x === originalRightEdge;
          }
          // West resize - widget must END exactly at resizing widget's left edge
          return w.x + w.w === originalLeftEdge;
        });

        // BFS to find all widgets in the chain
        // IMPORTANT: Only add widgets that are ADJACENT (touching) to the chain
        const queue = [...directlyBlocked];
        while (queue.length > 0) {
          const current = queue.shift()!;
          if (processed.has(current.id)) continue;
          processed.add(current.id);
          widgetsToPush.push(current);

          // Find widgets that this widget would push (must be ADJACENT - touching or overlapping)
          for (const other of allWidgets) {
            if (processed.has(other.id)) continue;
            if (!hasVerticalOverlapBetween(current, other)) continue;

            if (isEastResize) {
              // Other widget must be ADJACENT to current's right edge (touching or within 1 column)
              // This means other.x should equal current.x + current.w (no gap)
              const currentRightEdge = current.x + current.w;
              if (other.x === currentRightEdge) {
                queue.push(other);
              }
            } else {
              // Other widget must be ADJACENT to current's left edge
              const currentLeftEdge = current.x;
              if (other.x + other.w === currentLeftEdge) {
                queue.push(other);
              }
            }
          }
        }

        // Sort widgets by X position (left to right for east, right to left for west)
        widgetsToPush.sort((a, b) => isEastResize ? a.x - b.x : b.x - a.x);

        // Find widgets NOT in the chain that could block the push
        const chainIds = new Set(widgetsToPush.map(w => w.id));
        const nonChainWidgets = allWidgets.filter(w => !chainIds.has(w.id));

        // Calculate available space considering:
        // 1. Viewport edge
        // 2. Non-chain widgets that could block (have vertical overlap with chain widgets)
        let availableSpace: number;

        if (isEastResize) {
          if (widgetsToPush.length > 0) {
            // Find the rightmost edge of all widgets in the chain
            const rightmostEdge = Math.max(...widgetsToPush.map(w => w.x + w.w));

            // Check if any non-chain widget would block the push
            // A non-chain widget blocks if it has vertical overlap with ANY chain widget
            // and is to the right of the chain
            let blockingEdge = GRID_CONFIG.cols; // Default to viewport edge

            for (const nonChain of nonChainWidgets) {
              // Check if this non-chain widget has vertical overlap with any chain widget
              const hasOverlapWithChain = widgetsToPush.some(chainWidget =>
                hasVerticalOverlapBetween(chainWidget, nonChain)
              );

              if (hasOverlapWithChain && nonChain.x >= rightmostEdge) {
                // This widget could block - find the closest one
                blockingEdge = Math.min(blockingEdge, nonChain.x);
              }
            }

            availableSpace = blockingEdge - rightmostEdge;
          } else {
            // No widgets to push - check for blockers from original right edge
            let blockingEdge = GRID_CONFIG.cols;

            for (const nonChain of nonChainWidgets) {
              if (hasVerticalOverlap(nonChain) && nonChain.x >= originalRightEdge) {
                blockingEdge = Math.min(blockingEdge, nonChain.x);
              }
            }

            availableSpace = blockingEdge - originalRightEdge;
          }
        } else {
          // West resize
          if (widgetsToPush.length > 0) {
            // Find the leftmost edge of all widgets in the chain
            const leftmostEdge = Math.min(...widgetsToPush.map(w => w.x));

            // Check for blocking non-chain widgets to the left
            let blockingEdge = 0; // Default to viewport edge

            for (const nonChain of nonChainWidgets) {
              const hasOverlapWithChain = widgetsToPush.some(chainWidget =>
                hasVerticalOverlapBetween(chainWidget, nonChain)
              );

              if (hasOverlapWithChain && nonChain.x + nonChain.w <= leftmostEdge) {
                // This widget could block - find the closest one (rightmost edge)
                blockingEdge = Math.max(blockingEdge, nonChain.x + nonChain.w);
              }
            }

            availableSpace = leftmostEdge - blockingEdge;
          } else {
            // No widgets to push - check for blockers from original left edge
            let blockingEdge = 0;

            for (const nonChain of nonChainWidgets) {
              if (hasVerticalOverlap(nonChain) && nonChain.x + nonChain.w <= originalLeftEdge) {
                blockingEdge = Math.max(blockingEdge, nonChain.x + nonChain.w);
              }
            }

            availableSpace = originalLeftEdge - blockingEdge;
          }
        }

        // Calculate max allowed width
        const maxAllowedWidth = resizingLayout.w + availableSpace;

        // Calculate final width (limited by available space)
        const finalW = Math.max(minW, Math.min(requestedW, maxAllowedWidth));
        const finalX = isWestResize
          ? resizingLayout.x + resizingLayout.w - finalW
          : resizingLayout.x;

        // Calculate expansion amount
        const expansion = finalW - resizingLayout.w;

        // Calculate new positions for pushed widgets
        const newPositions: Map<string, number> = new Map();

        if (expansion > 0) {
          if (isEastResize) {
            for (const w of widgetsToPush) {
              const newX = w.x + expansion;
              // Clamp to viewport edge
              const clampedX = Math.min(newX, GRID_CONFIG.cols - w.w);
              newPositions.set(w.id, clampedX);
            }
          } else {
            for (const w of widgetsToPush) {
              const newX = w.x - expansion;
              // Clamp to viewport edge (x=0)
              const clampedX = Math.max(0, newX);
              newPositions.set(w.id, clampedX);
            }
          }
        }

        console.log('=== HORIZONTAL RESIZE DEBUG (CHAIN PUSH MODE) ===');
        console.log('Resizing widget:', resizingLayout.i.slice(-8), `x=${resizingLayout.x}, y=${resizingLayout.y}, w=${resizingLayout.w}, h=${resizingLayout.h}`);
        console.log('RequestedW:', requestedW, 'FinalW:', finalW, 'MaxAllowedWidth:', maxAllowedWidth, 'AvailableSpace:', availableSpace);
        console.log('Expansion:', expansion);
        console.log('Widgets in chain:', widgetsToPush.length);
        widgetsToPush.forEach(w => {
          const newX = newPositions.get(w.id);
          console.log(`  - ${w.id.slice(-8)}: x=${w.x} -> ${newX}, y=${w.y}, w=${w.w}, h=${w.h}`);
        });
        console.log('=== END DEBUG ===');

        // Apply DOM updates
        resizeWidgetDom(resizingWidgetIdRef.current, finalW, resizingLayout.h);
        if (isWestResize) {
          moveWidgetDom(resizingWidgetIdRef.current, finalX, resizingLayout.y);
        }

        // Move pushed widgets
        const movedWidgetIds: string[] = [];
        for (const w of widgetsToPush) {
          const newX = newPositions.get(w.id);
          if (newX !== undefined && newX !== w.x) {
            // IMPORTANT: Preserve original Y position
            moveWidgetDom(w.id, newX, w.y);
            movedWidgetIds.push(w.id);
          }
        }

        // Update preview - preserve Y position for ALL widgets
        const newLayouts = baseLayouts.map(l => {
          if (l.i === resizingWidgetIdRef.current) {
            return { ...l, x: finalX, w: finalW, y: resizingLayout.y, h: resizingLayout.h };
          }
          const newX = newPositions.get(l.i);
          if (newX !== undefined) {
            return { ...l, x: newX, y: l.y, h: l.h }; // Preserve Y and H
          }
          return { ...l };
        });

        // Validate: ensure no widget goes outside viewport
        const hasInvalidPosition = newLayouts.some(layout =>
          layout.x < 0 ||
          layout.x + layout.w > GRID_CONFIG.cols ||
          layout.y < 0 ||
          layout.y + layout.h > maxRows
        );

        if (hasInvalidPosition) {
          console.log('[DEBUG] Invalid layout - reverting');
          for (const l of baseLayouts) {
            if (l.i !== resizingWidgetIdRef.current) {
              moveWidgetDom(l.i, l.x, l.y);
            }
          }
          return;
        }

        setResizePreview({ newLayouts, movedWidgets: movedWidgetIds, shrunkWidgets: [] });
        lastPushedLayoutRef.current = newLayouts;
        return;
      }

      // VERTICAL PUSH HANDLING (south/north)
      if (handleVertical && !handleHorizontal) {
        const effectiveDeltaY = isSouthResize ? gridDeltaY : -gridDeltaY;

        // If not expanding, reset and return
        if ((isSouthResize && gridDeltaY <= 0) || (isNorthResize && gridDeltaY >= 0)) {
          if (lastPushedLayoutRef.current) {
            for (const l of baseLayouts) {
              if (l.i !== resizingWidgetIdRef.current) {
                moveWidgetDom(l.i, l.x, l.y);
              }
            }
            setResizePreview(null);
            lastPushedLayoutRef.current = null;
          }
          return;
        }

        const requestedH = resizingLayout.h + effectiveDeltaY;
        const requestedY = isNorthResize ? Math.max(0, resizingLayout.y - effectiveDeltaY) : resizingLayout.y;
        const newBottomEdge = requestedY + requestedH;
        const newTopEdge = requestedY;

        // Check viewport bounds
        if (newBottomEdge > maxRows || newTopEdge < 0) return;

        // Collect widgets that could be affected (have horizontal overlap)
        const potentialWidgets: Array<{ id: string; origY: number; h: number; x: number; w: number }> = [];
        let hasCollision = false;
        const originalBottomEdge = resizingLayout.y + resizingLayout.h;
        const originalTopEdge = resizingLayout.y;

        for (const l of baseLayouts) {
          if (l.i === resizingWidgetIdRef.current) continue;
          const hasHorizontalOverlap = !(l.x >= resizingLayout.x + resizingLayout.w || l.x + l.w <= resizingLayout.x);
          if (!hasHorizontalOverlap) continue;

          if (isSouthResize && l.y >= originalBottomEdge) {
            potentialWidgets.push({ id: l.i, origY: l.y, h: l.h, x: l.x, w: l.w });
            if (newBottomEdge > l.y && newBottomEdge > originalBottomEdge) hasCollision = true;
          } else if (isNorthResize && l.y + l.h <= originalTopEdge) {
            potentialWidgets.push({ id: l.i, origY: l.y, h: l.h, x: l.x, w: l.w });
            if (newTopEdge < l.y + l.h && newTopEdge < originalTopEdge) hasCollision = true;
          }
        }

        if (!hasCollision) {
          if (lastPushedLayoutRef.current) {
            for (const l of baseLayouts) {
              if (l.i !== resizingWidgetIdRef.current) {
                moveWidgetDom(l.i, l.x, l.y);
              }
            }
            setResizePreview(null);
            lastPushedLayoutRef.current = null;
          }
          return;
        }

        // Calculate push positions
        const newPositions: Map<string, number> = new Map();
        let canPush = true;

        if (isSouthResize) {
          // Sort top to bottom (closest first)
          potentialWidgets.sort((a, b) => a.origY - b.origY);
          let currentBottomEdge = newBottomEdge;
          for (const widget of potentialWidgets) {
            if (currentBottomEdge > widget.origY) {
              const newY = currentBottomEdge;
              if (newY + widget.h > maxRows) { canPush = false; break; }
              newPositions.set(widget.id, newY);
              currentBottomEdge = newY + widget.h;
            } else {
              newPositions.set(widget.id, widget.origY);
              currentBottomEdge = widget.origY + widget.h;
            }
          }
        } else {
          // Sort bottom to top (closest first)
          potentialWidgets.sort((a, b) => b.origY - a.origY);
          let currentTopEdge = newTopEdge;
          for (const widget of potentialWidgets) {
            if (currentTopEdge < widget.origY + widget.h) {
              const newY = currentTopEdge - widget.h;
              if (newY < 0) { canPush = false; break; }
              newPositions.set(widget.id, newY);
              currentTopEdge = newY;
            } else {
              newPositions.set(widget.id, widget.origY);
              currentTopEdge = widget.origY;
            }
          }
        }

        if (!canPush) return;

        // Update DOM
        resizeWidgetDom(resizingWidgetIdRef.current, resizingLayout.w, requestedH);
        if (isNorthResize) {
          moveWidgetDom(resizingWidgetIdRef.current, resizingLayout.x, requestedY);
        }

        const movedWidgetIds: string[] = [];
        for (const widget of potentialWidgets) {
          const newY = newPositions.get(widget.id);
          if (newY !== undefined) {
            moveWidgetDom(widget.id, widget.x, newY);
            if (newY !== widget.origY) movedWidgetIds.push(widget.id);
          }
        }

        const newLayouts = baseLayouts.map(l => {
          if (l.i === resizingWidgetIdRef.current) return { ...l, y: requestedY, h: requestedH };
          const newY = newPositions.get(l.i);
          if (newY !== undefined) return { ...l, y: newY };
          return l;
        });

        setResizePreview({ newLayouts, movedWidgets: movedWidgetIds, shrunkWidgets: [] });
        lastPushedLayoutRef.current = newLayouts;
        return;
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [containerWidth, maxRows, resizeWidgetDom, moveWidgetDom]);

  // Feature 6: Handle resize to detect space management needs
  // Supports resizing from all directions (top, bottom, left, right)
  // This function directly manipulates DOM for smooth visual feedback during resize
  const handleResize = useCallback((
    _layout: GridItemLayout[],
    oldItem: GridItemLayout,
    newItem: GridItemLayout,
    _placeholder: GridItemLayout,
    e: MouseEvent,
    _element: HTMLElement
  ) => {
    console.log('[DEBUG] handleResize called');
    try {
    const widgetMinSizes = getWidgetMinSizes();
    // Use resizeStartLayoutRef.current which contains the layout at resize start
    // This ensures we're always calculating based on the original positions
    const baseLayouts = resizeStartLayoutRef.current;

    // For corner resizes (se, sw, ne, nw), check if user is primarily resizing vertically
    // If so, constrain width to prevent accidental horizontal resize
    const direction = resizeDirectionRef.current;
    const isCornerResize = direction && direction.length === 2;

    if (isCornerResize) {
      const mouseDeltaX = Math.abs(e.clientX - resizeStartMouseXRef.current);
      const mouseDeltaY = Math.abs(e.clientY - resizeStartMouseYRef.current);

      // If vertical movement is dominant (more than horizontal), constrain width to original
      // This prevents width from changing when user intends to only resize height
      if (mouseDeltaY > mouseDeltaX) {
        const originalLayout = baseLayouts.find(l => l.i === newItem.i);
        if (originalLayout) {
          newItem = { ...newItem, w: originalLayout.w, x: originalLayout.x };
        }
      }
    }

    // Get the original layout to check maxW constraint
    const originalLayout = baseLayouts.find(l => l.i === newItem.i);

    // Check if this is an enlargement (size increased OR position moved to expand)
    // OR if we're at the maxW/maxH boundary (react-grid-layout blocks further resize)
    // Enlargement can happen in any direction:
    // - Right/Bottom: w or h increases
    // - Left: x decreases (widget expands left)
    // - Top: y decreases (widget expands up)
    const isAtMaxWBoundary = originalLayout?.maxW !== undefined && newItem.w >= originalLayout.maxW && newItem.x === oldItem.x;
    const isAtMaxHBoundary = originalLayout?.maxH !== undefined && newItem.h >= originalLayout.maxH && newItem.y === oldItem.y;

    // Check if we're touching or overlapping a dependent widget (need to push)
    // Use lastPushedLayoutRef if available (for incremental pushing), otherwise use baseLayouts
    const currentLayouts = lastPushedLayoutRef.current || baseLayouts;

    // Find widgets to the right that we're touching or would overlap
    const newRightEdge = newItem.x + newItem.w;
    let touchingWidgetRight = false;
    let rightWidgetId: string | null = null;

    for (const l of currentLayouts) {
      if (l.i === newItem.i) continue;
      // Has vertical overlap
      const hasVerticalOverlap = !(l.y >= newItem.y + newItem.h || l.y + l.h <= newItem.y);
      if (!hasVerticalOverlap) continue;

      // Widget is adjacent to our right edge OR we would overlap it
      const isAdjacent = l.x === newRightEdge;
      const wouldOverlap = l.x < newRightEdge && l.x + l.w > newItem.x;

      if (isAdjacent || wouldOverlap) {
        touchingWidgetRight = true;
        rightWidgetId = l.i;
        break;
      }
    }

    // Check for bottom touch
    const newBottomEdge = newItem.y + newItem.h;
    let touchingWidgetBottom = false;

    for (const l of currentLayouts) {
      if (l.i === newItem.i) continue;
      const hasHorizontalOverlap = !(l.x >= newItem.x + newItem.w || l.x + l.w <= newItem.x);
      if (!hasHorizontalOverlap) continue;

      const isAdjacent = l.y === newBottomEdge;
      const wouldOverlap = l.y < newBottomEdge && l.y + l.h > newItem.y;

      if (isAdjacent || wouldOverlap) {
        touchingWidgetBottom = true;
        break;
      }
    }

    console.log('[DEBUG] handleResize entry:', {
      newItem: { i: newItem.i, x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h },
      oldItem: { i: oldItem.i, x: oldItem.x, y: oldItem.y, w: oldItem.w, h: oldItem.h },
      originalLayout: originalLayout ? { maxW: originalLayout.maxW, maxH: originalLayout.maxH, w: originalLayout.w, h: originalLayout.h } : null,
      isAtMaxWBoundary,
      isAtMaxHBoundary,
      touchingWidgetRight,
      rightWidgetId,
      touchingWidgetBottom,
      currentLayoutsCount: currentLayouts.length,
    });

    const isEnlarging =
      newItem.w > oldItem.w ||
      newItem.h > oldItem.h ||
      newItem.x < oldItem.x ||
      newItem.y < oldItem.y ||
      isAtMaxWBoundary ||
      isAtMaxHBoundary;

    // Also trigger push logic if we're touching a widget and trying to enlarge
    const shouldTryPush = isEnlarging ||
      (touchingWidgetRight && newItem.w >= oldItem.w) ||
      (touchingWidgetBottom && newItem.h >= oldItem.h);

    console.log('[DEBUG] isEnlarging:', isEnlarging, 'shouldTryPush:', shouldTryPush);

    if (shouldTryPush) {
      // If newItem.w equals maxW, the user might be trying to resize further
      // but react-grid-layout is blocking it. In this case, we should try to push
      // with w + 1 to trigger the push behavior
      let requestedW = newItem.w;
      let requestedH = newItem.h;

      // Use the last pushed layout if available for incremental pushing
      const layoutsForCalculation = lastPushedLayoutRef.current || baseLayouts;

      // Check if we're at the maxW boundary OR touching a widget and trying to resize right
      // IMPORTANT: Only consider horizontal push if the resize direction includes east ('e')
      // Don't trigger horizontal push for pure south ('s') or north ('n') resizes
      const direction = resizeDirectionRef.current;
      const isResizingEast = direction?.includes('e') ?? false;
      const isResizingSouth = direction?.includes('s') ?? false;

      const shouldPushRight = isResizingEast && (isAtMaxWBoundary || (touchingWidgetRight && newItem.w >= oldItem.w && newItem.x === oldItem.x));
      const shouldPushDown = isResizingSouth && (isAtMaxHBoundary || (touchingWidgetBottom && newItem.h >= oldItem.h && newItem.y === oldItem.y));

      if (shouldPushRight) {
        // User is trying to resize beyond current boundary
        // Calculate based on where dependent widgets have been pushed to
        if (lastPushedLayoutRef.current) {
          // Find where the resizing widget was in the last push
          const lastResizingLayout = lastPushedLayoutRef.current.find(l => l.i === newItem.i);
          if (lastResizingLayout) {
            // Request one more than the last pushed width
            requestedW = lastResizingLayout.w + 1;
          }
        } else {
          // First push - request one more column
          requestedW = newItem.w + 1;
        }
        console.log('[DEBUG] Pushing right, requesting w:', requestedW);
      }

      if (shouldPushDown) {
        if (lastPushedLayoutRef.current) {
          const lastResizingLayout = lastPushedLayoutRef.current.find(l => l.i === newItem.i);
          if (lastResizingLayout) {
            requestedH = lastResizingLayout.h + 1;
          }
        } else {
          requestedH = newItem.h + 1;
        }
        console.log('[DEBUG] Pushing down, requesting h:', requestedH);
      }

      console.log('[DEBUG] handleResize - newItem:', { i: newItem.i, x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h });
      console.log('[DEBUG] handleResize - oldItem:', { i: oldItem.i, x: oldItem.x, y: oldItem.y, w: oldItem.w, h: oldItem.h });
      console.log('[DEBUG] handleResize - requested:', { w: requestedW, h: requestedH });

      const result = calculateResizeSpace(
        layoutsForCalculation,
        newItem.i,
        newItem.x,
        newItem.y,
        requestedW,
        requestedH,
        GRID_CONFIG.cols,
        maxRows,
        widgetMinSizes
      );

      console.log('[DEBUG] handleResize - result:', {
        canResize: result.canResize,
        movedWidgets: result.movedWidgets,
        shrunkWidgets: result.shrunkWidgets,
        newLayoutsCount: result.newLayouts.length
      });

      if (result.canResize) {
        // Check if the resize actually changed anything compared to current state
        const resizingLayout = result.newLayouts.find(l => l.i === newItem.i);
        const currentResizingLayout = lastPushedLayoutRef.current?.find(l => l.i === newItem.i) || baseLayouts.find(l => l.i === newItem.i);

        const hasChanges = result.movedWidgets.length > 0 ||
                           result.shrunkWidgets.length > 0 ||
                           (resizingLayout && currentResizingLayout &&
                            (resizingLayout.w !== currentResizingLayout.w || resizingLayout.h !== currentResizingLayout.h));

        console.log('[DEBUG] hasChanges check:', {
          hasChanges,
          movedWidgetsLength: result.movedWidgets.length,
          shrunkWidgetsLength: result.shrunkWidgets.length,
          resizingLayout: resizingLayout ? { w: resizingLayout.w, h: resizingLayout.h } : null,
          currentResizingLayout: currentResizingLayout ? { w: currentResizingLayout.w, h: currentResizingLayout.h } : null,
        });

        if (hasChanges) {
          // Store the preview for handleResizeStop to apply
          setResizePreview({
            newLayouts: result.newLayouts,
            movedWidgets: result.movedWidgets,
            shrunkWidgets: result.shrunkWidgets,
          });

          // Save the pushed layout for incremental pushing on next resize event
          lastPushedLayoutRef.current = result.newLayouts.map(l => ({ ...l }));

          // Directly manipulate DOM for smooth visual feedback during resize
          // This bypasses React state updates which can be slow and conflict with react-grid-layout

          // Move all widgets that have changed position (not just movedWidgets)
          for (const layout of result.newLayouts) {
            if (layout.i === newItem.i) continue; // Handle resizing widget separately
            const baseLayout = baseLayouts.find(l => l.i === layout.i);
            if (baseLayout && (layout.x !== baseLayout.x || layout.y !== baseLayout.y)) {
              console.log('[DEBUG] Moving widget DOM:', layout.i, 'to', { x: layout.x, y: layout.y });
              moveWidgetDom(layout.i, layout.x, layout.y);
            }
          }

          // Also resize the resizing widget's DOM to fill the space created by pushing
          if (resizingLayout) {
            console.log('[DEBUG] Resizing widget DOM:', newItem.i, 'to', { w: resizingLayout.w, h: resizingLayout.h });
            resizeWidgetDom(newItem.i, resizingLayout.w, resizingLayout.h);
          }
        }
      } else {
        setResizePreview(null);
      }
    } else {
      // Feature 7: Shrinking - no preview needed, empty space will be preserved
      setResizePreview(null);
    }
    } catch (error) {
      console.error('[DEBUG] handleResize error:', error);
    }
  }, [maxRows, getWidgetMinSizes, moveWidgetDom, resizeWidgetDom]);

  // Feature 4: Track mouse position during drag for swap detection
  useEffect(() => {
    if (!isDraggingWidget || !draggingWidgetRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const gridPos = getGridPositionFromMouse(e.clientX, e.clientY);
      if (!gridPos || !draggingWidgetRef.current || !dragStartLayoutRef.current) return;

      const { id: dragId } = draggingWidgetRef.current;
      const sourceLayout = dragStartLayoutRef.current;

      // Check if mouse is over another widget (not the source widget's original position)
      const targetWidget = getWidgetAtPosition(layouts, gridPos.x, gridPos.y, dragId);

      // Show swap preview when hovering over another widget
      // This allows swapping even when empty space exists (user can choose to swap instead)
      if (targetWidget) {
        const newSwapPreview: SwapPreview = {
          sourceId: dragId,
          targetId: targetWidget.i,
          sourceNewPos: { x: targetWidget.x, y: targetWidget.y, w: targetWidget.w, h: targetWidget.h },
          targetNewPos: { x: sourceLayout.x, y: sourceLayout.y, w: sourceLayout.w, h: sourceLayout.h },
        };
        swapPreviewRef.current = newSwapPreview;
        setSwapPreview(newSwapPreview);
      } else {
        swapPreviewRef.current = null;
        setSwapPreview(null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isDraggingWidget, layouts, getGridPositionFromMouse]);

  // Handle drag start
  const handleDragStart = useCallback((_layout: GridItemLayout[], oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isDraggingRef.current = true;
    lastValidLayoutRef.current = layouts.map(l => ({ ...l }));

    // Feature 4: Store original layout for swap detection
    dragStartLayoutRef.current = { ...oldItem };

    // Calculate available zones for this widget
    draggingWidgetRef.current = { id: oldItem.i, w: oldItem.w, h: oldItem.h };
    const zones = calculateAvailableZones(oldItem.w, oldItem.h, oldItem.i);
    setAvailableZones(zones);
    setIsDraggingWidget(true);
  }, [layouts, calculateAvailableZones]);

  // Handle drag stop - check if layout is valid, handle swap, or revert
  const handleDragStop = useCallback((newLayout: GridItemLayout[], _oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isDraggingRef.current = false;
    // Clear available zones and swap preview
    setAvailableZones([]);
    setIsDraggingWidget(false);
    const cols = GRID_CONFIG.cols;

    // Feature 4: Check if this is a swap operation (use ref to get latest value)
    const currentSwapPreview = swapPreviewRef.current;
    if (currentSwapPreview && dragStartLayoutRef.current) {
      // Pass cols and maxRows to enable size preservation when space allows
      const swappedLayouts = calculateSwap(layouts, currentSwapPreview.sourceId, currentSwapPreview.targetId, cols, maxRows);
      if (swappedLayouts) {
        // Apply swapped layouts with min/max dimensions
        const maxDimensions = calculateMaxDimensions(swappedLayouts);
        const validLayout = swappedLayouts.map(item => {
          const widget = widgets.find(w => w.i === item.i);
          const sizes = widget ? DEFAULT_WIDGET_SIZES[widget.type] : DEFAULT_WIDGET_SIZES.chart;
          const dimensions = maxDimensions.get(item.i) ?? { maxH: maxRows - item.y, maxW: cols - item.x };
          return {
            ...item,
            minW: sizes.minW,
            minH: sizes.minH,
            maxH: dimensions.maxH,
            maxW: dimensions.maxW,
          };
        });
        lastValidLayoutRef.current = validLayout;
        updateLayouts(validLayout);
        swapPreviewRef.current = null;
        setSwapPreview(null);
        dragStartLayoutRef.current = null;
        draggingWidgetRef.current = null;
        return;
      }
    }

    // Clear swap state
    swapPreviewRef.current = null;
    setSwapPreview(null);
    dragStartLayoutRef.current = null;
    draggingWidgetRef.current = null;

    // Check if any widget is outside viewport (vertical or horizontal)
    const isInvalid = newLayout.some(item =>
      item.y + item.h > maxRows || item.x + item.w > cols
    );

    if (isInvalid) {
      // Revert to last valid layout
      updateLayouts(lastValidLayoutRef.current);
    } else {
      // Calculate maxH and maxW for the new layout
      const maxDimensions = calculateMaxDimensions(newLayout);

      // Update the last valid layout ref
      const validLayout = newLayout.map(item => {
        const existingLayout = layouts.find(l => l.i === item.i);
        const dimensions = maxDimensions.get(item.i) ?? { maxH: maxRows - item.y, maxW: cols - item.x };
        return {
          ...item,
          minW: existingLayout?.minW ?? item.minW,
          minH: existingLayout?.minH ?? item.minH,
          maxH: dimensions.maxH,
          maxW: dimensions.maxW,
        };
      });
      lastValidLayoutRef.current = validLayout;
      updateLayouts(validLayout);
    }
  }, [layouts, widgets, maxRows, updateLayouts, calculateMaxDimensions]);

  // Dropping item placeholder
  const droppingItem = {
    i: '__dropping-elem__',
    x: 0,
    y: 0,
    w: DEFAULT_WIDGET_SIZES.chart.w,
    h: DEFAULT_WIDGET_SIZES.chart.h,
  };

  // Calculate pixel position for a grid zone
  const getZoneStyle = useCallback((zone: { x: number; y: number; w: number; h: number }) => {
    if (containerWidth === 0) return null;

    const colWidth = (containerWidth - GRID_CONFIG.containerPadding[0] * 2 - GRID_CONFIG.margin[0] * (GRID_CONFIG.cols - 1)) / GRID_CONFIG.cols;
    const x = GRID_CONFIG.containerPadding[0] + zone.x * (colWidth + GRID_CONFIG.margin[0]);
    const y = GRID_CONFIG.containerPadding[1] + zone.y * (GRID_CONFIG.rowHeight + GRID_CONFIG.margin[1]);
    const width = zone.w * colWidth + (zone.w - 1) * GRID_CONFIG.margin[0];
    const height = zone.h * GRID_CONFIG.rowHeight + (zone.h - 1) * GRID_CONFIG.margin[1];

    return {
      left: x,
      top: y,
      width,
      height,
    };
  }, [containerWidth]);

  // Calculate preview widget position in pixels
  const getPreviewStyle = () => {
    if (!previewWidget || containerWidth === 0) return null;
    return getZoneStyle(previewWidget);
  };

  const previewStyle = getPreviewStyle();

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden transition-all duration-300 relative"
      style={{
        height: '100%',
        backgroundColor: '#ffffff',
        backgroundImage: `
          linear-gradient(to right, #f1f1f1 1px, transparent 1px),
          linear-gradient(to bottom, #f1f1f1 1px, transparent 1px)
        `,
        backgroundSize: '25px 25px',
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Feature 1: Enhanced preview placeholder for widget panel hover or external drag */}
      {previewStyle && !isDraggingWidget && (
        <div
          className="absolute pointer-events-none z-50 border-2 border-dashed border-emerald-400 bg-emerald-500/15 rounded-xl flex items-center justify-center transition-all duration-200 animate-pulse shadow-lg shadow-emerald-500/20"
          style={previewStyle}
        >
          <div className="text-center">
            <div className="text-emerald-600 text-sm font-semibold">{previewWidget?.title}</div>
            <div className="text-emerald-500/70 text-xs mt-1!">{isExternalDrag ? 'Drop to add here' : 'Click to add here'}</div>
          </div>
        </div>
      )}

      {/* Feature 3: Available drop zones during internal widget drag */}
      {isDraggingWidget && !isExternalDrag && !swapPreview && availableZones.map((zone, index) => {
        const zoneStyle = getZoneStyle(zone);
        if (!zoneStyle) return null;
        return (
          <div
            key={`zone-${index}`}
            className="absolute pointer-events-none z-40 border-2 border-dashed border-emerald-300 bg-emerald-100/50 rounded-xl"
            style={zoneStyle}
          />
        );
      })}

      {/* Feature 4: Swap preview during drag when no empty space available */}
      {swapPreview && (
        <>
          {/* Source widget's new position (where it will go) */}
          <div
            className="absolute pointer-events-none z-50 border-2 border-solid border-violet-400 bg-violet-100/50 rounded-xl flex items-center justify-center animate-pulse"
            style={getZoneStyle(swapPreview.sourceNewPos) || undefined}
          >
            <span className="text-violet-600 text-sm font-medium">Swap here</span>
          </div>
          {/* Target widget's new position (where it will move to) */}
          <div
            className="absolute pointer-events-none z-50 border-2 border-solid border-amber-400 bg-amber-100/50 rounded-xl flex items-center justify-center animate-pulse"
            style={getZoneStyle(swapPreview.targetNewPos) || undefined}
          >
            <span className="text-amber-600 text-sm font-medium">Moving here</span>
          </div>
        </>
      )}

      {/* Feature 6: Resize space management preview */}
      {resizePreview && resizePreview.newLayouts.map(layout => {
        const originalLayout = layouts.find(l => l.i === layout.i);
        // Only show preview for widgets that will move or change size
        if (!originalLayout) return null;
        const hasMoved = layout.x !== originalLayout.x || layout.y !== originalLayout.y;
        const hasResized = layout.w !== originalLayout.w || layout.h !== originalLayout.h;
        if (!hasMoved && !hasResized) return null;

        const isMoved = resizePreview.movedWidgets.includes(layout.i);
        const isShrunk = resizePreview.shrunkWidgets.includes(layout.i);

        return (
          <div
            key={`resize-preview-${layout.i}`}
            className={`absolute pointer-events-none z-45 border-2 border-dashed rounded-xl ${
              isMoved
                ? 'border-amber-400 bg-amber-100/40'
                : isShrunk
                  ? 'border-rose-400 bg-rose-100/40'
                  : 'border-slate-300 bg-slate-100/40'
            }`}
            style={getZoneStyle(layout) || undefined}
          />
        );
      })}

      {containerWidth > 0 && (
        <div style={{ height: containerHeight, width: '100%' }}>
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
            onResize={handleResize}
            onResizeStop={handleResizeStop}
            onDragStart={handleDragStart}
            onDragStop={handleDragStop}
            isDroppable={false}
            droppingItem={droppingItem}
            draggableHandle=".widget-drag-handle"
            resizeHandles={['se', 'e', 's', 'n', 'w', 'ne', 'nw', 'sw']}
            useCSSTransforms={true}
            compactType={null}
            preventCollision={true}
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

              const isNewlyAdded = widget.i === newlyAddedWidgetId;

              return (
                <div key={widget.i}>
                  <WidgetWrapper
                    title={widget.title}
                    onClose={() => removeWidget(widget.i)}
                    onToggleMaximize={() => toggleMaximizeWidget(widget.i)}
                    isMaximized={maximizedWidgetId === widget.i}
                    isHighlighted={isNewlyAdded}
                  >
                    <WidgetComponent {...widget.props} />
                  </WidgetWrapper>
                </div>
              );
            })}
          </RGL>
        </div>
      )}

      {/* Maximized widget overlay */}
      {maximizedWidgetId && (() => {
        const maximizedWidget = widgets.find(w => w.i === maximizedWidgetId);
        if (!maximizedWidget) return null;
        const WidgetComponent = WidgetRegistry[maximizedWidget.type as keyof typeof WidgetRegistry];
        if (!WidgetComponent) return null;

        return (
          <div className="absolute inset-2.5 z-50">
            <WidgetWrapper
              title={maximizedWidget.title}
              onClose={() => removeWidget(maximizedWidget.i)}
              onToggleMaximize={() => toggleMaximizeWidget(maximizedWidget.i)}
              isMaximized={true}
              isHighlighted={false}
            >
              <WidgetComponent {...maximizedWidget.props} />
            </WidgetWrapper>
          </div>
        );
      })()}
    </div>
  );
};
