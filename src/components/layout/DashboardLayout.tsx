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
  // Key to force RGL re-mount when swap fails (resets RGL's internal transform state)
  const [rglKey, setRglKey] = useState(0);
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
  const rowHeight = GRID_CONFIG.rowHeight; // 25px
  const marginY = GRID_CONFIG.margin[1]; // 7px
  const rowUnitHeight = rowHeight + marginY; // 32px per row
  
  // Calculate max rows to fill container
  const availableForContent = containerHeight + marginY;
  const maxRows = Math.max(1, Math.floor(availableForContent / rowUnitHeight));

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
  // Track when swap was applied to ignore subsequent layout changes from react-grid-layout
  const lastSwapApplyTimeRef = useRef<number>(0);
  // Flag to completely block layout changes during swap revert
  const isRevertingSwapRef = useRef<boolean>(false);

  const handleLayoutChange = useCallback((newLayout: GridItemLayout[]) => {
    // CRITICAL: Block all layout changes during swap revert
    if (isRevertingSwapRef.current) {

      return;
    }

    // IMPORTANT: Skip layout change processing if we're in the middle of a resize
    // Our custom resize logic handles the layout changes directly
    // react-grid-layout's built-in collision detection can conflict with our push logic
    if (isResizingRef.current) {
      return;
    }

    // Skip if currently dragging - our handleDragStop will handle the final layout
    if (isDraggingRef.current) {
      return;
    }

    // Also skip if we just applied a resize preview (within last 500ms)
    // React-grid-layout fires onLayoutChange after our state update with its own calculated layout
    // which may have collision detection that moves widgets - we want to ignore this
    const timeSinceResizeApply = Date.now() - lastResizeApplyTimeRef.current;
    if (timeSinceResizeApply < 500) {

      return;
    }

    // Also skip if we just applied a swap (within last 500ms)
    // React-grid-layout fires onLayoutChange with its own calculated layout after our swap
    const timeSinceSwapApply = Date.now() - lastSwapApplyTimeRef.current;
    if (timeSinceSwapApply < 500) {

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

    // Get resize direction to enforce cross-direction constraints
    const direction = resizeDirectionRef.current;
    const isHorizontalOnly = direction === 'e' || direction === 'w';
    const isVerticalOnly = direction === 's' || direction === 'n';

    // Feature 6: Apply resize space management if preview is active
    if (resizePreview && resizePreview.newLayouts.length > 0) {
      resizeLogger.log('APPLYING PREVIEW', {
        layouts: resizePreview.newLayouts.map(l => `${l.i.slice(-8)}: x=${l.x}, y=${l.y}, w=${l.w}, h=${l.h}`)
      });
      resizeLogger.endSession();

      // CRITICAL: For single-direction resize, enforce NO cross-direction movement
      let constrainedLayouts = resizePreview.newLayouts;

      if (isHorizontalOnly) {
        // For horizontal-only resize, preserve Y positions from resizeStartLayout
        constrainedLayouts = resizePreview.newLayouts.map(layout => {
          const originalLayout = resizeStartLayoutRef.current.find(l => l.i === layout.i);
          if (originalLayout) {
            return { ...layout, y: originalLayout.y, h: originalLayout.h };
          }
          return layout;
        });
      } else if (isVerticalOnly) {
        // For vertical-only resize, preserve X positions from resizeStartLayout
        constrainedLayouts = resizePreview.newLayouts.map(layout => {
          const originalLayout = resizeStartLayoutRef.current.find(l => l.i === layout.i);
          if (originalLayout) {
            return { ...layout, x: originalLayout.x, w: originalLayout.w };
          }
          return layout;
        });
      }

      // Final validation: ensure no widget is outside viewport before applying
      const hasInvalidPosition = constrainedLayouts.some(layout =>
        layout.x < 0 ||
        layout.x + layout.w > cols ||
        layout.y < 0 ||
        layout.y + layout.h > maxRows
      );

      if (hasInvalidPosition) {

        updateLayouts(lastValidLayoutRef.current);
        setResizePreview(null);
        isResizingRef.current = false;
        resizeDirectionRef.current = null;
        return;
      }

      const maxDimensions = calculateMaxDimensions(constrainedLayouts);
      const validLayout = constrainedLayouts.map(item => {
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
      resizeDirectionRef.current = null;
      return;
    }

    // Reset isResizing flag
    isResizingRef.current = false;
    resizeDirectionRef.current = null;

    setResizePreview(null);

    // Feature 2: Enforce minimum dimensions
    let validatedLayout = newLayout.map(item => {
      const widget = widgets.find(w => w.i === item.i);
      const widgetType = widget?.type || 'chart';
      const minSizes = DEFAULT_WIDGET_SIZES[widgetType];
      return {
        ...item,
        w: Math.max(item.w, minSizes.minW),
        h: Math.max(item.h, minSizes.minH),
      };
    });

    // CRITICAL: For single-direction resize without preview, enforce NO cross-direction movement
    if (isHorizontalOnly) {
      validatedLayout = validatedLayout.map(item => {
        const originalLayout = resizeStartLayoutRef.current.find(l => l.i === item.i);
        if (originalLayout) {
          return { ...item, y: originalLayout.y, h: originalLayout.h };
        }
        return item;
      });
    } else if (isVerticalOnly) {
      validatedLayout = validatedLayout.map(item => {
        const originalLayout = resizeStartLayoutRef.current.find(l => l.i === item.i);
        if (originalLayout) {
          return { ...item, x: originalLayout.x, w: originalLayout.w };
        }
        return item;
      });
    }

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

      // For corner resizes, handle BOTH directions simultaneously for real-time resize
      const handleHorizontal = isHorizontalResize;
      const handleVertical = isVerticalResize;

      // Calculate grid deltas
      const gridDeltaX = Math.round(mouseDeltaX / cellWidth);
      const gridDeltaY = Math.round(mouseDeltaY / cellHeight);

      // HORIZONTAL RESIZE HANDLING (east/west) - GAP FILL FIRST, THEN PUSH
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

        // Expanding - GAP FILL FIRST, THEN PUSH widgets until they hit viewport edge
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

        // Get all other widgets
        const allWidgets = baseLayouts
          .filter(l => l.i !== resizingWidgetIdRef.current)
          .map(l => ({ id: l.i, x: l.x, w: l.w, y: l.y, h: l.h }));

        // Find widgets that have vertical overlap with resizing widget (direct collision targets)
        const widgetsWithDirectOverlap = allWidgets.filter(w => hasVerticalOverlap(w));

        // Find the FIRST widget in the resize direction that has DIRECT vertical overlap
        let gapToFirstWidget = 0;
        let firstWidgetEdge = isEastResize ? GRID_CONFIG.cols : 0;

        if (isEastResize) {
          // Find widgets to the RIGHT of resizing widget with direct overlap
          const widgetsToRight = widgetsWithDirectOverlap.filter(w => w.x >= originalRightEdge);

          if (widgetsToRight.length > 0) {
            widgetsToRight.sort((a, b) => a.x - b.x);
            firstWidgetEdge = widgetsToRight[0].x;
            gapToFirstWidget = firstWidgetEdge - originalRightEdge;

          } else {
            gapToFirstWidget = GRID_CONFIG.cols - originalRightEdge;

          }
        } else {
          // West resize
          const widgetsToLeft = widgetsWithDirectOverlap.filter(w => w.x + w.w <= originalLeftEdge);

          if (widgetsToLeft.length > 0) {
            widgetsToLeft.sort((a, b) => (b.x + b.w) - (a.x + a.w));
            firstWidgetEdge = widgetsToLeft[0].x + widgetsToLeft[0].w;
            gapToFirstWidget = originalLeftEdge - firstWidgetEdge;

          } else {
            gapToFirstWidget = originalLeftEdge;

          }
        }

        // Calculate how much of the expansion goes into the gap vs pushing
        const expansion = requestedW - resizingLayout.w;
        const gapFill = Math.min(expansion, gapToFirstWidget);
        const pushAmount = Math.max(0, expansion - gapToFirstWidget);

        // NEW LOGIC: Push ALL widgets that are in the resize direction
        // Each widget that has vertical overlap with resizing widget gets pushed,
        // AND each widget that has vertical overlap with ANY pushed widget also gets pushed (chain)

        let widgetsToPush: Array<{ id: string; x: number; w: number; y: number; h: number }> = [];

        if (isEastResize) {
          // Get ALL widgets to the right of resizing widget
          const widgetsToRight = allWidgets
            .filter(w => w.x >= originalRightEdge)
            .sort((a, b) => a.x - b.x);

          // CRITICAL FIX: For HORIZONTAL-ONLY resize, we should only push widgets
          // that have vertical overlap with the RESIZING WIDGET (not with chain widgets).
          const widgetsWithOverlap = widgetsToRight.filter(w => hasVerticalOverlap(w));

          // For horizontal-only resize, ALL widgets with vertical overlap are in the chain
          widgetsToPush = widgetsWithOverlap.sort((a, b) => a.x - b.x);

        } else {
          // West resize - similar logic to East resize
          // CRITICAL FIX: For HORIZONTAL-ONLY resize, only push widgets
          // that have vertical overlap with the RESIZING WIDGET (not with chain widgets).
          const widgetsToLeft = allWidgets
            .filter(w => w.x + w.w <= originalLeftEdge)
            .sort((a, b) => b.x - a.x);

          // Only include widgets that have vertical overlap with the resizing widget
          const widgetsWithOverlap = widgetsToLeft.filter(w => hasVerticalOverlap(w));


          // For horizontal-only resize, ALL widgets with vertical overlap are in the chain
          widgetsToPush = widgetsWithOverlap.sort((a, b) => b.x - a.x);

        }


        // Find widgets NOT in the chain
        const chainIds = new Set(widgetsToPush.map(w => w.id));
        const nonChainWidgets = allWidgets.filter(w => !chainIds.has(w.id));

        // Calculate available space for pushing
        // NEW APPROACH: Each widget calculates its OWN available space independently.
        // Widgets that have gaps can move into their gaps.
        // The overall expansion is limited only by the widget with LEAST total movable space
        // (considering both its gap and the space beyond it).
        //
        // For each widget:
        //   - Gap before it (from resizing widget or previous widget)
        //   - Space after it (to viewport or next blocking widget)
        //
        // Total available = minimum of (each widget's gap + space after it)
        let availablePushSpace = 0;

        if (widgetsToPush.length > 0) {
          if (isEastResize) {
            // CRITICAL: For widgets that form a CASCADE CHAIN (have vertical overlap with each other),
            // the available space is determined by the RIGHTMOST widget's space to viewport.
            // Gaps between widgets in a chain don't add to available space - they just delay when
            // the next widget starts moving.
            //
            // For widgets that DON'T have vertical overlap with each other, they move independently.

            // Step 1: Group widgets into cascade chains based on vertical overlap
            const chains: Array<Array<typeof widgetsToPush[0]>> = [];
            const assigned = new Set<string>();

            for (const widget of widgetsToPush) {
              if (assigned.has(widget.id)) continue;

              const chain = [widget];
              assigned.add(widget.id);

              // BFS to find all widgets that cascade with this one
              let i = 0;
              while (i < chain.length) {
                const current = chain[i];
                for (const other of widgetsToPush) {
                  if (assigned.has(other.id)) continue;
                  const hasOverlap = !(current.y + current.h <= other.y || current.y >= other.y + other.h);
                  if (hasOverlap) {
                    chain.push(other);
                    assigned.add(other.id);
                  }
                }
                i++;
              }

              chains.push(chain);
            }

            // Step 2: For each chain, calculate available space
            // CRITICAL FIX: Each widget in the chain has its OWN available space
            // based on what specifically blocks IT (not what blocks the chain as a whole)
            // A widget is blocked only by widgets that have VERTICAL OVERLAP WITH IT specifically
            const chainSpaces: number[] = [];

            for (let ci = 0; ci < chains.length; ci++) {
              const chain = chains[ci];

              // Sort chain by x position
              chain.sort((a, b) => a.x - b.x);

              // Calculate available space for EACH widget in the chain INDEPENDENTLY
              // The chain's space is the minimum of all individual widget spaces
              const widgetSpaces: number[] = [];

              for (const widget of chain) {
                const widgetRightEdge = widget.x + widget.w;

                // Find what blocks THIS specific widget (not the whole chain)
                // A blocker must: be to the right AND have vertical overlap with THIS widget
                let blockingEdgeForWidget = GRID_CONFIG.cols;
                for (const other of allWidgets) {
                  if (other.id === widget.id) continue;
                  if (chain.some(w => w.id === other.id)) continue; // Skip chain widgets
                  if (other.x <= widgetRightEdge) continue; // Must be to the right

                  // Check vertical overlap with THIS SPECIFIC widget only
                  const hasOverlapWithThisWidget = !(widget.y + widget.h <= other.y || widget.y >= other.y + other.h);
                  if (hasOverlapWithThisWidget && other.x < blockingEdgeForWidget) {
                    blockingEdgeForWidget = other.x;

                  }
                }

                const spaceForWidget = blockingEdgeForWidget - widgetRightEdge;
                // Gap from resizing widget to this widget
                const gapFromResizing = widget.x - originalRightEdge;
                const totalSpaceForWidget = gapFromResizing + spaceForWidget;

                widgetSpaces.push(totalSpaceForWidget);

              }

              // Chain space is minimum of all widget spaces in this chain
              const chainSpace = Math.min(...widgetSpaces);
              chainSpaces.push(chainSpace);

            }

            // Minimum across all chains
            availablePushSpace = Math.min(...chainSpaces);

          } else {
            // West resize - similar logic but reversed
            const chains: Array<Array<typeof widgetsToPush[0]>> = [];
            const assigned = new Set<string>();

            for (const widget of widgetsToPush) {
              if (assigned.has(widget.id)) continue;

              const chain = [widget];
              assigned.add(widget.id);

              let i = 0;
              while (i < chain.length) {
                const current = chain[i];
                for (const other of widgetsToPush) {
                  if (assigned.has(other.id)) continue;
                  const hasOverlap = !(current.y + current.h <= other.y || current.y >= other.y + other.h);
                  if (hasOverlap) {
                    chain.push(other);
                    assigned.add(other.id);
                  }
                }
                i++;
              }

              chains.push(chain);
            }

            const chainSpaces: number[] = [];

            for (let ci = 0; ci < chains.length; ci++) {
              const chain = chains[ci];
              chain.sort((a, b) => a.x - b.x); // Sort left to right

              // Calculate available space for EACH widget in the chain INDEPENDENTLY
              const widgetSpaces: number[] = [];

              for (const widget of chain) {
                // Find what blocks THIS specific widget to its LEFT
                let blockingEdgeForWidget = 0;
                for (const other of allWidgets) {
                  if (other.id === widget.id) continue;
                  if (chain.some(w => w.id === other.id)) continue;
                  if (other.x + other.w >= widget.x) continue; // Must be to the left

                  // Check vertical overlap with THIS SPECIFIC widget only
                  const hasOverlapWithThisWidget = !(widget.y + widget.h <= other.y || widget.y >= other.y + other.h);
                  if (hasOverlapWithThisWidget && other.x + other.w > blockingEdgeForWidget) {
                    blockingEdgeForWidget = other.x + other.w;

                  }
                }

                const spaceForWidget = widget.x - blockingEdgeForWidget;
                // Gap from this widget to resizing widget
                const gapToResizing = originalLeftEdge - (widget.x + widget.w);
                const totalSpaceForWidget = gapToResizing + spaceForWidget;

                widgetSpaces.push(totalSpaceForWidget);

              }

              const chainSpace = Math.min(...widgetSpaces);
              chainSpaces.push(chainSpace);

            }

            availablePushSpace = Math.min(...chainSpaces);
          }
        }

        // Calculate actual push (limited by available space)
        let actualPush = Math.min(pushAmount, availablePushSpace);
        let totalExpansion = gapFill + actualPush;

        // Calculate final dimensions
        let finalW = Math.max(minW, resizingLayout.w + totalExpansion);
        let finalX = isWestResize
          ? resizingLayout.x + resizingLayout.w - finalW
          : resizingLayout.x;

        // CRITICAL: Dynamic blocking check
        // Before allowing resize, verify that ALL widgets that need to move CAN actually move.
        // A widget is BLOCKED if:
        // 1. It can't move horizontally (would go outside viewport)
        // 2. For HORIZONTAL-ONLY resize, widgets should NEVER move vertically
        //
        // If ANY widget is blocked, limit the resize to the maximum allowed before blocking.
        if (actualPush > 0 && widgetsToPush.length > 0) {

          // Sort widgets for cascade simulation
          const sortedForSim = [...widgetsToPush].sort((a, b) => isEastResize ? a.x - b.x : b.x - a.x);

          // Calculate the maximum expansion that doesn't cause any widget to go outside viewport
          let maxAllowedExpansion = gapFill + actualPush; // Start with requested expansion

          // Simulate cascade for the FULL requested expansion
          const simulateExpansion = (expansion: number): { valid: boolean; positions: Map<string, number> } => {
            const positions = new Map<string, number>();
            const simFinalW = Math.max(minW, resizingLayout.w + expansion);
            const simResizingRightEdge = isEastResize ? resizingLayout.x + simFinalW : resizingLayout.x;
            const simResizingLeftEdge = isWestResize ? resizingLayout.x + resizingLayout.w - simFinalW : resizingLayout.x;

            // For each widget, calculate where it would end up
            for (const widget of sortedForSim) {
              let pushForWidget = 0;

              // Check if directly touched by resizing widget
              if (isEastResize) {
                if (simResizingRightEdge > widget.x && hasVerticalOverlap(widget)) {
                  pushForWidget = simResizingRightEdge - widget.x;
                }
              } else {
                const widgetRight = widget.x + widget.w;
                if (simResizingLeftEdge < widgetRight && hasVerticalOverlap(widget)) {
                  pushForWidget = widgetRight - simResizingLeftEdge;
                }
              }

              // Check cascade from other widgets
              for (const [prevId, prevNewX] of positions.entries()) {
                const prevWidget = sortedForSim.find(w => w.id === prevId);
                if (!prevWidget) continue;

                // Check vertical overlap between prev and current
                const hasOverlapWithPrev = !(prevWidget.y + prevWidget.h <= widget.y || prevWidget.y >= widget.y + widget.h);
                if (!hasOverlapWithPrev) continue;

                if (isEastResize) {
                  const prevNewRight = prevNewX + prevWidget.w;
                  if (prevNewRight > widget.x) {
                    pushForWidget = Math.max(pushForWidget, prevNewRight - widget.x);
                  }
                } else {
                  if (prevNewX < widget.x + widget.w) {
                    pushForWidget = Math.max(pushForWidget, widget.x + widget.w - prevNewX);
                  }
                }
              }

              // Calculate new position
              let newX: number;
              if (isEastResize) {
                newX = widget.x + pushForWidget;
                // Check if widget goes outside viewport
                if (newX + widget.w > GRID_CONFIG.cols) {
                  return { valid: false, positions };
                }
              } else {
                newX = widget.x - pushForWidget;
                // Check if widget goes outside viewport
                if (newX < 0) {
                  return { valid: false, positions };
                }
              }

              positions.set(widget.id, newX);
            }

            // Also check if any pushed widget would overlap with non-chain widgets
            for (const [widgetId, newX] of positions.entries()) {
              const widget = sortedForSim.find(w => w.id === widgetId);
              if (!widget) continue;

              for (const nonChain of nonChainWidgets) {
                // Check horizontal overlap
                const pushedRight = newX + widget.w;
                const hasHorizOverlap = !(pushedRight <= nonChain.x || newX >= nonChain.x + nonChain.w);

                // Check vertical overlap
                const hasVertOverlap = !(widget.y + widget.h <= nonChain.y || widget.y >= nonChain.y + nonChain.h);

                if (hasHorizOverlap && hasVertOverlap) {
                  // Overlap detected - this expansion is invalid
                  return { valid: false, positions };
                }
              }
            }

            // IMPORTANT: Also check if resizing widget itself would overlap with non-chain widgets
            for (const nonChain of nonChainWidgets) {
              // Check horizontal overlap with resizing widget's new bounds
              const resizingLeft = isWestResize ? simResizingLeftEdge : resizingLayout.x;
              const resizingRight = isEastResize ? simResizingRightEdge : resizingLayout.x + resizingLayout.w;
              const hasHorizOverlap = !(resizingRight <= nonChain.x || resizingLeft >= nonChain.x + nonChain.w);

              // Check vertical overlap
              const hasVertOverlap = !(resizingLayout.y + resizingLayout.h <= nonChain.y || resizingLayout.y >= nonChain.y + nonChain.h);

              if (hasHorizOverlap && hasVertOverlap) {
                // Resizing widget would overlap with non-chain widget - invalid
                return { valid: false, positions };
              }
            }

            // CRITICAL: Check if any two CHAIN widgets would overlap with each other
            // This can happen when widgets at different Y positions are pushed to the same X
            const positionEntries = Array.from(positions.entries());
            for (let i = 0; i < positionEntries.length; i++) {
              const [id1, newX1] = positionEntries[i];
              const widget1 = sortedForSim.find(w => w.id === id1);
              if (!widget1) continue;

              for (let j = i + 1; j < positionEntries.length; j++) {
                const [id2, newX2] = positionEntries[j];
                const widget2 = sortedForSim.find(w => w.id === id2);
                if (!widget2) continue;

                // Check horizontal overlap between the two chain widgets
                const w1Left = newX1;
                const w1Right = newX1 + widget1.w;
                const w2Left = newX2;
                const w2Right = newX2 + widget2.w;
                const hasHorizOverlap = !(w1Right <= w2Left || w1Left >= w2Right);

                // Check vertical overlap
                const hasVertOverlap = !(widget1.y + widget1.h <= widget2.y || widget1.y >= widget2.y + widget2.h);

                if (hasHorizOverlap && hasVertOverlap) {
                  // Two chain widgets would overlap - invalid
                  return { valid: false, positions };
                }
              }
            }

            // Also check if resizing widget overlaps with any chain widget
            {
              const resizingLeft = isWestResize ? simResizingLeftEdge : resizingLayout.x;
              const resizingRight = isEastResize ? simResizingRightEdge : resizingLayout.x + resizingLayout.w;
              for (const [widgetId, newX] of positions.entries()) {
                const widget = sortedForSim.find(w => w.id === widgetId);
                if (!widget) continue;

                const wLeft = newX;
                const wRight = newX + widget.w;
                const hasHorizOverlap = !(resizingRight <= wLeft || resizingLeft >= wRight);
                const hasVertOverlap = !(resizingLayout.y + resizingLayout.h <= widget.y || resizingLayout.y >= widget.y + widget.h);

                if (hasHorizOverlap && hasVertOverlap) {
                  return { valid: false, positions };
                }
              }
            }

            return { valid: true, positions };
          };

          // Check if full expansion is valid
          let simResult = simulateExpansion(maxAllowedExpansion);
          let validatedPositions: Map<string, number> = simResult.positions;
          let validatedExpansion = maxAllowedExpansion;

          if (!simResult.valid) {
            // Binary search for the maximum valid expansion
            // Use finer precision (0.1) to not leave space unused
            let low = 0;
            let high = maxAllowedExpansion;
            let lastValidExpansion = 0;
            let lastValidPositions = new Map<string, number>();

            // First, do a coarse search
            while (high - low > 0.1) {
              const mid = (low + high) / 2;
              const midResult = simulateExpansion(mid);

              if (midResult.valid) {
                lastValidExpansion = mid;
                lastValidPositions = midResult.positions;
                low = mid;
              } else {
                high = mid;
              }
            }

            // Then check if we can use the floor of high (might be valid too)
            const floorHigh = Math.floor(high);
            if (floorHigh > lastValidExpansion) {
              const floorResult = simulateExpansion(floorHigh);
              if (floorResult.valid) {
                lastValidExpansion = floorHigh;
                lastValidPositions = floorResult.positions;
              }
            }

            // Use the valid expansion found
            validatedExpansion = lastValidExpansion;
            validatedPositions = lastValidPositions;

          }

          // Recalculate values based on validated expansion
          const newActualPush = Math.max(0, validatedExpansion - gapFill);
          const newTotalExpansion = validatedExpansion;
          const newFinalW = Math.max(minW, resizingLayout.w + newTotalExpansion);
          const newFinalX = isWestResize
            ? resizingLayout.x + resizingLayout.w - newFinalW
            : resizingLayout.x;

          // CRITICAL: ALWAYS use validated values - even when expansion is 0!
          // The fallback code should NEVER run when we have blocking checks.
          // Apply DOM updates and return early using the VALIDATED positions/values
          {

            // Apply DOM updates using validated positions
            resizeWidgetDom(resizingWidgetIdRef.current!, newFinalW, resizingLayout.h);
            if (isWestResize) {
              moveWidgetDom(resizingWidgetIdRef.current!, newFinalX, resizingLayout.y);
            }

            // Move pushed widgets using validated positions
            const movedWidgetIds: string[] = [];
            for (const [widgetId, newX] of validatedPositions.entries()) {
              const widget = baseLayouts.find(l => l.i === widgetId);
              if (widget && newX !== widget.x) {
                moveWidgetDom(widgetId, newX, widget.y);
                movedWidgetIds.push(widgetId);
              }
            }

            // Update preview with validated positions
            const newLayouts = baseLayouts.map(l => {
              if (l.i === resizingWidgetIdRef.current) {
                return { ...l, x: newFinalX, w: newFinalW, y: resizingLayout.y, h: resizingLayout.h };
              }
              const newX = validatedPositions.get(l.i);
              if (newX !== undefined) {
                return { ...l, x: newX, y: l.y, h: l.h };
              }
              return { ...l };
            });

            setResizePreview({ newLayouts, movedWidgets: movedWidgetIds, shrunkWidgets: [] });
            lastPushedLayoutRef.current = newLayouts;

            // Update the outer scope variables for consistency
            actualPush = newActualPush;
            totalExpansion = newTotalExpansion;
            finalW = newFinalW;
            finalX = newFinalX;

            return; // CRITICAL: Return early with validated positions
          }
        }

        // FALLBACK: Calculate new positions for pushed widgets (only used when no blocking check needed)
        // CASCADING LOGIC:
        // - Widget moves and fills its gap FIRST
        // - Only when widget's new right edge TOUCHES next widget, next widget starts moving
        // - Each widget absorbs push into its gap before passing remainder to next
        // - NON-CHAIN widgets that get touched by resizing widget also get pushed
        const newPositions: Map<string, number> = new Map();

        if (actualPush > 0) {
          if (isEastResize) {
            // Calculate resizing widget's new right edge
            const resizingNewRightEdge = resizingLayout.x + finalW;

            // Find ALL widgets that will be pushed - including non-chain widgets touched by resizing widget
            const allWidgetsToPush = [...widgetsToPush];

            // Check if any non-chain widget is touched by resizing widget's new right edge
            // IMPORTANT: Only consider widgets that are to the RIGHT of resizing widget's ORIGINAL right edge
            const originalRightEdgeForNonChain = resizingLayout.x + resizingLayout.w;
            for (const nonChain of nonChainWidgets) {
              // Only consider widgets to the RIGHT of resizing widget
              if (nonChain.x >= originalRightEdgeForNonChain) {
                // Check if resizing widget's new right edge touches this non-chain widget
                if (resizingNewRightEdge > nonChain.x) {
                  // Check vertical overlap with resizing widget
                  if (hasVerticalOverlap(nonChain)) {
                    // This non-chain widget is touched - add to push list
                    if (!allWidgetsToPush.some(w => w.id === nonChain.id)) {

                      allWidgetsToPush.push(nonChain);
                    }
                  }
                }
              }
            }

            // Sort widgets left to right for cascading calculation
            // Use a mutable array so we can add more widgets during processing
            const sortedWidgets = allWidgetsToPush.sort((a, b) => a.x - b.x);
            const processedWidgetIds = new Set<string>();

            // Process widgets from left to right
            // Each widget moves, but next widget only moves if previous widget TOUCHES it
            // IMPORTANT: We dynamically add non-chain widgets when they're touched by ANY pushed widget
            let i = 0;
            while (i < sortedWidgets.length) {
              const w = sortedWidgets[i];

              // Skip if already processed
              if (processedWidgetIds.has(w.id)) {
                i++;
                continue;
              }
              processedWidgetIds.add(w.id);

              // How much does this widget need to move?
              let pushForThisWidget: number;

              // For HORIZONTAL-ONLY resize, each widget in the chain is pushed based on:
              // 1. Direct touch by the resizing widget (resizing widget's new right edge > widget's x)
              // 2. Chain cascade from OTHER widgets that have vertical overlap WITH THIS widget
              //
              // IMPORTANT: Widgets that don't have vertical overlap with each other
              // should NOT cascade into each other - they should each be pushed
              // independently based on whether they're touched by the resizing widget
              // or by another widget that DOES have vertical overlap with them.

              // First check: Is this widget directly touched by the resizing widget?
              const touchedByResizing = resizingNewRightEdge > w.x && hasVerticalOverlap(w);

              if (touchedByResizing) {
                // Directly pushed by resizing widget
                pushForThisWidget = resizingNewRightEdge - w.x;

              } else {
                // Second check: Is this widget touched by another pushed widget
                // that has vertical overlap WITH THIS WIDGET?
                let maxPushFromPrev = 0;
                for (const prevId of processedWidgetIds) {
                  if (prevId === w.id) continue;
                  const prevWidget = sortedWidgets.find(sw => sw.id === prevId);
                  if (!prevWidget) continue;

                  const prevNewX = newPositions.get(prevWidget.id) ?? prevWidget.x;
                  const prevNewRightEdge = prevNewX + prevWidget.w;

                  // Check if prev widget has vertical overlap with current widget
                  const hasOverlapWithPrev = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                  // Only cascade if:
                  // 1. Previous widget has vertical overlap with THIS widget
                  // 2. Previous widget's new right edge touches this widget
                  if (hasOverlapWithPrev && prevNewRightEdge > w.x) {
                    const pushFromPrev = prevNewRightEdge - w.x;
                    if (pushFromPrev > maxPushFromPrev) {
                      maxPushFromPrev = pushFromPrev;
                    }
                  }
                }
                pushForThisWidget = maxPushFromPrev;
              }

              if (pushForThisWidget <= 0) {
                // No push needed, stay in place
                newPositions.set(w.id, w.x);

              } else {
                // Move by push amount, but clamp to viewport
                const maxMove = GRID_CONFIG.cols - w.w - w.x; // Max we can move right
                const actualMove = Math.min(pushForThisWidget, maxMove);
                const newX = w.x + actualMove;
                newPositions.set(w.id, newX);

                // NOTE: For HORIZONTAL-ONLY resize, we do NOT add non-chain widgets
                // when they're touched by pushed widgets. Only widgets with vertical
                // overlap with the RESIZING widget should be pushed. This prevents
                // incorrect cascading where widgets at different Y positions get pushed.
              }

              i++;
            }

          } else {
            // West resize - similar but reversed
            const sortedWidgets = [...widgetsToPush].sort((a, b) => b.x - a.x);
            const resizingNewLeftEdge = finalX;

            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];
              const wRightEdge = w.x + w.w;

              // DEFAULT: 0 - widget doesn't move unless something touches it
              let pushForThisWidget = 0;

              // First check: Is this widget directly touched by the resizing widget?
              const touchedByResizing = resizingNewLeftEdge < wRightEdge && hasVerticalOverlap(w);

              if (touchedByResizing) {
                pushForThisWidget = wRightEdge - resizingNewLeftEdge;

              } else {
                // Second check: Is this widget touched by another pushed widget
                // that has vertical overlap WITH THIS WIDGET?
                let maxPushFromPrev = 0;
                for (let j = 0; j < i; j++) {
                  const prevWidget = sortedWidgets[j];
                  const prevNewX = newPositions.get(prevWidget.id) ?? prevWidget.x;

                  // Check if prev widget has vertical overlap with current
                  const hasOverlapWithPrev = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                  // Only cascade if:
                  // 1. Previous widget has vertical overlap with THIS widget
                  // 2. Previous widget was originally to the right of this widget
                  // 3. Previous widget's NEW left edge touches this widget's right edge
                  if (hasOverlapWithPrev && prevWidget.x >= wRightEdge && prevNewX < wRightEdge) {
                    const pushFromPrev = wRightEdge - prevNewX;
                    if (pushFromPrev > maxPushFromPrev) {
                      maxPushFromPrev = pushFromPrev;
                    }
                  }
                }
                pushForThisWidget = maxPushFromPrev;
              }

              if (pushForThisWidget <= 0) {
                newPositions.set(w.id, w.x);

              } else {
                const newX = Math.max(w.x - pushForThisWidget, 0);
                newPositions.set(w.id, newX);

              }
            }
          }
        }

        // Use final values after dynamic blocking check
        // The simulation above already validated all positions
        let adjustedActualPush = actualPush;
        let adjustedFinalW = finalW;
        let adjustedFinalX = finalX;

        // Recalculate pushed widget positions with adjusted push using CASCADING logic
        // IMPORTANT: For horizontal resize, widgets that are vertically stacked (no vertical overlap)
        // should NOT cascade into each other - they should all be pushed by the same amount
        const adjustedPositions: Map<string, number> = new Map();
        if (adjustedActualPush > 0) {
          if (isEastResize) {
            // Calculate resizing widget's new right edge
            const resizingNewRightEdgeAdj = resizingLayout.x + adjustedFinalW;

            // Find ALL widgets that will be pushed - including non-chain widgets touched by resizing widget
            const allAdjWidgetsToPush = [...widgetsToPush];

            // Check if any non-chain widget is touched by resizing widget's new right edge
            // IMPORTANT: Only consider widgets that are to the RIGHT of resizing widget's ORIGINAL right edge
            const originalRightEdgeForNonChainAdj = resizingLayout.x + resizingLayout.w;
            for (const nonChain of nonChainWidgets) {
              // Only consider widgets to the RIGHT of resizing widget
              if (nonChain.x >= originalRightEdgeForNonChainAdj) {
                // Check if resizing widget's new right edge touches this non-chain widget
                if (resizingNewRightEdgeAdj > nonChain.x) {
                  // Check vertical overlap with resizing widget
                  if (hasVerticalOverlap(nonChain)) {
                    // This non-chain widget is touched - add to push list
                    if (!allAdjWidgetsToPush.some(w => w.id === nonChain.id)) {

                      allAdjWidgetsToPush.push(nonChain);
                    }
                  }
                }
              }
            }

            // Sort widgets left to right for cascading calculation
            // Use a mutable array so we can add more widgets during processing
            const sortedWidgets = allAdjWidgetsToPush.sort((a, b) => a.x - b.x);
            const processedWidgetIdsAdj = new Set<string>();

            let idx = 0;
            while (idx < sortedWidgets.length) {
              const w = sortedWidgets[idx];

              // Skip if already processed
              if (processedWidgetIdsAdj.has(w.id)) {
                idx++;
                continue;
              }
              processedWidgetIdsAdj.add(w.id);

              // Find the widget that would actually push this widget
              // It must be: to the left of this widget AND have vertical overlap with this widget
              // DEFAULT: 0 - widget doesn't move unless something touches it
              let pushForThisWidget = 0;

              // First check: Is this widget directly touched by the resizing widget?
              const resizingNewRightEdge = resizingLayout.x + adjustedFinalW;
              const touchedByResizing = resizingNewRightEdge > w.x && hasVerticalOverlap(w);

              if (touchedByResizing) {
                pushForThisWidget = resizingNewRightEdge - w.x;

              } else {
                // Second check: Is this widget touched by another pushed widget
                // that has vertical overlap WITH THIS WIDGET?
                let maxPushFromChain = 0;
                let pushedByWidget: typeof w | null = null;

                for (const prevId of processedWidgetIdsAdj) {
                  if (prevId === w.id) continue;
                  const prevWidget = sortedWidgets.find(sw => sw.id === prevId);
                  if (!prevWidget) continue;

                  const prevNewX = adjustedPositions.get(prevWidget.id) ?? prevWidget.x;
                  const prevNewRightEdge = prevNewX + prevWidget.w;

                  // Check if prevWidget has vertical overlap with current widget
                  const hasVertOverlap = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                  // Only cascade if:
                  // 1. Previous widget has vertical overlap with THIS widget
                  // 2. Previous widget was originally to the left of this widget
                  // 3. Previous widget's NEW right edge touches this widget
                  if (hasVertOverlap && prevWidget.x + prevWidget.w <= w.x && prevNewRightEdge > w.x) {
                    const cascadePush = prevNewRightEdge - w.x;
                    if (cascadePush > maxPushFromChain) {
                      maxPushFromChain = cascadePush;
                      pushedByWidget = prevWidget;
                    }
                  }
                }

                if (pushedByWidget && maxPushFromChain > 0) {
                  pushForThisWidget = maxPushFromChain;

                } else {

                }
              }

              if (pushForThisWidget <= 0) {
                adjustedPositions.set(w.id, w.x);

              } else {
                const maxMove = GRID_CONFIG.cols - w.w - w.x;
                const actualMove = Math.min(pushForThisWidget, maxMove);
                const newX = w.x + actualMove;
                adjustedPositions.set(w.id, newX);

                // NOTE: For HORIZONTAL-ONLY resize, we do NOT add non-chain widgets
                // when they're touched by pushed widgets. Only widgets with vertical
                // overlap with the RESIZING widget should be pushed.
              }

              idx++;
            }

          } else {
            // West resize - cascading from right to left with vertical overlap check
            const sortedWidgets = [...widgetsToPush].sort((a, b) => b.x - a.x);

            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];

              // DEFAULT: 0 - widget doesn't move unless something touches it
              let pushForThisWidget = 0;

              // First check: Is this widget directly touched by the resizing widget?
              const resizingNewLeftEdge = adjustedFinalX;
              const wRightEdge = w.x + w.w;
              const touchedByResizing = resizingNewLeftEdge < wRightEdge && hasVerticalOverlap(w);

              if (touchedByResizing) {
                pushForThisWidget = wRightEdge - resizingNewLeftEdge;

              } else {
                // Second check: Is this widget touched by another pushed widget
                // that has vertical overlap WITH THIS WIDGET?
                let maxPushFromChain = 0;

                for (let j = 0; j < i; j++) {
                  const prevWidget = sortedWidgets[j];
                  const prevNewX = adjustedPositions.get(prevWidget.id) ?? prevWidget.x;

                  const hasVertOverlap = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                  // Only cascade if:
                  // 1. Previous widget has vertical overlap with THIS widget
                  // 2. Previous widget was originally to the right of this widget
                  // 3. Previous widget's NEW left edge touches this widget's right edge
                  if (hasVertOverlap && prevWidget.x >= wRightEdge && prevNewX < wRightEdge) {
                    const cascadePush = wRightEdge - prevNewX;
                    if (cascadePush > maxPushFromChain) {
                      maxPushFromChain = cascadePush;
                    }
                  }
                }

                if (maxPushFromChain > 0) {
                  pushForThisWidget = maxPushFromChain;

                } else {

                }
              }

              if (pushForThisWidget <= 0) {
                adjustedPositions.set(w.id, w.x);
              } else {
                const newX = Math.max(w.x - pushForThisWidget, 0);
                adjustedPositions.set(w.id, newX);
              }
            }
          }
        }

        // Apply DOM updates
        resizeWidgetDom(resizingWidgetIdRef.current, adjustedFinalW, resizingLayout.h);
        if (isWestResize) {
          moveWidgetDom(resizingWidgetIdRef.current, adjustedFinalX, resizingLayout.y);
        }

        // Move pushed widgets - iterate over all widgets with adjusted positions (includes non-chain widgets)
        const movedWidgetIds: string[] = [];
        for (const [widgetId, newX] of adjustedPositions.entries()) {
          const widget = baseLayouts.find(l => l.i === widgetId);
          if (widget && newX !== widget.x) {
            moveWidgetDom(widgetId, newX, widget.y);
            movedWidgetIds.push(widgetId);
          }
        }

        // Update preview - preserve Y position for ALL widgets
        const newLayouts = baseLayouts.map(l => {
          if (l.i === resizingWidgetIdRef.current) {
            return { ...l, x: adjustedFinalX, w: adjustedFinalW, y: resizingLayout.y, h: resizingLayout.h };
          }
          const newX = adjustedPositions.get(l.i);
          if (newX !== undefined) {
            return { ...l, x: newX, y: l.y, h: l.h };
          }
          return { ...l };
        });

        // Validate: ensure no widget goes outside viewport
        let hasInvalidPosition = newLayouts.some(layout =>
          layout.x < 0 ||
          layout.x + layout.w > GRID_CONFIG.cols ||
          layout.y < 0 ||
          layout.y + layout.h > maxRows
        );

        // CRITICAL: Also validate that no two widgets overlap
        // This prevents react-grid-layout from moving widgets down to resolve collisions
        if (!hasInvalidPosition) {
          for (let i = 0; i < newLayouts.length; i++) {
            for (let j = i + 1; j < newLayouts.length; j++) {
              const a = newLayouts[i];
              const b = newLayouts[j];

              // Check horizontal overlap
              const hasHorizOverlap = !(a.x + a.w <= b.x || a.x >= b.x + b.w);
              // Check vertical overlap
              const hasVertOverlap = !(a.y + a.h <= b.y || a.y >= b.y + b.h);

              if (hasHorizOverlap && hasVertOverlap) {

                hasInvalidPosition = true;
                break;
              }
            }
            if (hasInvalidPosition) break;
          }
        }

        if (hasInvalidPosition) {

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

      // VERTICAL PUSH HANDLING (south/north) - GAP FILL FIRST, THEN PUSH
      if (handleVertical && !handleHorizontal) {
        const effectiveDeltaY = isSouthResize ? gridDeltaY : -gridDeltaY;
        const minH = resizingLayout.minH ?? 3;

        // If shrinking, dependent widgets should return to original position (not follow)
        if (effectiveDeltaY <= 0) {
          const limitedH = Math.max(minH, resizingLayout.h + effectiveDeltaY);
          const limitedY = isNorthResize
            ? resizingLayout.y + resizingLayout.h - limitedH
            : resizingLayout.y;

          resizeWidgetDom(resizingWidgetIdRef.current, resizingLayout.w, limitedH);
          if (isNorthResize) {
            moveWidgetDom(resizingWidgetIdRef.current, resizingLayout.x, limitedY);
          }

          // Reset all dependent widgets to their ORIGINAL positions from baseLayouts
          for (const l of baseLayouts) {
            if (l.i !== resizingWidgetIdRef.current) {
              moveWidgetDom(l.i, l.x, l.y);
            }
          }

          // Build new layouts with resizing widget at new size, others at original positions
          const newLayouts = baseLayouts.map(l => {
            if (l.i === resizingWidgetIdRef.current) {
              return { ...l, y: limitedY, h: limitedH };
            }
            return l;
          });

          setResizePreview({ newLayouts, movedWidgets: [], shrunkWidgets: [] });
          lastPushedLayoutRef.current = newLayouts;
          return;
        }

        // Expanding - GAP FILL FIRST, THEN PUSH widgets until they hit viewport edge
        const originalBottomEdge = resizingLayout.y + resizingLayout.h;
        const originalTopEdge = resizingLayout.y;

        // Helper function to check horizontal overlap with resizing widget
        const hasHorizontalOverlap = (widget: { x: number; w: number }) => {
          return !(widget.x >= resizingLayout.x + resizingLayout.w || widget.x + widget.w <= resizingLayout.x);
        };

        // Helper function to check if two widgets have horizontal overlap
        const hasHorizontalOverlapBetween = (w1: { x: number; w: number }, w2: { x: number; w: number }) => {
          return !(w1.x + w1.w <= w2.x || w1.x >= w2.x + w2.w);
        };

        // Get all other widgets
        const allWidgets = baseLayouts
          .filter(l => l.i !== resizingWidgetIdRef.current)
          .map(l => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));

        // Find widgets that have horizontal overlap (potential push targets)
        const widgetsWithOverlap = allWidgets.filter(w => hasHorizontalOverlap(w));

        // Find the FIRST widget in the resize direction (closest to resizing widget)
        let gapToFirstWidget = 0;
        let firstWidgetEdge = isSouthResize ? maxRows : 0;

        if (isSouthResize) {
          // Find widgets BELOW resizing widget
          const widgetsBelow = widgetsWithOverlap.filter(w => w.y >= originalBottomEdge);
          if (widgetsBelow.length > 0) {
            // Sort by Y position (closest first)
            widgetsBelow.sort((a, b) => a.y - b.y);
            firstWidgetEdge = widgetsBelow[0].y;
            gapToFirstWidget = firstWidgetEdge - originalBottomEdge;
          } else {
            // No widgets below, gap is to viewport edge
            gapToFirstWidget = maxRows - originalBottomEdge;
          }
        } else {
          // North resize - find widgets ABOVE resizing widget
          const widgetsAbove = widgetsWithOverlap.filter(w => w.y + w.h <= originalTopEdge);
          if (widgetsAbove.length > 0) {
            // Sort by bottom edge (closest first = highest bottom edge)
            widgetsAbove.sort((a, b) => (b.y + b.h) - (a.y + a.h));
            firstWidgetEdge = widgetsAbove[0].y + widgetsAbove[0].h;
            gapToFirstWidget = originalTopEdge - firstWidgetEdge;
          } else {
            // No widgets above, gap is to viewport edge (y=0)
            gapToFirstWidget = originalTopEdge;
          }
        }

        // Calculate how much of the expansion goes into the gap vs pushing
        const expansion = effectiveDeltaY;
        const gapFill = Math.min(expansion, gapToFirstWidget);
        const pushAmount = Math.max(0, expansion - gapToFirstWidget);

        // Build the list of ALL widgets that need to be pushed using BFS CHAIN DETECTION
        let widgetsToPush: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];

        if (isSouthResize) {
          // Get ALL widgets below resizing widget
          const widgetsBelow = allWidgets
            .filter(w => w.y >= originalBottomEdge)
            .sort((a, b) => a.y - b.y);

          // Start with widgets that have direct horizontal overlap with resizing widget
          const directPushWidgets = widgetsBelow.filter(w => hasHorizontalOverlap(w));

          // Chain reaction - BFS to find all connected widgets
          const pushedSet = new Set<string>();
          const queue = [...directPushWidgets];

          while (queue.length > 0) {
            const current = queue.shift()!;
            if (pushedSet.has(current.id)) continue;
            pushedSet.add(current.id);
            widgetsToPush.push(current);

            // Find ALL widgets below current that have horizontal overlap with current
            const currentBottomEdge = current.y + current.h;

            for (const other of widgetsBelow) {
              if (pushedSet.has(other.id)) continue;

              // Check if other is below current
              const isBelow = other.y >= currentBottomEdge;
              // Check horizontal overlap with current widget
              const hasOverlap = !(current.x + current.w <= other.x || current.x >= other.x + other.w);

              if (isBelow && hasOverlap) {

                queue.push(other);
              }
            }
          }

          widgetsToPush.sort((a, b) => a.y - b.y); // Sort top to bottom

        } else {
          // North resize - similar logic but upward
          const widgetsAbove = allWidgets
            .filter(w => w.y + w.h <= originalTopEdge)
            .sort((a, b) => b.y - a.y);

          const directPushWidgets = widgetsAbove.filter(w => hasHorizontalOverlap(w));
          const pushedSet = new Set<string>();
          const queue = [...directPushWidgets];

          while (queue.length > 0) {
            const current = queue.shift()!;
            if (pushedSet.has(current.id)) continue;
            pushedSet.add(current.id);
            widgetsToPush.push(current);

            const currentTopEdge = current.y;
            for (const other of widgetsAbove) {
              if (pushedSet.has(other.id)) continue;
              if (other.y + other.h > currentTopEdge) continue;

              const hasOverlap = !(current.x + current.w <= other.x || current.x >= other.x + other.w);
              if (hasOverlap) {
                queue.push(other);
              }
            }
          }

          widgetsToPush.sort((a, b) => b.y - a.y); // Sort bottom to top
        }


        // Find widgets NOT in the chain
        const chainIds = new Set(widgetsToPush.map(w => w.id));
        const nonChainWidgets = allWidgets.filter(w => !chainIds.has(w.id));

        // Calculate available space for pushing (INCLUDING GAPS BETWEEN WIDGETS)
        // IMPORTANT: Widgets that DON'T have horizontal overlap with each other are INDEPENDENT
        // They should be grouped into separate chains, and each chain's space calculated independently
        let availablePushSpace = 0;

        if (pushAmount > 0 && widgetsToPush.length > 0) {
          // Group widgets into horizontal chains (widgets with horizontal overlap cascade together)
          const verticalChains: Array<Array<typeof widgetsToPush[0]>> = [];
          const assignedVertical = new Set<string>();

          for (const widget of widgetsToPush) {
            if (assignedVertical.has(widget.id)) continue;

            const chain = [widget];
            assignedVertical.add(widget.id);

            // BFS to find all widgets that have horizontal overlap with this chain
            let i = 0;
            while (i < chain.length) {
              const current = chain[i];
              for (const other of widgetsToPush) {
                if (assignedVertical.has(other.id)) continue;
                // Check horizontal overlap
                const hasHorzOverlap = !(current.x + current.w <= other.x || current.x >= other.x + other.w);
                if (hasHorzOverlap) {
                  chain.push(other);
                  assignedVertical.add(other.id);
                }
              }
              i++;
            }

            verticalChains.push(chain);
          }

          // Calculate available space for each chain
          const chainSpaces: number[] = [];

          if (isSouthResize) {
            for (const chain of verticalChains) {
              // Sort chain by y position (top to bottom)
              chain.sort((a, b) => a.y - b.y);

              // Calculate gaps between widgets in this chain
              let totalGapsInChain = 0;
              for (let i = 0; i < chain.length - 1; i++) {
                const currentBottomEdge = chain[i].y + chain[i].h;
                const nextTopEdge = chain[i + 1].y;
                const gap = nextTopEdge - currentBottomEdge;
                if (gap > 0) totalGapsInChain += gap;
              }

              // Find bottommost widget in this chain
              const bottommostWidget = chain[chain.length - 1];
              const bottommostEdge = bottommostWidget.y + bottommostWidget.h;

              // Find what blocks this chain (viewport or non-chain widget with horizontal overlap)
              let blockingEdge = maxRows;
              for (const nonChain of nonChainWidgets) {
                const hasOverlapWithChain = chain.some(chainWidget =>
                  hasHorizontalOverlapBetween(chainWidget, nonChain)
                );
                if (hasOverlapWithChain && nonChain.y >= bottommostEdge) {
                  blockingEdge = Math.min(blockingEdge, nonChain.y);
                }
              }

              // Gap from resizing widget to first widget in chain
              const firstWidget = chain[0];
              const gapToFirst = firstWidget.y - (resizingLayout.y + resizingLayout.h);

              const spaceAtEnd = blockingEdge - bottommostEdge;
              const chainSpace = Math.max(0, gapToFirst) + totalGapsInChain + spaceAtEnd;
              chainSpaces.push(chainSpace);

            }
          } else {
            // North resize
            for (const chain of verticalChains) {
              // Sort chain by y position (bottom to top)
              chain.sort((a, b) => b.y - a.y);

              let totalGapsInChain = 0;
              for (let i = 0; i < chain.length - 1; i++) {
                const currentTopEdge = chain[i].y;
                const nextBottomEdge = chain[i + 1].y + chain[i + 1].h;
                const gap = currentTopEdge - nextBottomEdge;
                if (gap > 0) totalGapsInChain += gap;
              }

              const topmostWidget = chain[chain.length - 1];
              const topmostEdge = topmostWidget.y;

              let blockingEdge = 0;
              for (const nonChain of nonChainWidgets) {
                const hasOverlapWithChain = chain.some(chainWidget =>
                  hasHorizontalOverlapBetween(chainWidget, nonChain)
                );
                if (hasOverlapWithChain && nonChain.y + nonChain.h <= topmostEdge) {
                  blockingEdge = Math.max(blockingEdge, nonChain.y + nonChain.h);
                }
              }

              const firstWidget = chain[0];
              const gapToFirst = resizingLayout.y - (firstWidget.y + firstWidget.h);

              const spaceAtEnd = topmostEdge - blockingEdge;
              const chainSpace = Math.max(0, gapToFirst) + totalGapsInChain + spaceAtEnd;
              chainSpaces.push(chainSpace);
            }
          }

          // Available space is the MINIMUM across all chains
          availablePushSpace = chainSpaces.length > 0 ? Math.min(...chainSpaces) : 0;

        }

        // Calculate actual push (limited by available space)
        const actualPush = Math.min(pushAmount, availablePushSpace);
        const totalExpansion = gapFill + actualPush;

        // Calculate final dimensions
        const finalH = Math.max(minH, resizingLayout.h + totalExpansion);
        const finalY = isNorthResize
          ? resizingLayout.y + resizingLayout.h - finalH
          : resizingLayout.y;

        // Check viewport bounds
        if ((isSouthResize && finalY + finalH > maxRows) || (isNorthResize && finalY < 0)) {
          return;
        }

        // SIMULATION-BASED BLOCKING CHECK (same approach as horizontal resize)
        // This properly calculates where each widget ends up with cascading logic
        let adjustedActualPush = actualPush;
        let adjustedFinalH = finalH;
        let adjustedFinalY = finalY;
        let validatedPositions: Map<string, number> = new Map();

        if (actualPush > 0 && widgetsToPush.length > 0) {

          // Sort widgets for cascade simulation
          const sortedForSim = [...widgetsToPush].sort((a, b) => isSouthResize ? a.y - b.y : b.y - a.y);

          // Simulate cascade for a given expansion
          const simulateVerticalExpansion = (expansion: number): { valid: boolean; positions: Map<string, number> } => {
            const positions = new Map<string, number>();
            const simFinalH = Math.max(minH, resizingLayout.h + expansion);
            const simResizingBottomEdge = isSouthResize ? resizingLayout.y + simFinalH : resizingLayout.y + resizingLayout.h;
            const simResizingTopEdge = isNorthResize ? resizingLayout.y + resizingLayout.h - simFinalH : resizingLayout.y;

            // For each widget, calculate where it would end up using CASCADING logic
            for (const widget of sortedForSim) {
              let pushForWidget = 0;

              // Check if directly touched by resizing widget
              if (isSouthResize) {
                if (simResizingBottomEdge > widget.y && hasHorizontalOverlap(widget)) {
                  pushForWidget = simResizingBottomEdge - widget.y;
                }
              } else {
                const widgetBottom = widget.y + widget.h;
                if (simResizingTopEdge < widgetBottom && hasHorizontalOverlap(widget)) {
                  pushForWidget = widgetBottom - simResizingTopEdge;
                }
              }

              // Check cascade from other widgets (already processed)
              for (const [prevId, prevNewY] of positions.entries()) {
                const prevWidget = sortedForSim.find(w => w.id === prevId);
                if (!prevWidget) continue;

                // Check horizontal overlap between prev and current
                const hasOverlapWithPrev = !(prevWidget.x + prevWidget.w <= widget.x || prevWidget.x >= widget.x + widget.w);
                if (!hasOverlapWithPrev) continue;

                if (isSouthResize) {
                  const prevNewBottom = prevNewY + prevWidget.h;
                  if (prevNewBottom > widget.y) {
                    pushForWidget = Math.max(pushForWidget, prevNewBottom - widget.y);
                  }
                } else {
                  if (prevNewY < widget.y + widget.h) {
                    pushForWidget = Math.max(pushForWidget, widget.y + widget.h - prevNewY);
                  }
                }
              }

              // Calculate new position
              let newY: number;
              if (isSouthResize) {
                newY = widget.y + pushForWidget;
                // Check if widget goes outside viewport
                if (newY + widget.h > maxRows) {
                  return { valid: false, positions };
                }
              } else {
                newY = widget.y - pushForWidget;
                // Check if widget goes outside viewport
                if (newY < 0) {
                  return { valid: false, positions };
                }
              }

              positions.set(widget.id, newY);
            }

            // Check if any pushed widget would overlap with non-chain widgets
            for (const [widgetId, newY] of positions.entries()) {
              const widget = sortedForSim.find(w => w.id === widgetId);
              if (!widget) continue;

              for (const nonChain of nonChainWidgets) {
                // Check horizontal overlap
                const hasHorzOverlap = hasHorizontalOverlapBetween(widget, nonChain);

                // Check vertical overlap
                const pushedTop = newY;
                const pushedBottom = newY + widget.h;
                const hasVertOverlap = !(pushedBottom <= nonChain.y || pushedTop >= nonChain.y + nonChain.h);

                if (hasHorzOverlap && hasVertOverlap) {
                  return { valid: false, positions };
                }
              }
            }

            // Check if resizing widget itself would overlap with non-chain widgets
            for (const nonChain of nonChainWidgets) {
              const resizingTop = isNorthResize ? simResizingTopEdge : resizingLayout.y;
              const resizingBottom = isSouthResize ? simResizingBottomEdge : resizingLayout.y + resizingLayout.h;
              const hasHorzOverlap = hasHorizontalOverlapBetween(resizingLayout, nonChain);
              const hasVertOverlap = !(resizingBottom <= nonChain.y || resizingTop >= nonChain.y + nonChain.h);

              if (hasHorzOverlap && hasVertOverlap) {
                return { valid: false, positions };
              }
            }

            return { valid: true, positions };
          };

          // Check if full expansion is valid
          const maxExpansion = gapFill + actualPush;
          let simResult = simulateVerticalExpansion(maxExpansion);
          validatedPositions = simResult.positions;
          let validatedExpansion = maxExpansion;

          if (!simResult.valid) {
            // Binary search for maximum valid expansion
            let low = 0;
            let high = maxExpansion;
            let lastValidExpansion = 0;
            let lastValidPositions = new Map<string, number>();

            while (high - low > 0.1) {
              const mid = (low + high) / 2;
              const midResult = simulateVerticalExpansion(mid);

              if (midResult.valid) {
                lastValidExpansion = mid;
                lastValidPositions = midResult.positions;
                low = mid;
              } else {
                high = mid;
              }
            }

            // Check floor of high
            const floorHigh = Math.floor(high);
            if (floorHigh > lastValidExpansion) {
              const floorResult = simulateVerticalExpansion(floorHigh);
              if (floorResult.valid) {
                lastValidExpansion = floorHigh;
                lastValidPositions = floorResult.positions;
              }
            }

            validatedExpansion = lastValidExpansion;
            validatedPositions = lastValidPositions;

          }

          // Update values based on validated expansion
          const newActualPush = Math.max(0, validatedExpansion - gapFill);
          adjustedActualPush = newActualPush;
          adjustedFinalH = Math.max(minH, resizingLayout.h + validatedExpansion);
          adjustedFinalY = isNorthResize
            ? resizingLayout.y + resizingLayout.h - adjustedFinalH
            : resizingLayout.y;

          // Use validated positions directly and return early
          if (simResult.valid || validatedPositions.size > 0) {

            // Apply DOM updates
            resizeWidgetDom(resizingWidgetIdRef.current!, resizingLayout.w, adjustedFinalH);
            if (isNorthResize) {
              moveWidgetDom(resizingWidgetIdRef.current!, resizingLayout.x, adjustedFinalY);
            }

            // Move pushed widgets using validated positions
            const movedWidgetIds: string[] = [];
            for (const [widgetId, newY] of validatedPositions.entries()) {
              const widget = baseLayouts.find(l => l.i === widgetId);
              if (widget && newY !== widget.y) {
                moveWidgetDom(widgetId, widget.x, newY);
                movedWidgetIds.push(widgetId);
              }
            }

            // Update preview with validated positions
            const newLayouts = baseLayouts.map(l => {
              if (l.i === resizingWidgetIdRef.current) {
                return { ...l, y: adjustedFinalY, h: adjustedFinalH };
              }
              const newY = validatedPositions.get(l.i);
              if (newY !== undefined) {
                return { ...l, y: newY };
              }
              return { ...l };
            });

            setResizePreview({ newLayouts, movedWidgets: movedWidgetIds, shrunkWidgets: [] });
            lastPushedLayoutRef.current = newLayouts;
            return;
          }
        }

        // FALLBACK: Recalculate pushed widget positions with adjusted push using CASCADING logic
        // IMPORTANT: For vertical resize, widgets that are horizontally stacked (no horizontal overlap)
        // should NOT cascade into each other - they should all be pushed by the same amount
        const adjustedPositions: Map<string, number> = new Map();
        if (adjustedActualPush > 0) {
          if (isSouthResize) {
            // Sort widgets top to bottom for cascading calculation
            const sortedWidgets = [...widgetsToPush].sort((a, b) => a.y - b.y);

            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];

              // Find the widget that would actually push this widget
              // It must be: above this widget AND have horizontal overlap with this widget
              let pushForThisWidget = adjustedActualPush; // Default: pushed by resizing widget

              // Check if any already-processed widget is above AND has horizontal overlap
              let pushedByWidget: typeof w | null = null;
              let maxPushFromChain = 0;

              for (let j = 0; j < i; j++) {
                const prevWidget = sortedWidgets[j];
                const prevNewY = adjustedPositions.get(prevWidget.id) ?? prevWidget.y;
                const prevNewBottomEdge = prevNewY + prevWidget.h;

                // Check if prevWidget has horizontal overlap with current widget
                const hasHorzOverlap = !(prevWidget.x + prevWidget.w <= w.x || prevWidget.x >= w.x + w.w);

                // Check if prevWidget is actually above (before pushing) AND its new bottom edge reaches us
                if (hasHorzOverlap && prevWidget.y + prevWidget.h <= w.y) {
                  if (prevNewBottomEdge > w.y) {
                    const cascadePush = prevNewBottomEdge - w.y;
                    if (cascadePush > maxPushFromChain) {
                      maxPushFromChain = cascadePush;
                      pushedByWidget = prevWidget;
                    }
                  }
                }
              }

              // If we found a widget that cascades into us, use that push
              // Otherwise, check if resizing widget directly pushes us
              if (pushedByWidget && maxPushFromChain > 0) {
                pushForThisWidget = maxPushFromChain;

              } else {
                // Check if resizing widget's new bottom edge reaches us
                const resizingNewBottomEdge = resizingLayout.y + adjustedFinalH;
                if (resizingNewBottomEdge > w.y) {
                  pushForThisWidget = resizingNewBottomEdge - w.y;

                } else {
                  pushForThisWidget = 0;

                }
              }

              if (pushForThisWidget <= 0) {
                adjustedPositions.set(w.id, w.y);

              } else {
                const maxMove = maxRows - w.h - w.y;
                const actualMove = Math.min(pushForThisWidget, maxMove);
                const newY = w.y + actualMove;
                adjustedPositions.set(w.id, newY);

              }
            }

          } else {
            // North resize - cascading from bottom to top with horizontal overlap check
            const sortedWidgets = [...widgetsToPush].sort((a, b) => b.y - a.y);

            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];

              let pushForThisWidget = adjustedActualPush;
              let maxPushFromChain = 0;

              for (let j = 0; j < i; j++) {
                const prevWidget = sortedWidgets[j];
                const prevNewY = adjustedPositions.get(prevWidget.id) ?? prevWidget.y;

                const hasHorzOverlap = !(prevWidget.x + prevWidget.w <= w.x || prevWidget.x >= w.x + w.w);
                const wBottomEdge = w.y + w.h;

                if (hasHorzOverlap && prevWidget.y >= wBottomEdge) {
                  if (prevNewY < wBottomEdge) {
                    const cascadePush = wBottomEdge - prevNewY;
                    if (cascadePush > maxPushFromChain) {
                      maxPushFromChain = cascadePush;
                    }
                  }
                }
              }

              if (maxPushFromChain > 0) {
                pushForThisWidget = maxPushFromChain;
              } else {
                const resizingNewTopEdge = adjustedFinalY;
                const wBottomEdge = w.y + w.h;
                if (resizingNewTopEdge < wBottomEdge) {
                  pushForThisWidget = wBottomEdge - resizingNewTopEdge;
                } else {
                  pushForThisWidget = 0;
                }
              }

              if (pushForThisWidget <= 0) {
                adjustedPositions.set(w.id, w.y);
              } else {
                const newY = Math.max(w.y - pushForThisWidget, 0);
                adjustedPositions.set(w.id, newY);
              }
            }
          }
        }

        // Apply DOM updates
        resizeWidgetDom(resizingWidgetIdRef.current, resizingLayout.w, adjustedFinalH);
        if (isNorthResize) {
          moveWidgetDom(resizingWidgetIdRef.current, resizingLayout.x, adjustedFinalY);
        }

        // Move pushed widgets
        const movedWidgetIds: string[] = [];
        for (const w of widgetsToPush) {
          const newY = adjustedPositions.get(w.id) ?? w.y;
          if (newY !== w.y) {
            moveWidgetDom(w.id, w.x, newY);
            movedWidgetIds.push(w.id);
          }
        }

        // Update preview - preserve X position for ALL widgets
        const newLayouts = baseLayouts.map(l => {
          if (l.i === resizingWidgetIdRef.current) {
            return { ...l, y: adjustedFinalY, h: adjustedFinalH, x: resizingLayout.x, w: resizingLayout.w };
          }
          const newY = adjustedPositions.get(l.i);
          if (newY !== undefined) {
            return { ...l, y: newY, x: l.x, w: l.w };
          }
          return { ...l };
        });

        // Validate: ensure no widget goes outside viewport
        let hasInvalidVertPosition = newLayouts.some(layout =>
          layout.x < 0 ||
          layout.x + layout.w > GRID_CONFIG.cols ||
          layout.y < 0 ||
          layout.y + layout.h > maxRows
        );

        // CRITICAL: Also validate that no two widgets overlap
        if (!hasInvalidVertPosition) {
          for (let i = 0; i < newLayouts.length; i++) {
            for (let j = i + 1; j < newLayouts.length; j++) {
              const a = newLayouts[i];
              const b = newLayouts[j];

              const hasHorizOverlap = !(a.x + a.w <= b.x || a.x >= b.x + b.w);
              const hasVertOverlap = !(a.y + a.h <= b.y || a.y >= b.y + b.h);

              if (hasHorizOverlap && hasVertOverlap) {

                hasInvalidVertPosition = true;
                break;
              }
            }
            if (hasInvalidVertPosition) break;
          }
        }

        if (hasInvalidVertPosition) {

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

      // CORNER RESIZE HANDLING (se, sw, ne, nw) - Handle BOTH horizontal AND vertical simultaneously
      if (handleHorizontal && handleVertical) {

        const effectiveDeltaX = isEastResize ? gridDeltaX : -gridDeltaX;
        const effectiveDeltaY = isSouthResize ? gridDeltaY : -gridDeltaY;
        const minW = resizingLayout.minW ?? 3;
        const minH = resizingLayout.minH ?? 3;

        // Calculate requested dimensions (from original size at resize start)
        const requestedW = Math.max(minW, resizingLayout.w + effectiveDeltaX);
        const requestedH = Math.max(minH, resizingLayout.h + effectiveDeltaY);

        // Clamp to viewport (using let so we can further limit based on available push space)
        let clampedW = Math.min(requestedW, isWestResize ? resizingLayout.x + resizingLayout.w : GRID_CONFIG.cols - resizingLayout.x);
        let clampedH = Math.min(requestedH, isNorthResize ? resizingLayout.y + resizingLayout.h : maxRows - resizingLayout.y);
        const clampedX = isWestResize ? resizingLayout.x + resizingLayout.w - clampedW : resizingLayout.x;

        // Helper functions
        const hasVerticalOverlapBetween = (w1: { y: number; h: number }, w2: { y: number; h: number }) => {
          return !(w1.y + w1.h <= w2.y || w1.y >= w2.y + w2.h);
        };

        const hasHorizontalOverlapBetween = (w1: { x: number; w: number }, w2: { x: number; w: number }) => {
          return !(w1.x + w1.w <= w2.x || w1.x >= w2.x + w2.w);
        };

        // Get all other widgets from ORIGINAL positions (baseLayouts) - same as horizontal/vertical resize
        // This ensures widgets don't accumulate incorrect positions during drag
        const allWidgets = baseLayouts
          .filter(l => l.i !== resizingWidgetIdRef.current)
          .map(l => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));

        // Calculate horizontal push with FULL CASCADING logic (same as horizontal-only resize)
        // INCLUDING GAP FILL - first fill gap to first widget, then push
        const horzPositions: Map<string, number> = new Map();
        // IMPORTANT: Use ORIGINAL height for horizontal collision check
        // Vertical expansion should NOT affect horizontal push decisions
        // Only widgets that overlap with original vertical bounds should be considered
        const resizingBoundsForHorz = { y: resizingLayout.y, h: resizingLayout.h };

        // Use ORIGINAL edges (same as horizontal-only resize)
        const originalRightEdge = resizingLayout.x + resizingLayout.w;
        const originalLeftEdge = resizingLayout.x;

        // Check if user is REQUESTING horizontal expansion (use requestedW, not clampedW)
        // This allows continuous resize - as user drags further, expansion keeps increasing
        if (requestedW > resizingLayout.w) {
          const horizontalExpansion = requestedW - resizingLayout.w;

          // Collect ALL widgets to push using BFS chain detection
          const widgetsToPushHorz: typeof allWidgets = [];

          if (isEastResize) {


            const widgetsToRight = allWidgets
              .filter(w => w.x >= originalRightEdge)
              .sort((a, b) => a.x - b.x);


            // Find gap to first widget with vertical overlap
            let gapToFirstWidget = GRID_CONFIG.cols - originalRightEdge;

            const widgetsWithOverlap = widgetsToRight.filter(w => hasVerticalOverlapBetween(resizingBoundsForHorz, w));


            if (widgetsWithOverlap.length > 0) {
              widgetsWithOverlap.sort((a, b) => a.x - b.x);
              gapToFirstWidget = widgetsWithOverlap[0].x - originalRightEdge;
            }

            // Calculate gap fill vs push
            const gapFillHorz = Math.min(horizontalExpansion, gapToFirstWidget);
            let pushAmountHorz = Math.max(0, horizontalExpansion - gapToFirstWidget);

            // SAME AS HORIZONTAL-ONLY: Only push widgets with DIRECT vertical overlap
            // NO BFS chain detection - just direct overlap with resizing widget
            const widgetsWithVertOverlap = widgetsToRight.filter(w =>
              hasVerticalOverlapBetween(resizingBoundsForHorz, w)
            );

            // For corner horizontal, ALL widgets with vertical overlap are in the push list
            // (same as horizontal-only resize - no BFS needed)
            widgetsToPushHorz.push(...widgetsWithVertOverlap);
            widgetsToPushHorz.sort((a, b) => a.x - b.x);


            // Identify non-chain widgets (widgets NOT in the push chain)
            const pushedIds = new Set(widgetsToPushHorz.map(w => w.id));
            const nonChainWidgets = allWidgets.filter(w => !pushedIds.has(w.id));

            // Calculate available push space - EACH WIDGET INDEPENDENTLY (same as horizontal-only resize)
            if (widgetsToPushHorz.length > 0) {
              // There are widgets to push
              if (pushAmountHorz > 0) {
                // Calculate available space for EACH widget INDEPENDENTLY
                // A widget is blocked only by widgets that have VERTICAL OVERLAP WITH IT specifically
                const widgetSpaces: number[] = [];

                for (const widget of widgetsToPushHorz) {
                  const widgetRightEdge = widget.x + widget.w;

                  // Find what blocks THIS specific widget (not the whole chain)
                  let blockingEdgeForWidget = GRID_CONFIG.cols;
                  for (const nonChain of nonChainWidgets) {
                    if (nonChain.x <= widgetRightEdge) continue; // Must be to the right

                    // Check vertical overlap with THIS SPECIFIC widget only
                    const hasOverlapWithThisWidget = !(widget.y + widget.h <= nonChain.y || widget.y >= nonChain.y + nonChain.h);
                    if (hasOverlapWithThisWidget && nonChain.x < blockingEdgeForWidget) {
                      blockingEdgeForWidget = nonChain.x;

                    }
                  }

                  const spaceForWidget = blockingEdgeForWidget - widgetRightEdge;
                  const gapFromResizing = widget.x - originalRightEdge;
                  const totalSpaceForWidget = gapFromResizing + spaceForWidget;

                  widgetSpaces.push(totalSpaceForWidget);

                }

                const availablePushSpace = Math.min(...widgetSpaces);

                pushAmountHorz = Math.min(pushAmountHorz, availablePushSpace);

                // Check collision with non-chain widgets
                for (const pushedWidget of widgetsToPushHorz) {
                  const pushedNewX = pushedWidget.x + pushAmountHorz;
                  const clampedPushedX = Math.min(pushedNewX, GRID_CONFIG.cols - pushedWidget.w);

                  for (const nonChain of nonChainWidgets) {
                    const pushedLeftEdge = clampedPushedX;
                    const pushedRightEdge = clampedPushedX + pushedWidget.w;
                    const nonChainLeftEdge = nonChain.x;
                    const nonChainRightEdge = nonChain.x + nonChain.w;

                    const hasHorzOverlap = !(pushedRightEdge <= nonChainLeftEdge || pushedLeftEdge >= nonChainRightEdge);
                    const hasVertOverlap = !(pushedWidget.y + pushedWidget.h <= nonChain.y || pushedWidget.y >= nonChain.y + nonChain.h);

                    if (hasHorzOverlap && hasVertOverlap) {
                      const maxPushedX = nonChainLeftEdge - pushedWidget.w;
                      const maxPush = Math.max(0, maxPushedX - pushedWidget.x);
                      if (maxPush < pushAmountHorz) {

                        pushAmountHorz = maxPush;
                      }
                    }
                  }
                }

                // Also check if resizing widget itself collides with non-chain widgets
                const resizingNewRightEdge = resizingLayout.x + resizingLayout.w + gapFillHorz + pushAmountHorz;
                for (const nonChain of nonChainWidgets) {
                  const hasHorzOverlap = !(resizingNewRightEdge <= nonChain.x || resizingLayout.x >= nonChain.x + nonChain.w);
                  const hasVertOverlap = hasVerticalOverlapBetween(resizingBoundsForHorz, nonChain);

                  if (hasHorzOverlap && hasVertOverlap) {
                    const maxW = nonChain.x - resizingLayout.x;
                    const maxAchievable = Math.max(resizingLayout.w, maxW);
                    const newPushAmount = Math.max(0, maxAchievable - resizingLayout.w - gapFillHorz);
                    if (newPushAmount < pushAmountHorz) {

                      pushAmountHorz = newPushAmount;
                    }
                  }
                }
              }

              // CRITICAL: Dynamic blocking simulation - SAME AS HORIZONTAL-ONLY RESIZE
              // Simulate cascade and use binary search to find max valid expansion

              const sortedForSimCorner = [...widgetsToPushHorz].sort((a, b) => a.x - b.x);
              const maxAllowedExpansionCorner = gapFillHorz + pushAmountHorz;

              const simulateCornerExpansion = (expansion: number): { valid: boolean; positions: Map<string, number> } => {
                const positions = new Map<string, number>();
                const simFinalW = Math.max(minW, resizingLayout.w + expansion);
                const simResizingRightEdge = resizingLayout.x + simFinalW;

                // For each widget, calculate where it would end up
                for (const widget of sortedForSimCorner) {
                  let pushForWidget = 0;

                  // Check if directly touched by resizing widget
                  if (simResizingRightEdge > widget.x && hasVerticalOverlapBetween(resizingBoundsForHorz, widget)) {
                    pushForWidget = simResizingRightEdge - widget.x;
                  }

                  // Check cascade from other widgets
                  for (const [prevId, prevNewX] of positions.entries()) {
                    const prevWidget = sortedForSimCorner.find(w => w.id === prevId);
                    if (!prevWidget) continue;

                    const hasOverlapWithPrev = !(prevWidget.y + prevWidget.h <= widget.y || prevWidget.y >= widget.y + widget.h);
                    if (!hasOverlapWithPrev) continue;

                    const prevNewRight = prevNewX + prevWidget.w;
                    if (prevNewRight > widget.x) {
                      pushForWidget = Math.max(pushForWidget, prevNewRight - widget.x);
                    }
                  }

                  // Calculate new position
                  const newX = widget.x + pushForWidget;
                  // Check if widget goes outside viewport
                  if (newX + widget.w > GRID_CONFIG.cols) {
                    return { valid: false, positions };
                  }

                  positions.set(widget.id, newX);
                }

                // Check overlap with non-chain widgets
                for (const [widgetId, newX] of positions.entries()) {
                  const widget = sortedForSimCorner.find(w => w.id === widgetId);
                  if (!widget) continue;

                  for (const nonChain of nonChainWidgets) {
                    const pushedRight = newX + widget.w;
                    const hasHorizOverlap = !(pushedRight <= nonChain.x || newX >= nonChain.x + nonChain.w);
                    const hasVertOverlap = !(widget.y + widget.h <= nonChain.y || widget.y >= nonChain.y + nonChain.h);

                    if (hasHorizOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with non-chain widgets
                for (const nonChain of nonChainWidgets) {
                  const hasHorizOverlap = !(simResizingRightEdge <= nonChain.x || resizingLayout.x >= nonChain.x + nonChain.w);
                  const hasVertOverlap = hasVerticalOverlapBetween(resizingBoundsForHorz, nonChain);

                  if (hasHorizOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                // Check if any two chain widgets overlap
                const positionEntries = Array.from(positions.entries());
                for (let i = 0; i < positionEntries.length; i++) {
                  const [id1, newX1] = positionEntries[i];
                  const widget1 = sortedForSimCorner.find(w => w.id === id1);
                  if (!widget1) continue;

                  for (let j = i + 1; j < positionEntries.length; j++) {
                    const [id2, newX2] = positionEntries[j];
                    const widget2 = sortedForSimCorner.find(w => w.id === id2);
                    if (!widget2) continue;

                    const hasHorizOverlap = !((newX1 + widget1.w) <= newX2 || newX1 >= (newX2 + widget2.w));
                    const hasVertOverlap = !(widget1.y + widget1.h <= widget2.y || widget1.y >= widget2.y + widget2.h);

                    if (hasHorizOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with chain widgets
                for (const [widgetId, newX] of positions.entries()) {
                  const widget = sortedForSimCorner.find(w => w.id === widgetId);
                  if (!widget) continue;

                  const hasHorizOverlap = !(simResizingRightEdge <= newX || resizingLayout.x >= newX + widget.w);
                  const hasVertOverlap = hasVerticalOverlapBetween(resizingBoundsForHorz, widget);

                  if (hasHorizOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                return { valid: true, positions };
              };

              // Check if full expansion is valid
              let simResultCorner = simulateCornerExpansion(maxAllowedExpansionCorner);
              let validatedPositionsCorner: Map<string, number> = simResultCorner.positions;
              let validatedExpansionCorner = maxAllowedExpansionCorner;

              if (!simResultCorner.valid) {
                // Binary search for the maximum valid expansion
                let low = 0;
                let high = maxAllowedExpansionCorner;
                let lastValidExpansion = 0;
                let lastValidPositions = new Map<string, number>();

                while (high - low > 0.1) {
                  const mid = (low + high) / 2;
                  const midResult = simulateCornerExpansion(mid);

                  if (midResult.valid) {
                    lastValidExpansion = mid;
                    lastValidPositions = midResult.positions;
                    low = mid;
                  } else {
                    high = mid;
                  }
                }

                // Check floor of high
                const floorHigh = Math.floor(high);
                if (floorHigh > lastValidExpansion) {
                  const floorResult = simulateCornerExpansion(floorHigh);
                  if (floorResult.valid) {
                    lastValidExpansion = floorHigh;
                    lastValidPositions = floorResult.positions;
                  }
                }

                validatedExpansionCorner = lastValidExpansion;
                validatedPositionsCorner = lastValidPositions;

              }

              // Recalculate values based on validated expansion
              const newPushAmountHorz = Math.max(0, validatedExpansionCorner - gapFillHorz);
              const newClampedW = Math.max(minW, resizingLayout.w + validatedExpansionCorner);

              // Use validated values
              pushAmountHorz = newPushAmountHorz;

              // Store validated positions for use in cascading calc
              for (const [widgetId, newX] of validatedPositionsCorner.entries()) {
                horzPositions.set(widgetId, newX);
              }

              // Limit clampedW to validated width
              if (clampedW > newClampedW) {

                clampedW = newClampedW;
              }
            } else {
              // No widgets to push - can expand freely up to gap (or viewport edge if no gap)

              // Use original width + gap fill
              const maxAchievableWidth = resizingLayout.w + gapFillHorz;
              if (clampedW > maxAchievableWidth) {

                clampedW = maxAchievableWidth;
              }
            }

            // Only push if there's actual push needed (after gap fill)
            // IMPORTANT: Use validated pushAmountHorz value
            if (pushAmountHorz > 0 && horzPositions.size === 0) {
              // Calculate the resizing widget's new right edge
              const resizingNewRightEdge = resizingLayout.x + clampedW;

              // Find ALL widgets that will be pushed - including non-chain widgets touched by resizing widget
              const allWidgetsToPushHorz = [...widgetsToPushHorz];

              // Check if any non-chain widget is touched by resizing widget's new right edge
              // IMPORTANT: Only consider widgets that are to the RIGHT of resizing widget's ORIGINAL right edge
              for (const nonChain of nonChainWidgets) {
                // Only consider widgets to the RIGHT of resizing widget
                if (nonChain.x >= originalRightEdge) {
                  // Check if resizing widget's new right edge touches this non-chain widget
                  if (resizingNewRightEdge > nonChain.x) {
                    // Check vertical overlap with resizing widget
                    if (hasVerticalOverlapBetween(resizingBoundsForHorz, nonChain)) {
                      // This non-chain widget is touched - add to push list
                      if (!allWidgetsToPushHorz.some(w => w.id === nonChain.id)) {

                        allWidgetsToPushHorz.push(nonChain);
                      }
                    }
                  }
                }
              }

              // Sort widgets left to right for cascading calculation (same as horizontal resize)
              // Use a mutable array so we can add more widgets during processing
              const sortedWidgets = allWidgetsToPushHorz.sort((a, b) => a.x - b.x);
              const processedWidgetIdsCorner = new Set<string>();

              // Process widgets from left to right - SAME LOGIC AS HORIZONTAL-ONLY RESIZE
              // IMPORTANT: We dynamically add non-chain widgets when they're touched by ANY pushed widget
              let iCorner = 0;
              while (iCorner < sortedWidgets.length) {
                const w = sortedWidgets[iCorner];

                // Skip if already processed
                if (processedWidgetIdsCorner.has(w.id)) {
                  iCorner++;
                  continue;
                }
                processedWidgetIdsCorner.add(w.id);

                // How much does this widget need to move?
                let pushForThisWidget: number;

                // Check if resizing widget directly touches this widget
                const touchedByResizing = resizingNewRightEdge > w.x && hasVerticalOverlapBetween(resizingBoundsForHorz, w);

                if (touchedByResizing) {
                  // Directly pushed by resizing widget
                  pushForThisWidget = resizingNewRightEdge - w.x;

                } else {
                  // Check if any previous widget in chain touches this one
                  let maxPushFromPrev = 0;
                  for (const prevId of processedWidgetIdsCorner) {
                    if (prevId === w.id) continue;
                    const prevWidget = sortedWidgets.find(sw => sw.id === prevId);
                    if (!prevWidget) continue;

                    const prevNewX = horzPositions.get(prevWidget.id) ?? prevWidget.x;
                    const prevNewRightEdge = prevNewX + prevWidget.w;

                    // Check if prev widget has vertical overlap with current
                    const hasOverlapWithPrev = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                    if (hasOverlapWithPrev && prevNewRightEdge > w.x) {
                      const pushFromPrev = prevNewRightEdge - w.x;
                      if (pushFromPrev > maxPushFromPrev) {
                        maxPushFromPrev = pushFromPrev;
                      }
                    }
                  }
                  pushForThisWidget = maxPushFromPrev;
                  if (pushForThisWidget > 0) {

                  }
                }

                if (pushForThisWidget <= 0) {
                  horzPositions.set(w.id, w.x);

                } else {
                  const maxMove = GRID_CONFIG.cols - w.w - w.x;
                  const actualMove = Math.min(pushForThisWidget, maxMove);
                  const newX = w.x + actualMove;
                  horzPositions.set(w.id, newX);

                  // NOTE: For CORNER resize horizontal component, we do NOT add non-chain widgets
                  // when they're touched by pushed widgets. Only widgets with vertical
                  // overlap with the RESIZING widget should be pushed (same as horizontal-only resize).
                }

                iCorner++;
              }

            }
          } else if (isWestResize) {

            const widgetsToLeft = allWidgets
              .filter(w => w.x + w.w <= originalLeftEdge)
              .sort((a, b) => b.x - a.x);


            // Find gap to first widget with vertical overlap
            let gapToFirstWidget = originalLeftEdge;
            const widgetsWithOverlap = widgetsToLeft.filter(w => hasVerticalOverlapBetween(resizingBoundsForHorz, w));

            if (widgetsWithOverlap.length > 0) {
              widgetsWithOverlap.sort((a, b) => (b.x + b.w) - (a.x + a.w));
              gapToFirstWidget = originalLeftEdge - (widgetsWithOverlap[0].x + widgetsWithOverlap[0].w);

            }

            const gapFillHorz = Math.min(horizontalExpansion, gapToFirstWidget);
            let pushAmountHorz = Math.max(0, horizontalExpansion - gapToFirstWidget);

            // SAME AS HORIZONTAL-ONLY: Only push widgets with DIRECT vertical overlap
            // NO BFS chain detection - just direct overlap with resizing widget
            const widgetsWithVertOverlap = widgetsToLeft.filter(w =>
              hasVerticalOverlapBetween(resizingBoundsForHorz, w)
            );

            // For corner horizontal (west), ALL widgets with vertical overlap are in the push list
            // (same as horizontal-only resize - no BFS needed)
            widgetsToPushHorz.push(...widgetsWithVertOverlap);
            widgetsToPushHorz.sort((a, b) => b.x - a.x);

            // Identify non-chain widgets (widgets NOT in the push chain)
            const pushedIds = new Set(widgetsToPushHorz.map(w => w.id));
            const nonChainWidgets = allWidgets.filter(w => !pushedIds.has(w.id));

            // Calculate available push space (INCLUDING gaps between widgets in chain)
            if (widgetsToPushHorz.length > 0) {
              if (pushAmountHorz > 0) {
                // Sort widgets right to left
                const sortedWidgets = [...widgetsToPushHorz].sort((a, b) => b.x - a.x);

                // Calculate total gaps between widgets in the chain
                let totalGaps = 0;
                for (let i = 0; i < sortedWidgets.length - 1; i++) {
                  const currentLeftEdge = sortedWidgets[i].x;
                  const nextRightEdge = sortedWidgets[i + 1].x + sortedWidgets[i + 1].w;
                  const gap = currentLeftEdge - nextRightEdge;
                  if (gap > 0) {
                    totalGaps += gap;
                  }
                }

                // Space at the end (leftmost widget's x position - 0)
                const leftmostEdge = Math.min(...widgetsToPushHorz.map(w => w.x));
                let blockingEdge = 0;

                // Check for non-chain widgets blocking
                for (const nonChain of nonChainWidgets) {
                  const hasOverlapWithChain = widgetsToPushHorz.some(chainWidget =>
                    hasVerticalOverlapBetween(chainWidget, nonChain)
                  );
                  if (hasOverlapWithChain && nonChain.x + nonChain.w <= leftmostEdge) {
                    blockingEdge = Math.max(blockingEdge, nonChain.x + nonChain.w);
                  }
                }

                const spaceAtEnd = leftmostEdge - blockingEdge;
                const availablePushSpace = totalGaps + spaceAtEnd;

                pushAmountHorz = Math.min(pushAmountHorz, availablePushSpace);

                // Check collision with non-chain widgets
                for (const pushedWidget of widgetsToPushHorz) {
                  const pushedNewX = pushedWidget.x - pushAmountHorz;
                  const clampedPushedX = Math.max(0, pushedNewX);

                  for (const nonChain of nonChainWidgets) {
                    const pushedLeftEdge = clampedPushedX;
                    const pushedRightEdge = clampedPushedX + pushedWidget.w;
                    const nonChainLeftEdge = nonChain.x;
                    const nonChainRightEdge = nonChain.x + nonChain.w;

                    const hasHorzOverlap = !(pushedRightEdge <= nonChainLeftEdge || pushedLeftEdge >= nonChainRightEdge);
                    const hasVertOverlap = !(pushedWidget.y + pushedWidget.h <= nonChain.y || pushedWidget.y >= nonChain.y + nonChain.h);

                    if (hasHorzOverlap && hasVertOverlap) {
                      const maxPushedX = nonChainRightEdge;
                      const maxPush = Math.max(0, pushedWidget.x - maxPushedX);
                      if (maxPush < pushAmountHorz) {

                        pushAmountHorz = maxPush;
                      }
                    }
                  }
                }

                // Also check if resizing widget itself collides with non-chain widgets
                const resizingNewLeftEdge = resizingLayout.x - (gapFillHorz + pushAmountHorz);
                for (const nonChain of nonChainWidgets) {
                  const hasHorzOverlap = !(resizingLayout.x + resizingLayout.w <= nonChain.x || resizingNewLeftEdge >= nonChain.x + nonChain.w);
                  const hasVertOverlap = hasVerticalOverlapBetween(resizingBoundsForHorz, nonChain);

                  if (hasHorzOverlap && hasVertOverlap) {
                    const maxX = nonChain.x + nonChain.w;
                    const maxAchievable = Math.max(resizingLayout.w, resizingLayout.x + resizingLayout.w - maxX);
                    const newPushAmount = Math.max(0, maxAchievable - resizingLayout.w - gapFillHorz);
                    if (newPushAmount < pushAmountHorz) {

                      pushAmountHorz = newPushAmount;
                    }
                  }
                }
              }

              // CRITICAL: Dynamic blocking simulation for CORNER WEST HORIZONTAL

              const sortedForSimWest = [...widgetsToPushHorz].sort((a, b) => b.x - a.x);
              const maxAllowedExpansionWest = gapFillHorz + pushAmountHorz;

              const simulateWestExpansion = (expansion: number): { valid: boolean; positions: Map<string, number> } => {
                const positions = new Map<string, number>();
                const simFinalW = Math.max(minW, resizingLayout.w + expansion);
                const simResizingLeftEdge = resizingLayout.x + resizingLayout.w - simFinalW;

                for (const widget of sortedForSimWest) {
                  let pushForWidget = 0;

                  // Check if directly touched by resizing widget (widget's right > resizing's new left)
                  const widgetRight = widget.x + widget.w;
                  if (simResizingLeftEdge < widgetRight && hasVerticalOverlapBetween(resizingBoundsForHorz, widget)) {
                    pushForWidget = widgetRight - simResizingLeftEdge;
                  }

                  // Check cascade from other widgets
                  for (const [prevId, prevNewX] of positions.entries()) {
                    const prevWidget = sortedForSimWest.find(w => w.id === prevId);
                    if (!prevWidget) continue;

                    const hasOverlapWithPrev = !(prevWidget.y + prevWidget.h <= widget.y || prevWidget.y >= widget.y + widget.h);
                    if (!hasOverlapWithPrev) continue;

                    // For west: prev widget's new left edge might push current widget left
                    const widgetRightEdge = widget.x + widget.w;
                    if (prevNewX < widgetRightEdge) {
                      pushForWidget = Math.max(pushForWidget, widgetRightEdge - prevNewX);
                    }
                  }

                  const newX = widget.x - pushForWidget;
                  if (newX < 0) {
                    return { valid: false, positions };
                  }

                  positions.set(widget.id, newX);
                }

                // Check overlap with non-chain widgets
                for (const [widgetId, newX] of positions.entries()) {
                  const widget = sortedForSimWest.find(w => w.id === widgetId);
                  if (!widget) continue;

                  for (const nonChain of nonChainWidgets) {
                    const pushedLeft = newX;
                    const pushedRight = newX + widget.w;
                    const hasHorzOverlap = !(pushedRight <= nonChain.x || pushedLeft >= nonChain.x + nonChain.w);
                    const hasVertOverlap = !(widget.y + widget.h <= nonChain.y || widget.y >= nonChain.y + nonChain.h);

                    if (hasHorzOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with non-chain widgets
                const simResizingRight = resizingLayout.x + resizingLayout.w;
                for (const nonChain of nonChainWidgets) {
                  const hasHorzOverlap = !(simResizingRight <= nonChain.x || simResizingLeftEdge >= nonChain.x + nonChain.w);
                  const hasVertOverlap = hasVerticalOverlapBetween(resizingBoundsForHorz, nonChain);

                  if (hasHorzOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                // Check if any two chain widgets overlap
                const positionEntries = Array.from(positions.entries());
                for (let i = 0; i < positionEntries.length; i++) {
                  const [id1, newX1] = positionEntries[i];
                  const widget1 = sortedForSimWest.find(w => w.id === id1);
                  if (!widget1) continue;

                  for (let j = i + 1; j < positionEntries.length; j++) {
                    const [id2, newX2] = positionEntries[j];
                    const widget2 = sortedForSimWest.find(w => w.id === id2);
                    if (!widget2) continue;

                    const hasHorzOverlap = !((newX1 + widget1.w) <= newX2 || newX1 >= (newX2 + widget2.w));
                    const hasVertOverlap = !(widget1.y + widget1.h <= widget2.y || widget1.y >= widget2.y + widget2.h);

                    if (hasHorzOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with chain widgets
                for (const [widgetId, newX] of positions.entries()) {
                  const widget = sortedForSimWest.find(w => w.id === widgetId);
                  if (!widget) continue;

                  const hasHorzOverlap = !(simResizingRight <= newX || simResizingLeftEdge >= newX + widget.w);
                  const hasVertOverlap = hasVerticalOverlapBetween(resizingBoundsForHorz, widget);

                  if (hasHorzOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                return { valid: true, positions };
              };

              let simResultWest = simulateWestExpansion(maxAllowedExpansionWest);
              let validatedPositionsWest: Map<string, number> = simResultWest.positions;
              let validatedExpansionWest = maxAllowedExpansionWest;

              if (!simResultWest.valid) {
                let low = 0;
                let high = maxAllowedExpansionWest;
                let lastValidExpansion = 0;
                let lastValidPositions = new Map<string, number>();

                while (high - low > 0.1) {
                  const mid = (low + high) / 2;
                  const midResult = simulateWestExpansion(mid);

                  if (midResult.valid) {
                    lastValidExpansion = mid;
                    lastValidPositions = midResult.positions;
                    low = mid;
                  } else {
                    high = mid;
                  }
                }

                const floorHigh = Math.floor(high);
                if (floorHigh > lastValidExpansion) {
                  const floorResult = simulateWestExpansion(floorHigh);
                  if (floorResult.valid) {
                    lastValidExpansion = floorHigh;
                    lastValidPositions = floorResult.positions;
                  }
                }

                validatedExpansionWest = lastValidExpansion;
                validatedPositionsWest = lastValidPositions;

              }

              const newPushAmountHorzWest = Math.max(0, validatedExpansionWest - gapFillHorz);
              const newClampedWWest = Math.max(minW, resizingLayout.w + validatedExpansionWest);

              pushAmountHorz = newPushAmountHorzWest;

              for (const [widgetId, newX] of validatedPositionsWest.entries()) {
                horzPositions.set(widgetId, newX);
              }

              if (clampedW > newClampedWWest) {

                clampedW = newClampedWWest;
              }
            } else {
              // No widgets to push - can expand freely up to gap (or viewport edge if no gap)

              const maxAchievableWidth = resizingLayout.w + gapFillHorz;
              if (clampedW > maxAchievableWidth) {

                clampedW = maxAchievableWidth;
              }
            }

            // Only push if there's actual push needed (after gap fill)
            // IMPORTANT: Use validated positions if available
            if (pushAmountHorz > 0 && horzPositions.size === 0) {
              // Calculate the resizing widget's new left edge
              const resizingNewLeftEdge = resizingLayout.x + resizingLayout.w - clampedW;

              // Sort widgets right to left for cascading calculation
              const sortedWidgets = [...widgetsToPushHorz].sort((a, b) => b.x - a.x);

              for (let i = 0; i < sortedWidgets.length; i++) {
                const w = sortedWidgets[i];

                // Find the widget that would actually push this widget
                let pushForThisWidget = pushAmountHorz; // Default: pushed by resizing widget

                // Check if any already-processed widget is to the right AND has vertical overlap
                let pushedByWidget: typeof w | null = null;
                let maxPushFromChain = 0;

                for (let j = 0; j < i; j++) {
                  const prevWidget = sortedWidgets[j];
                  const prevNewX = horzPositions.get(prevWidget.id) ?? prevWidget.x;
                  const prevNewLeftEdge = prevNewX;

                  // Check if prevWidget has vertical overlap with current widget
                  const hasVertOverlap = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                  // Check if prevWidget is actually to the right (before pushing) AND its new left edge reaches us
                  const wRightEdge = w.x + w.w;
                  if (hasVertOverlap && prevWidget.x >= wRightEdge) {
                    if (prevNewLeftEdge < wRightEdge) {
                      const cascadePush = wRightEdge - prevNewLeftEdge;
                      if (cascadePush > maxPushFromChain) {
                        maxPushFromChain = cascadePush;
                        pushedByWidget = prevWidget;
                      }
                    }
                  }
                }

                // If we found a widget that cascades into us, use that push
                // Otherwise, check if resizing widget directly pushes us
                if (pushedByWidget && maxPushFromChain > 0) {
                  pushForThisWidget = maxPushFromChain;

                } else {
                  // Check if resizing widget's new left edge reaches us
                  const wRightEdge = w.x + w.w;
                  if (resizingNewLeftEdge < wRightEdge) {
                    pushForThisWidget = wRightEdge - resizingNewLeftEdge;

                  } else {
                    pushForThisWidget = 0;

                  }
                }

                if (pushForThisWidget <= 0) {
                  horzPositions.set(w.id, w.x);

                } else {
                  const maxMove = w.x; // Can only move left to x=0
                  const actualMove = Math.min(pushForThisWidget, maxMove);
                  const newX = w.x - actualMove;
                  horzPositions.set(w.id, newX);

                }
              }

            }

          }
        }

        // Calculate vertical push with FULL CASCADING logic (same as vertical-only resize)
        // INCLUDING GAP FILL - first fill gap to first widget, then push
        const vertPositions: Map<string, number> = new Map();
        const resizingBoundsForVert = { x: clampedX, w: clampedW };

        // Use ORIGINAL edges (same as vertical-only resize)
        const originalBottomEdge = resizingLayout.y + resizingLayout.h;
        const originalTopEdge = resizingLayout.y;

        // Check if user is REQUESTING vertical expansion (use requestedH, not clampedH)
        // This allows continuous resize - as user drags further, expansion keeps increasing
        if (requestedH > resizingLayout.h) {
          const verticalExpansion = requestedH - resizingLayout.h;

          // Collect ALL widgets to push using BFS chain detection
          const widgetsToPushVert: typeof allWidgets = [];

          if (isSouthResize) {

            const widgetsBelow = allWidgets
              .filter(w => w.y >= originalBottomEdge)
              .sort((a, b) => a.y - b.y);


            // Find gap to first widget with horizontal overlap
            let gapToFirstWidget = maxRows - originalBottomEdge;
            const widgetsWithOverlap = widgetsBelow.filter(w => hasHorizontalOverlapBetween(resizingBoundsForVert, w));

            if (widgetsWithOverlap.length > 0) {
              widgetsWithOverlap.sort((a, b) => a.y - b.y);
              gapToFirstWidget = widgetsWithOverlap[0].y - originalBottomEdge;

            }

            // Calculate gap fill vs push
            const gapFillVert = Math.min(verticalExpansion, gapToFirstWidget);
            let pushAmountVert = Math.max(0, verticalExpansion - gapToFirstWidget);

            // BFS chain detection - same as vertical resize
            // Start with ALL widgets that have horizontal overlap with resizing widget (not just adjacent)
            const directPushWidgets = widgetsBelow.filter(w =>
              hasHorizontalOverlapBetween(resizingBoundsForVert, w)
            );


            const pushedSet = new Set<string>();
            const queue = [...directPushWidgets];

            while (queue.length > 0) {
              const current = queue.shift()!;
              if (pushedSet.has(current.id)) continue;
              pushedSet.add(current.id);
              widgetsToPushVert.push(current);

              const currentBottomEdge = current.y + current.h;
              for (const other of widgetsBelow) {
                if (pushedSet.has(other.id)) continue;
                const isBelow = other.y >= currentBottomEdge;
                const hasOverlap = !(current.x + current.w <= other.x || current.x >= other.x + other.w);
                if (isBelow && hasOverlap) queue.push(other);
              }
            }

            widgetsToPushVert.sort((a, b) => a.y - b.y);

            // Identify non-chain widgets (widgets NOT in the push chain)
            const pushedIdsVert = new Set(widgetsToPushVert.map(w => w.id));
            const nonChainWidgetsVert = allWidgets.filter(w => !pushedIdsVert.has(w.id));

            // Calculate available push space (INCLUDING gaps between widgets in chain - same as vertical resize)
            if (widgetsToPushVert.length > 0) {
              // There are widgets to push
              if (pushAmountVert > 0) {
                // Sort widgets top to bottom
                const sortedWidgets = [...widgetsToPushVert].sort((a, b) => a.y - b.y);

                // Calculate total gaps between widgets in the chain
                let totalGaps = 0;
                for (let i = 0; i < sortedWidgets.length - 1; i++) {
                  const currentBottomEdge = sortedWidgets[i].y + sortedWidgets[i].h;
                  const nextTopEdge = sortedWidgets[i + 1].y;
                  const gap = nextTopEdge - currentBottomEdge;
                  if (gap > 0) {
                    totalGaps += gap;
                  }
                }

                // Space at the end (viewport edge - bottommost widget)
                const bottommostEdge = Math.max(...widgetsToPushVert.map(w => w.y + w.h));
                let blockingEdge = maxRows;

                // Check for non-chain widgets blocking
                for (const nonChain of nonChainWidgetsVert) {
                  const hasOverlapWithChain = widgetsToPushVert.some(chainWidget =>
                    hasHorizontalOverlapBetween(chainWidget, nonChain)
                  );
                  if (hasOverlapWithChain && nonChain.y >= bottommostEdge) {
                    blockingEdge = Math.min(blockingEdge, nonChain.y);
                  }
                }

                const spaceAtEnd = blockingEdge - bottommostEdge;
                const availablePushSpace = totalGaps + spaceAtEnd;

                pushAmountVert = Math.min(pushAmountVert, availablePushSpace);

                // Check collision with non-chain widgets
                for (const pushedWidget of widgetsToPushVert) {
                  const pushedNewY = pushedWidget.y + pushAmountVert;
                  const clampedPushedY = Math.min(pushedNewY, maxRows - pushedWidget.h);

                  for (const nonChain of nonChainWidgetsVert) {
                    const pushedTopEdge = clampedPushedY;
                    const pushedBottomEdge = clampedPushedY + pushedWidget.h;
                    const nonChainTopEdge = nonChain.y;
                    const nonChainBottomEdge = nonChain.y + nonChain.h;

                    const hasVertOverlap = !(pushedBottomEdge <= nonChainTopEdge || pushedTopEdge >= nonChainBottomEdge);
                    const hasHorzOverlap = !(pushedWidget.x + pushedWidget.w <= nonChain.x || pushedWidget.x >= nonChain.x + nonChain.w);

                    if (hasHorzOverlap && hasVertOverlap) {
                      const maxPushedY = nonChainTopEdge - pushedWidget.h;
                      const maxPush = Math.max(0, maxPushedY - pushedWidget.y);
                      if (maxPush < pushAmountVert) {

                        pushAmountVert = maxPush;
                      }
                    }
                  }
                }

                // Also check if resizing widget itself collides with non-chain widgets
                const resizingNewBottomEdge = resizingLayout.y + resizingLayout.h + gapFillVert + pushAmountVert;
                for (const nonChain of nonChainWidgetsVert) {
                  const hasVertOverlap = !(resizingNewBottomEdge <= nonChain.y || resizingLayout.y >= nonChain.y + nonChain.h);
                  const hasHorzOverlap = hasHorizontalOverlapBetween(resizingBoundsForVert, nonChain);

                  if (hasHorzOverlap && hasVertOverlap) {
                    const maxH = nonChain.y - resizingLayout.y;
                    const maxAchievable = Math.max(resizingLayout.h, maxH);
                    const newPushAmount = Math.max(0, maxAchievable - resizingLayout.h - gapFillVert);
                    if (newPushAmount < pushAmountVert) {

                      pushAmountVert = newPushAmount;
                    }
                  }
                }
              }

              // CRITICAL: Dynamic blocking simulation for CORNER SOUTH VERTICAL

              const sortedForSimSouth = [...widgetsToPushVert].sort((a, b) => a.y - b.y);
              const maxAllowedExpansionSouth = gapFillVert + pushAmountVert;

              const simulateSouthExpansion = (expansion: number): { valid: boolean; positions: Map<string, number> } => {
                const positions = new Map<string, number>();
                const simFinalH = Math.max(minH, resizingLayout.h + expansion);
                const simResizingBottomEdge = resizingLayout.y + simFinalH;

                for (const widget of sortedForSimSouth) {
                  let pushForWidget = 0;

                  // Check if directly touched by resizing widget
                  if (simResizingBottomEdge > widget.y && hasHorizontalOverlapBetween(resizingBoundsForVert, widget)) {
                    pushForWidget = simResizingBottomEdge - widget.y;
                  }

                  // Check cascade from other widgets
                  for (const [prevId, prevNewY] of positions.entries()) {
                    const prevWidget = sortedForSimSouth.find(w => w.id === prevId);
                    if (!prevWidget) continue;

                    const hasOverlapWithPrev = !(prevWidget.x + prevWidget.w <= widget.x || prevWidget.x >= widget.x + widget.w);
                    if (!hasOverlapWithPrev) continue;

                    const prevNewBottom = prevNewY + prevWidget.h;
                    if (prevNewBottom > widget.y) {
                      pushForWidget = Math.max(pushForWidget, prevNewBottom - widget.y);
                    }
                  }

                  const newY = widget.y + pushForWidget;
                  if (newY + widget.h > maxRows) {
                    return { valid: false, positions };
                  }

                  positions.set(widget.id, newY);
                }

                // Check overlap with non-chain widgets
                for (const [widgetId, newY] of positions.entries()) {
                  const widget = sortedForSimSouth.find(w => w.id === widgetId);
                  if (!widget) continue;

                  for (const nonChain of nonChainWidgetsVert) {
                    const pushedBottom = newY + widget.h;
                    const hasVertOverlap = !(pushedBottom <= nonChain.y || newY >= nonChain.y + nonChain.h);
                    const hasHorzOverlap = !(widget.x + widget.w <= nonChain.x || widget.x >= nonChain.x + nonChain.w);

                    if (hasHorzOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with non-chain widgets
                for (const nonChain of nonChainWidgetsVert) {
                  const hasVertOverlap = !(simResizingBottomEdge <= nonChain.y || resizingLayout.y >= nonChain.y + nonChain.h);
                  const hasHorzOverlap = hasHorizontalOverlapBetween(resizingBoundsForVert, nonChain);

                  if (hasHorzOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                // Check if any two chain widgets overlap
                const positionEntries = Array.from(positions.entries());
                for (let i = 0; i < positionEntries.length; i++) {
                  const [id1, newY1] = positionEntries[i];
                  const widget1 = sortedForSimSouth.find(w => w.id === id1);
                  if (!widget1) continue;

                  for (let j = i + 1; j < positionEntries.length; j++) {
                    const [id2, newY2] = positionEntries[j];
                    const widget2 = sortedForSimSouth.find(w => w.id === id2);
                    if (!widget2) continue;

                    const hasVertOverlap = !((newY1 + widget1.h) <= newY2 || newY1 >= (newY2 + widget2.h));
                    const hasHorzOverlap = !(widget1.x + widget1.w <= widget2.x || widget1.x >= widget2.x + widget2.w);

                    if (hasHorzOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with chain widgets
                for (const [widgetId, newY] of positions.entries()) {
                  const widget = sortedForSimSouth.find(w => w.id === widgetId);
                  if (!widget) continue;

                  const hasVertOverlap = !(simResizingBottomEdge <= newY || resizingLayout.y >= newY + widget.h);
                  const hasHorzOverlap = hasHorizontalOverlapBetween(resizingBoundsForVert, widget);

                  if (hasHorzOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                return { valid: true, positions };
              };

              let simResultSouth = simulateSouthExpansion(maxAllowedExpansionSouth);
              let validatedPositionsSouth: Map<string, number> = simResultSouth.positions;
              let validatedExpansionSouth = maxAllowedExpansionSouth;

              if (!simResultSouth.valid) {
                let low = 0;
                let high = maxAllowedExpansionSouth;
                let lastValidExpansion = 0;
                let lastValidPositions = new Map<string, number>();

                while (high - low > 0.1) {
                  const mid = (low + high) / 2;
                  const midResult = simulateSouthExpansion(mid);

                  if (midResult.valid) {
                    lastValidExpansion = mid;
                    lastValidPositions = midResult.positions;
                    low = mid;
                  } else {
                    high = mid;
                  }
                }

                const floorHigh = Math.floor(high);
                if (floorHigh > lastValidExpansion) {
                  const floorResult = simulateSouthExpansion(floorHigh);
                  if (floorResult.valid) {
                    lastValidExpansion = floorHigh;
                    lastValidPositions = floorResult.positions;
                  }
                }

                validatedExpansionSouth = lastValidExpansion;
                validatedPositionsSouth = lastValidPositions;

              }

              const newPushAmountVert = Math.max(0, validatedExpansionSouth - gapFillVert);
              const newClampedH = Math.max(minH, resizingLayout.h + validatedExpansionSouth);

              pushAmountVert = newPushAmountVert;

              for (const [widgetId, newY] of validatedPositionsSouth.entries()) {
                vertPositions.set(widgetId, newY);
              }

              if (clampedH > newClampedH) {

                clampedH = newClampedH;
              }
            } else {
              // No widgets to push - can expand freely up to gap (or viewport edge if no gap)

              // Use original height + gap fill
              const maxAchievableHeight = resizingLayout.h + gapFillVert;
              if (clampedH > maxAchievableHeight) {

                clampedH = maxAchievableHeight;
              }
            }

            // Only push if there's actual push needed (after gap fill)
            // IMPORTANT: Use validated positions if available
            if (pushAmountVert > 0 && vertPositions.size === 0) {
              // Sort widgets top to bottom for cascading calculation (same as vertical resize)
              const sortedWidgets = [...widgetsToPushVert].sort((a, b) => a.y - b.y);

              // Calculate the resizing widget's new bottom edge (same as vertical-only resize)
              const resizingNewBottomEdge = resizingLayout.y + clampedH;

              // Process widgets from top to bottom - SAME LOGIC AS VERTICAL-ONLY RESIZE
              for (let i = 0; i < sortedWidgets.length; i++) {
                const w = sortedWidgets[i];

                // Find the widget that would actually push this widget
                // It must be: above this widget AND have horizontal overlap with this widget
                let pushForThisWidget = pushAmountVert; // Default: pushed by resizing widget

                // Check if any already-processed widget is above AND has horizontal overlap
                let pushedByWidget: typeof w | null = null;
                let maxPushFromChain = 0;

                for (let j = 0; j < i; j++) {
                  const prevWidget = sortedWidgets[j];
                  const prevNewY = vertPositions.get(prevWidget.id) ?? prevWidget.y;
                  const prevNewBottomEdge = prevNewY + prevWidget.h;

                  // Check if prevWidget has horizontal overlap with current widget
                  const hasHorzOverlap = !(prevWidget.x + prevWidget.w <= w.x || prevWidget.x >= w.x + w.w);

                  // Check if prevWidget is actually above (before pushing) AND its new bottom edge reaches us
                  if (hasHorzOverlap && prevWidget.y + prevWidget.h <= w.y) {
                    if (prevNewBottomEdge > w.y) {
                      const cascadePush = prevNewBottomEdge - w.y;
                      if (cascadePush > maxPushFromChain) {
                        maxPushFromChain = cascadePush;
                        pushedByWidget = prevWidget;
                      }
                    }
                  }
                }

                // If we found a widget that cascades into us, use that push
                // Otherwise, check if resizing widget directly pushes us
                if (pushedByWidget && maxPushFromChain > 0) {
                  pushForThisWidget = maxPushFromChain;

                } else {
                  // Check if resizing widget's new bottom edge reaches us
                  if (resizingNewBottomEdge > w.y) {
                    pushForThisWidget = resizingNewBottomEdge - w.y;

                  } else {
                    pushForThisWidget = 0;

                  }
                }

                if (pushForThisWidget <= 0) {
                  vertPositions.set(w.id, w.y);

                } else {
                  const maxMove = maxRows - w.h - w.y;
                  const actualMove = Math.min(pushForThisWidget, maxMove);
                  const newY = w.y + actualMove;
                  vertPositions.set(w.id, newY);

                }
              }

            }
          } else if (isNorthResize) {

            const widgetsAbove = allWidgets
              .filter(w => w.y + w.h <= originalTopEdge)
              .sort((a, b) => b.y - a.y);


            // Find gap to first widget with horizontal overlap
            let gapToFirstWidget = originalTopEdge;
            const widgetsWithOverlap = widgetsAbove.filter(w => hasHorizontalOverlapBetween(resizingBoundsForVert, w));

            if (widgetsWithOverlap.length > 0) {
              widgetsWithOverlap.sort((a, b) => (b.y + b.h) - (a.y + a.h));
              gapToFirstWidget = originalTopEdge - (widgetsWithOverlap[0].y + widgetsWithOverlap[0].h);

            }

            const gapFillVert = Math.min(verticalExpansion, gapToFirstWidget);
            let pushAmountVert = Math.max(0, verticalExpansion - gapToFirstWidget);

            const directPushWidgets = widgetsAbove.filter(w => hasHorizontalOverlapBetween(resizingBoundsForVert, w));

            const pushedSet = new Set<string>();
            const queue = [...directPushWidgets];

            while (queue.length > 0) {
              const current = queue.shift()!;
              if (pushedSet.has(current.id)) continue;
              pushedSet.add(current.id);
              widgetsToPushVert.push(current);

              for (const other of widgetsAbove) {
                if (pushedSet.has(other.id)) continue;
                if (other.y + other.h > current.y) continue;
                const hasOverlap = !(current.x + current.w <= other.x || current.x >= other.x + other.w);
                if (hasOverlap) queue.push(other);
              }
            }

            widgetsToPushVert.sort((a, b) => b.y - a.y);

            // Identify non-chain widgets (widgets NOT in the push chain)
            const pushedIdsVert = new Set(widgetsToPushVert.map(w => w.id));
            const nonChainWidgetsVert = allWidgets.filter(w => !pushedIdsVert.has(w.id));

            // Calculate available push space (INCLUDING gaps between widgets in chain - same as south resize)
            if (widgetsToPushVert.length > 0) {
              if (pushAmountVert > 0) {
                // Sort widgets bottom to top
                const sortedWidgets = [...widgetsToPushVert].sort((a, b) => b.y - a.y);

                // Calculate total gaps between widgets in the chain
                let totalGaps = 0;
                for (let i = 0; i < sortedWidgets.length - 1; i++) {
                  const currentTopEdge = sortedWidgets[i].y;
                  const nextBottomEdge = sortedWidgets[i + 1].y + sortedWidgets[i + 1].h;
                  const gap = currentTopEdge - nextBottomEdge;

                  if (gap > 0) {
                    totalGaps += gap;
                  }
                }

                // Space at the end (topmost widget's y position - 0)
                const topmostEdge = Math.min(...widgetsToPushVert.map(w => w.y));
                let blockingEdge = 0;

                // Check for non-chain widgets blocking
                for (const nonChain of nonChainWidgetsVert) {
                  const hasOverlapWithChain = widgetsToPushVert.some(chainWidget =>
                    hasHorizontalOverlapBetween(chainWidget, nonChain)
                  );
                  if (hasOverlapWithChain && nonChain.y + nonChain.h <= topmostEdge) {
                    blockingEdge = Math.max(blockingEdge, nonChain.y + nonChain.h);
                  }
                }

                const spaceAtEnd = topmostEdge - blockingEdge;
                const availablePushSpace = totalGaps + spaceAtEnd;

                pushAmountVert = Math.min(pushAmountVert, availablePushSpace);

                // Check collision with non-chain widgets
                for (const pushedWidget of widgetsToPushVert) {
                  const pushedNewY = pushedWidget.y - pushAmountVert;
                  const clampedPushedY = Math.max(0, pushedNewY);

                  for (const nonChain of nonChainWidgetsVert) {
                    const pushedTopEdge = clampedPushedY;
                    const pushedBottomEdge = clampedPushedY + pushedWidget.h;
                    const nonChainTopEdge = nonChain.y;
                    const nonChainBottomEdge = nonChain.y + nonChain.h;

                    const hasVertOverlap = !(pushedBottomEdge <= nonChainTopEdge || pushedTopEdge >= nonChainBottomEdge);
                    const hasHorzOverlap = !(pushedWidget.x + pushedWidget.w <= nonChain.x || pushedWidget.x >= nonChain.x + nonChain.w);

                    if (hasHorzOverlap && hasVertOverlap) {
                      const maxPushedY = nonChainBottomEdge;
                      const maxPush = Math.max(0, pushedWidget.y - maxPushedY);
                      if (maxPush < pushAmountVert) {

                        pushAmountVert = maxPush;
                      }
                    }
                  }
                }

                // Also check if resizing widget itself collides with non-chain widgets
                const resizingNewTopEdge = resizingLayout.y + resizingLayout.h - (resizingLayout.h + gapFillVert + pushAmountVert);
                for (const nonChain of nonChainWidgetsVert) {
                  const resizingNewBottomEdge = resizingLayout.y + resizingLayout.h;
                  const hasVertOverlap = !(resizingNewBottomEdge <= nonChain.y || resizingNewTopEdge >= nonChain.y + nonChain.h);
                  const hasHorzOverlap = hasHorizontalOverlapBetween(resizingBoundsForVert, nonChain);

                  if (hasHorzOverlap && hasVertOverlap) {
                    const maxH = resizingLayout.y + resizingLayout.h - (nonChain.y + nonChain.h);
                    const maxAchievable = Math.max(resizingLayout.h, maxH);
                    const newPushAmount = Math.max(0, maxAchievable - resizingLayout.h - gapFillVert);
                    if (newPushAmount < pushAmountVert) {

                      pushAmountVert = newPushAmount;
                    }
                  }
                }
              }

              // CRITICAL: Dynamic blocking simulation for CORNER NORTH VERTICAL

              const sortedForSimNorth = [...widgetsToPushVert].sort((a, b) => b.y - a.y);
              const maxAllowedExpansionNorth = gapFillVert + pushAmountVert;

              const simulateNorthExpansion = (expansion: number): { valid: boolean; positions: Map<string, number> } => {
                const positions = new Map<string, number>();
                const simFinalH = Math.max(minH, resizingLayout.h + expansion);
                const simResizingTopEdge = resizingLayout.y + resizingLayout.h - simFinalH;

                for (const widget of sortedForSimNorth) {
                  let pushForWidget = 0;

                  // Check if directly touched by resizing widget (widget's bottom > resizing's new top)
                  const widgetBottom = widget.y + widget.h;
                  if (simResizingTopEdge < widgetBottom && hasHorizontalOverlapBetween(resizingBoundsForVert, widget)) {
                    pushForWidget = widgetBottom - simResizingTopEdge;
                  }

                  // Check cascade from other widgets
                  for (const [prevId, prevNewY] of positions.entries()) {
                    const prevWidget = sortedForSimNorth.find(w => w.id === prevId);
                    if (!prevWidget) continue;

                    const hasOverlapWithPrev = !(prevWidget.x + prevWidget.w <= widget.x || prevWidget.x >= widget.x + widget.w);
                    if (!hasOverlapWithPrev) continue;

                    // For north: prev widget's new top edge might push current widget up
                    const widgetBottomEdge = widget.y + widget.h;
                    if (prevNewY < widgetBottomEdge) {
                      pushForWidget = Math.max(pushForWidget, widgetBottomEdge - prevNewY);
                    }
                  }

                  const newY = widget.y - pushForWidget;
                  if (newY < 0) {
                    return { valid: false, positions };
                  }

                  positions.set(widget.id, newY);
                }

                // Check overlap with non-chain widgets
                for (const [widgetId, newY] of positions.entries()) {
                  const widget = sortedForSimNorth.find(w => w.id === widgetId);
                  if (!widget) continue;

                  for (const nonChain of nonChainWidgetsVert) {
                    const pushedTop = newY;
                    const pushedBottom = newY + widget.h;
                    const hasVertOverlap = !(pushedBottom <= nonChain.y || pushedTop >= nonChain.y + nonChain.h);
                    const hasHorzOverlap = !(widget.x + widget.w <= nonChain.x || widget.x >= nonChain.x + nonChain.w);

                    if (hasHorzOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with non-chain widgets
                const simResizingBottom = resizingLayout.y + resizingLayout.h;
                for (const nonChain of nonChainWidgetsVert) {
                  const hasVertOverlap = !(simResizingBottom <= nonChain.y || simResizingTopEdge >= nonChain.y + nonChain.h);
                  const hasHorzOverlap = hasHorizontalOverlapBetween(resizingBoundsForVert, nonChain);

                  if (hasHorzOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                // Check if any two chain widgets overlap
                const positionEntries = Array.from(positions.entries());
                for (let i = 0; i < positionEntries.length; i++) {
                  const [id1, newY1] = positionEntries[i];
                  const widget1 = sortedForSimNorth.find(w => w.id === id1);
                  if (!widget1) continue;

                  for (let j = i + 1; j < positionEntries.length; j++) {
                    const [id2, newY2] = positionEntries[j];
                    const widget2 = sortedForSimNorth.find(w => w.id === id2);
                    if (!widget2) continue;

                    const hasVertOverlap = !((newY1 + widget1.h) <= newY2 || newY1 >= (newY2 + widget2.h));
                    const hasHorzOverlap = !(widget1.x + widget1.w <= widget2.x || widget1.x >= widget2.x + widget2.w);

                    if (hasHorzOverlap && hasVertOverlap) {
                      return { valid: false, positions };
                    }
                  }
                }

                // Check if resizing widget overlaps with chain widgets
                for (const [widgetId, newY] of positions.entries()) {
                  const widget = sortedForSimNorth.find(w => w.id === widgetId);
                  if (!widget) continue;

                  const hasVertOverlap = !(simResizingBottom <= newY || simResizingTopEdge >= newY + widget.h);
                  const hasHorzOverlap = hasHorizontalOverlapBetween(resizingBoundsForVert, widget);

                  if (hasHorzOverlap && hasVertOverlap) {
                    return { valid: false, positions };
                  }
                }

                return { valid: true, positions };
              };

              let simResultNorth = simulateNorthExpansion(maxAllowedExpansionNorth);
              let validatedPositionsNorth: Map<string, number> = simResultNorth.positions;
              let validatedExpansionNorth = maxAllowedExpansionNorth;

              if (!simResultNorth.valid) {
                let low = 0;
                let high = maxAllowedExpansionNorth;
                let lastValidExpansion = 0;
                let lastValidPositions = new Map<string, number>();

                while (high - low > 0.1) {
                  const mid = (low + high) / 2;
                  const midResult = simulateNorthExpansion(mid);

                  if (midResult.valid) {
                    lastValidExpansion = mid;
                    lastValidPositions = midResult.positions;
                    low = mid;
                  } else {
                    high = mid;
                  }
                }

                const floorHigh = Math.floor(high);
                if (floorHigh > lastValidExpansion) {
                  const floorResult = simulateNorthExpansion(floorHigh);
                  if (floorResult.valid) {
                    lastValidExpansion = floorHigh;
                    lastValidPositions = floorResult.positions;
                  }
                }

                validatedExpansionNorth = lastValidExpansion;
                validatedPositionsNorth = lastValidPositions;

              }

              const newPushAmountVertNorth = Math.max(0, validatedExpansionNorth - gapFillVert);
              const newClampedHNorth = Math.max(minH, resizingLayout.h + validatedExpansionNorth);

              pushAmountVert = newPushAmountVertNorth;

              for (const [widgetId, newY] of validatedPositionsNorth.entries()) {
                vertPositions.set(widgetId, newY);
              }

              if (clampedH > newClampedHNorth) {

                clampedH = newClampedHNorth;
              }
            } else {
              // No widgets to push - can expand freely up to gap (or viewport edge if no gap)

              // Use original height + gap fill
              const maxAchievableHeight = resizingLayout.h + gapFillVert;
              if (clampedH > maxAchievableHeight) {

                clampedH = maxAchievableHeight;
              }
            }

            // Only push if there's actual push needed (after gap fill)
            // IMPORTANT: Use validated positions if available
            if (pushAmountVert > 0 && vertPositions.size === 0) {
              // Calculate the resizing widget's new top edge
              const resizingNewTopEdge = resizingLayout.y + resizingLayout.h - clampedH;

              // Sort widgets bottom to top for cascading calculation
              const sortedWidgets = [...widgetsToPushVert].sort((a, b) => b.y - a.y);

              for (let i = 0; i < sortedWidgets.length; i++) {
                const w = sortedWidgets[i];

                // Find the widget that would actually push this widget
                // It must be: below this widget AND have horizontal overlap with this widget
                let pushForThisWidget = pushAmountVert; // Default: pushed by resizing widget

                // Check if any already-processed widget is below AND has horizontal overlap
                let pushedByWidget: typeof w | null = null;
                let maxPushFromChain = 0;

                for (let j = 0; j < i; j++) {
                  const prevWidget = sortedWidgets[j];
                  const prevNewY = vertPositions.get(prevWidget.id) ?? prevWidget.y;
                  const prevNewTopEdge = prevNewY;

                  // Check if prevWidget has horizontal overlap with current widget
                  const hasHorzOverlap = !(prevWidget.x + prevWidget.w <= w.x || prevWidget.x >= w.x + w.w);

                  // Check if prevWidget is actually below (before pushing) AND its new top edge reaches us
                  const wBottomEdge = w.y + w.h;
                  if (hasHorzOverlap && prevWidget.y >= wBottomEdge) {
                    if (prevNewTopEdge < wBottomEdge) {
                      const cascadePush = wBottomEdge - prevNewTopEdge;
                      if (cascadePush > maxPushFromChain) {
                        maxPushFromChain = cascadePush;
                        pushedByWidget = prevWidget;
                      }
                    }
                  }
                }

                // If we found a widget that cascades into us, use that push
                // Otherwise, check if resizing widget directly pushes us
                if (pushedByWidget && maxPushFromChain > 0) {
                  pushForThisWidget = maxPushFromChain;

                } else {
                  // Check if resizing widget's new top edge reaches us
                  const wBottomEdge = w.y + w.h;
                  if (resizingNewTopEdge < wBottomEdge) {
                    pushForThisWidget = wBottomEdge - resizingNewTopEdge;

                  } else {
                    pushForThisWidget = 0;

                  }
                }

                if (pushForThisWidget <= 0) {
                  vertPositions.set(w.id, w.y);

                } else {
                  const maxMove = w.y; // Can only move up to y=0
                  const actualMove = Math.min(pushForThisWidget, maxMove);
                  const newY = w.y - actualMove;
                  vertPositions.set(w.id, newY);

                }
              }

            }

          }
        }

        // Recalculate clampedX and clampedY after limiting clampedW and clampedH
        // This is needed because west/north resize changes the position based on size
        const finalClampedX = isWestResize ? resizingLayout.x + resizingLayout.w - clampedW : resizingLayout.x;
        const finalClampedY = isNorthResize ? resizingLayout.y + resizingLayout.h - clampedH : resizingLayout.y;

        // Determine if we're expanding in each direction
        const isExpandingHorz = clampedW > resizingLayout.w;
        const isExpandingVert = clampedH > resizingLayout.h;

        // Apply DOM updates
        resizeWidgetDom(resizingWidgetIdRef.current, clampedW, clampedH);
        if (isWestResize || isNorthResize) {
          moveWidgetDom(resizingWidgetIdRef.current, finalClampedX, finalClampedY);
        }

        // Move widgets - use ORIGINAL positions from baseLayouts as fallback (not currentLayouts)
        // This ensures widgets return to original position when not expanding in that direction
        const movedWidgetIds: string[] = [];
        for (const l of baseLayouts) {
          if (l.i === resizingWidgetIdRef.current) continue;

          // For horizontal: use pushed position if expanding horizontally, otherwise original
          const newX = isExpandingHorz ? (horzPositions.get(l.i) ?? l.x) : l.x;
          // For vertical: use pushed position if expanding vertically, otherwise original
          const newY = isExpandingVert ? (vertPositions.get(l.i) ?? l.y) : l.y;

          // Get current position (from currentLayouts or baseLayouts)
          const currentWidget = allWidgets.find(w => w.id === l.i);
          const currentX = currentWidget?.x ?? l.x;
          const currentY = currentWidget?.y ?? l.y;

          if (newX !== currentX || newY !== currentY) {
            moveWidgetDom(l.i, newX, newY);
            movedWidgetIds.push(l.i);
          }
        }

        // Build new layouts
        const newLayouts = baseLayouts.map(l => {
          if (l.i === resizingWidgetIdRef.current) {
            return { ...l, x: finalClampedX, y: finalClampedY, w: clampedW, h: clampedH };
          }
          // For horizontal: use pushed position if expanding horizontally, otherwise original
          const newX = isExpandingHorz ? (horzPositions.get(l.i) ?? l.x) : l.x;
          // For vertical: use pushed position if expanding vertically, otherwise original
          const newY = isExpandingVert ? (vertPositions.get(l.i) ?? l.y) : l.y;
          return { ...l, x: newX, y: newY };
        });

        // Validate
        // Validate: ensure no widget goes outside viewport
        let hasInvalidPosition = newLayouts.some(layout =>
          layout.x < 0 ||
          layout.x + layout.w > GRID_CONFIG.cols ||
          layout.y < 0 ||
          layout.y + layout.h > maxRows
        );

        // CRITICAL: Also validate that no two widgets overlap
        // This prevents react-grid-layout from moving widgets down to resolve collisions
        if (!hasInvalidPosition) {
          for (let i = 0; i < newLayouts.length; i++) {
            for (let j = i + 1; j < newLayouts.length; j++) {
              const a = newLayouts[i];
              const b = newLayouts[j];

              // Check horizontal overlap
              const hasHorizOverlap = !(a.x + a.w <= b.x || a.x >= b.x + b.w);
              // Check vertical overlap
              const hasVertOverlap = !(a.y + a.h <= b.y || a.y >= b.y + b.h);

              if (hasHorizOverlap && hasVertOverlap) {

                hasInvalidPosition = true;
                break;
              }
            }
            if (hasInvalidPosition) break;
          }
        }

        if (hasInvalidPosition) {

          // Reset to base
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
    _e: MouseEvent,
    _element: HTMLElement
  ) => {

    try {
    // CRITICAL: Our custom mousemove handler handles ALL resize directions for real-time feedback
    // Skip this callback entirely to prevent competing resize logic
    const direction = resizeDirectionRef.current;
    if (direction) {

      return;
    }

    // Fallback code - should not reach here as mousemove handles all resizes
    const widgetMinSizes = getWidgetMinSizes();
    const baseLayouts = resizeStartLayoutRef.current;
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

      }

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

      if (result.canResize) {
        // Check if the resize actually changed anything compared to current state
        const resizingLayout = result.newLayouts.find(l => l.i === newItem.i);
        const currentResizingLayout = lastPushedLayoutRef.current?.find(l => l.i === newItem.i) || baseLayouts.find(l => l.i === newItem.i);

        const hasChanges = result.movedWidgets.length > 0 ||
                           result.shrunkWidgets.length > 0 ||
                           (resizingLayout && currentResizingLayout &&
                            (resizingLayout.w !== currentResizingLayout.w || resizingLayout.h !== currentResizingLayout.h));

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

              moveWidgetDom(layout.i, layout.x, layout.y);
            }
          }

          // Also resize the resizing widget's DOM to fill the space created by pushing
          if (resizingLayout) {

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
      // Dynamically find valid positions for both widgets
      if (targetWidget) {
        const cols = GRID_CONFIG.cols;

        // Helper to check if a zone overlaps with any other widget
        const overlapsOtherWidget = (zone: GridZone, excludeIds: string[]): string | null => {
          for (const layout of layouts) {
            if (excludeIds.includes(layout.i)) continue;
            const otherZone = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
            const overlaps = !(
              zone.x >= otherZone.x + otherZone.w ||
              zone.x + zone.w <= otherZone.x ||
              zone.y >= otherZone.y + otherZone.h ||
              zone.y + zone.h <= otherZone.y
            );
            if (overlaps) return layout.i;
          }
          return null;
        };

        // Helper to check if zone is within viewport
        const isInViewport = (zone: GridZone): boolean => {
          return zone.x >= 0 && zone.y >= 0 &&
                 zone.x + zone.w <= cols &&
                 zone.y + zone.h <= maxRows;
        };

        // Helper to check if two zones overlap each other
        const zonesOverlap = (a: GridZone, b: GridZone): boolean => {
          return !(
            a.x >= b.x + b.w ||
            a.x + a.w <= b.x ||
            a.y >= b.y + b.h ||
            a.y + a.h <= b.y
          );
        };

        // Try to find valid positions for swap
        // Scan ALL possible positions in the target's row area for source widget
        let validSourcePos: GridZone | null = null;
        let validTargetPos: GridZone | null = null;

        // Generate ALL possible x positions for source at target's y level
        // This ensures we find any valid position in the row where target is
        const sourceCandidates: Array<{ x: number; y: number }> = [];

        // First priority: positions near target widget
        // At target's exact position
        sourceCandidates.push({ x: targetWidget.x, y: targetWidget.y });
        // Right-aligned with target's right edge
        sourceCandidates.push({ x: targetWidget.x + targetWidget.w - sourceLayout.w, y: targetWidget.y });

        // Second priority: scan entire row at target's y position
        for (let x = 0; x <= cols - sourceLayout.w; x++) {
          // Skip if already added
          if (sourceCandidates.some(c => c.x === x && c.y === targetWidget.y)) continue;
          sourceCandidates.push({ x, y: targetWidget.y });
        }

        // Third priority: positions at source's original y (for height differences)
        for (let x = 0; x <= cols - sourceLayout.w; x++) {
          if (sourceCandidates.some(c => c.x === x && c.y === sourceLayout.y)) continue;
          sourceCandidates.push({ x, y: sourceLayout.y });
        }

        for (const srcCandidate of sourceCandidates) {
          const srcZone: GridZone = {
            x: srcCandidate.x,
            y: srcCandidate.y,
            w: sourceLayout.w,
            h: sourceLayout.h
          };

          // Check if source position is valid
          if (!isInViewport(srcZone)) continue;

          const srcOverlap = overlapsOtherWidget(srcZone, [dragId, targetWidget.i]);
          if (srcOverlap) continue;

          // Now find valid position for target widget
          // Generate candidate positions for target
          const targetCandidates: Array<{ x: number; y: number }> = [];

          // First priority: at source's original position
          targetCandidates.push({ x: sourceLayout.x, y: sourceLayout.y });

          // Second priority: adjacent to source's new position
          targetCandidates.push({ x: srcZone.x + srcZone.w, y: srcZone.y }); // Right
          targetCandidates.push({ x: srcZone.x - targetWidget.w, y: srcZone.y }); // Left
          targetCandidates.push({ x: srcZone.x, y: srcZone.y + srcZone.h }); // Below
          targetCandidates.push({ x: srcZone.x, y: srcZone.y - targetWidget.h }); // Above

          // Third priority: adjacent to source's original position
          targetCandidates.push({ x: sourceLayout.x + sourceLayout.w, y: sourceLayout.y });
          targetCandidates.push({ x: sourceLayout.x - targetWidget.w, y: sourceLayout.y });
          targetCandidates.push({ x: sourceLayout.x, y: sourceLayout.y + sourceLayout.h });

          // Fourth priority: scan source's original row
          for (let x = 0; x <= cols - targetWidget.w; x++) {
            if (targetCandidates.some(c => c.x === x && c.y === sourceLayout.y)) continue;
            targetCandidates.push({ x, y: sourceLayout.y });
          }

          for (const tgtCandidate of targetCandidates) {
            const tgtZone: GridZone = {
              x: tgtCandidate.x,
              y: tgtCandidate.y,
              w: targetWidget.w,
              h: targetWidget.h
            };

            // Check viewport bounds
            if (!isInViewport(tgtZone)) continue;

            // Check if target overlaps with source's new position
            if (zonesOverlap(srcZone, tgtZone)) continue;

            // Check if target overlaps with other widgets
            const tgtOverlap = overlapsOtherWidget(tgtZone, [dragId, targetWidget.i]);
            if (tgtOverlap) continue;

            // Found valid positions!
            validSourcePos = srcZone;
            validTargetPos = tgtZone;
            break;
          }

          if (validSourcePos && validTargetPos) break;
        }

        if (validSourcePos && validTargetPos) {
          const newSwapPreview: SwapPreview = {
            sourceId: dragId,
            targetId: targetWidget.i,
            sourceNewPos: validSourcePos,
            targetNewPos: validTargetPos,
          };

          swapPreviewRef.current = newSwapPreview;
          setSwapPreview(newSwapPreview);
        } else {
          // No valid swap position found - don't show preview

          swapPreviewRef.current = null;
          setSwapPreview(null);
        }
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
    // Keep isDraggingRef true until we've applied our layout to prevent handleLayoutChange interference
    // Clear available zones and swap preview
    setAvailableZones([]);
    setIsDraggingWidget(false);
    const cols = GRID_CONFIG.cols;

    // Feature 4: Check if this is a swap operation (use ref to get latest value)
    const currentSwapPreview = swapPreviewRef.current;

    if (currentSwapPreview && dragStartLayoutRef.current) {
      // IMPORTANT: Use lastValidLayoutRef (original positions before drag) not 'layouts' state
      // During drag, react-grid-layout may have updated the state with the dragged position
      const originalLayouts = lastValidLayoutRef.current.map(l => ({ ...l }));

      // Use EXACT preview positions - what user sees is what they get
      const { sourceId, targetId, sourceNewPos, targetNewPos } = currentSwapPreview;

      // Validate: Check if both positions are within viewport bounds
      const sourceInBounds = sourceNewPos.x >= 0 && sourceNewPos.y >= 0 &&
                            sourceNewPos.x + sourceNewPos.w <= cols &&
                            sourceNewPos.y + sourceNewPos.h <= maxRows;
      const targetInBounds = targetNewPos.x >= 0 && targetNewPos.y >= 0 &&
                            targetNewPos.x + targetNewPos.w <= cols &&
                            targetNewPos.y + targetNewPos.h <= maxRows;

      // Check if swapped widgets would overlap each other
      const wouldOverlap = !(
        sourceNewPos.x >= targetNewPos.x + targetNewPos.w ||
        sourceNewPos.x + sourceNewPos.w <= targetNewPos.x ||
        sourceNewPos.y >= targetNewPos.y + targetNewPos.h ||
        sourceNewPos.y + sourceNewPos.h <= targetNewPos.y
      );

      // Check if swapped widgets would overlap any OTHER widget
      let overlapsOther = false;
      for (const layout of originalLayouts) {
        if (layout.i === sourceId || layout.i === targetId) continue;

        // Check source at new position
        const sourceOverlaps = !(
          sourceNewPos.x >= layout.x + layout.w ||
          sourceNewPos.x + sourceNewPos.w <= layout.x ||
          sourceNewPos.y >= layout.y + layout.h ||
          sourceNewPos.y + sourceNewPos.h <= layout.y
        );

        // Check target at new position
        const targetOverlaps = !(
          targetNewPos.x >= layout.x + layout.w ||
          targetNewPos.x + targetNewPos.w <= layout.x ||
          targetNewPos.y >= layout.y + layout.h ||
          targetNewPos.y + targetNewPos.h <= layout.y
        );

        if (sourceOverlaps) {

          overlapsOther = true;
          break;
        }
        if (targetOverlaps) {

          overlapsOther = true;
          break;
        }
      }

      const canSwap = sourceInBounds && targetInBounds && !wouldOverlap && !overlapsOther;

      // Clear swap state
      swapPreviewRef.current = null;
      setSwapPreview(null);
      dragStartLayoutRef.current = null;
      draggingWidgetRef.current = null;

      if (canSwap) {
        // Apply EXACT preview positions - source and target swap to shown positions
        const swappedLayouts = originalLayouts.map(l => {
          if (l.i === sourceId) {
            return { ...l, x: sourceNewPos.x, y: sourceNewPos.y };
          } else if (l.i === targetId) {
            return { ...l, x: targetNewPos.x, y: targetNewPos.y };
          }
          return l;
        });

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

        // Log the final positions being applied

        lastValidLayoutRef.current = validLayout;
        // Mark timestamp to prevent handleLayoutChange from overriding our swap
        lastSwapApplyTimeRef.current = Date.now();
        // Now set dragging to false after we've prepared everything
        isDraggingRef.current = false;
        updateLayouts(validLayout);
        return;
      } else {
        // Swap not possible - revert to original layout

        // Update lastValidLayoutRef to match what we're reverting to
        lastValidLayoutRef.current = originalLayouts;
        // Mark timestamp to prevent handleLayoutChange from overriding our revert
        lastSwapApplyTimeRef.current = Date.now();
        // Set blocking flag to completely prevent handleLayoutChange during revert
        isRevertingSwapRef.current = true;
        // Update layout with original positions
        updateLayouts(originalLayouts);
        // Force RGL to re-mount to reset its internal CSS transform state
        // This is needed because RGL directly manipulates CSS transforms during drag
        setRglKey(prev => prev + 1);
        // Clear the blocking flag after React has finished updating
        // Use setTimeout to ensure we're past the current event loop and any microtasks
        setTimeout(() => {
          isRevertingSwapRef.current = false;
          isDraggingRef.current = false;
        }, 100);
        return;
      }
    }

    // Now set dragging to false for non-swap cases
    isDraggingRef.current = false;

    // Clear swap state (no swap was attempted - normal drag)
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
  }, [widgets, maxRows, updateLayouts, calculateMaxDimensions]);

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

  // Calculate actual grid cell size for visual background
  const cellWidth = containerWidth > 0 
    ? (containerWidth - GRID_CONFIG.containerPadding[0] * 2 - GRID_CONFIG.margin[0] * (GRID_CONFIG.cols - 1)) / GRID_CONFIG.cols + GRID_CONFIG.margin[0]
    : 32;
  const cellHeight = GRID_CONFIG.rowHeight + GRID_CONFIG.margin[1];

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
        backgroundSize: `${cellWidth}px ${cellHeight}px`,
        backgroundPosition: `${GRID_CONFIG.containerPadding[0]}px ${GRID_CONFIG.containerPadding[1]}px`,
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
            key={rglKey}
            className={`layout ${swapPreview ? 'swap-active' : ''}`}
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
