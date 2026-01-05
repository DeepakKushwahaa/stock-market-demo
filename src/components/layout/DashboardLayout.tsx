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
        console.log('[DEBUG] handleResizeStop: Invalid layout in preview, reverting to last valid');
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

        console.log('=== GAP FILL LOGIC ===');
        console.log('Original edge:', isEastResize ? originalRightEdge : originalLeftEdge);
        console.log('First widget edge:', firstWidgetEdge);
        console.log('Gap to first widget:', gapToFirstWidget);
        console.log('Total expansion requested:', expansion);
        console.log('Gap fill:', gapFill);
        console.log('Push amount:', pushAmount);
        console.log('======================');

        // NEW LOGIC: Push ALL widgets that are in the resize direction
        // Each widget that has vertical overlap with resizing widget gets pushed,
        // AND each widget that has vertical overlap with ANY pushed widget also gets pushed (chain)

        let widgetsToPush: Array<{ id: string; x: number; w: number; y: number; h: number }> = [];

        if (isEastResize) {
          // Get ALL widgets to the right of resizing widget
          const widgetsToRight = allWidgets
            .filter(w => w.x >= originalRightEdge)
            .sort((a, b) => a.x - b.x);

          console.log('=== EAST RESIZE DEBUG ===');
          console.log('Resizing widget right edge:', originalRightEdge);
          console.log('All widgets to right:', widgetsToRight.length);
          widgetsToRight.forEach(w => {
            const overlap = hasVerticalOverlap(w);
            console.log(`  Widget ${w.id.slice(-8)}: x=${w.x}, y=${w.y}, w=${w.w}, h=${w.h}, verticalOverlap=${overlap}`);
          });

          // Start with widgets that have direct vertical overlap with resizing widget
          const directPushWidgets = widgetsToRight.filter(w => hasVerticalOverlap(w));
          console.log('Direct push widgets (vertical overlap with resizing):', directPushWidgets.length);

          // Chain reaction - BFS to find all connected widgets
          const pushedSet = new Set<string>();
          const queue = [...directPushWidgets];

          while (queue.length > 0) {
            const current = queue.shift()!;
            if (pushedSet.has(current.id)) continue;
            pushedSet.add(current.id);
            widgetsToPush.push(current);
            console.log(`Added to push: ${current.id.slice(-8)} at x=${current.x}`);

            // Find ALL widgets to the right that have vertical overlap with current
            const currentRightEdge = current.x + current.w;
            console.log(`  Looking for widgets to right of ${current.id.slice(-8)}, rightEdge=${currentRightEdge}`);

            for (const other of widgetsToRight) {
              if (pushedSet.has(other.id)) continue;

              // Check if other is to the right of current
              const isToRight = other.x >= currentRightEdge;
              // Check vertical overlap with current widget
              const hasOverlap = !(current.y + current.h <= other.y || current.y >= other.y + other.h);

              console.log(`    Checking ${other.id.slice(-8)}: x=${other.x}, isToRight=${isToRight}, hasOverlap=${hasOverlap}`);

              if (isToRight && hasOverlap) {
                console.log(`    -> Adding to queue!`);
                queue.push(other);
              }
            }
          }

          widgetsToPush.sort((a, b) => a.x - b.x);
          console.log('=== END EAST RESIZE DEBUG ===');
        } else {
          // West resize - similar logic
          const widgetsToLeft = allWidgets
            .filter(w => w.x + w.w <= originalLeftEdge)
            .sort((a, b) => b.x - a.x);

          const directPushWidgets = widgetsToLeft.filter(w => hasVerticalOverlap(w));
          const pushedSet = new Set<string>();
          const queue = [...directPushWidgets];

          while (queue.length > 0) {
            const current = queue.shift()!;
            if (pushedSet.has(current.id)) continue;
            pushedSet.add(current.id);
            widgetsToPush.push(current);

            const currentLeftEdge = current.x;
            for (const other of widgetsToLeft) {
              if (pushedSet.has(other.id)) continue;
              if (other.x + other.w > currentLeftEdge) continue;

              const hasOverlap = !(current.y + current.h <= other.y || current.y >= other.y + other.h);
              if (hasOverlap) {
                queue.push(other);
              }
            }
          }

          for (const widget of widgetsToLeft) {
            if (pushedSet.has(widget.id)) continue;
            for (const pushed of widgetsToPush) {
              if (widget.x + widget.w <= pushed.x) {
                const hasOverlap = !(pushed.y + pushed.h <= widget.y || pushed.y >= widget.y + widget.h);
                if (hasOverlap) {
                  pushedSet.add(widget.id);
                  widgetsToPush.push(widget);
                  break;
                }
              }
            }
          }

          widgetsToPush.sort((a, b) => b.x - a.x);
        }

        console.log('=== WIDGETS TO PUSH ===');
        console.log('Total all widgets:', allWidgets.length);
        console.log('Direct overlap widgets:', widgetsWithDirectOverlap.length);
        console.log('Widgets to push (chain):', widgetsToPush.length);
        widgetsToPush.forEach(w => console.log(`  - ${w.id.slice(-8)}: x=${w.x}, y=${w.y}, w=${w.w}, h=${w.h}`));
        console.log('=======================');

        // Find widgets NOT in the chain
        const chainIds = new Set(widgetsToPush.map(w => w.id));
        const nonChainWidgets = allWidgets.filter(w => !chainIds.has(w.id));

        // Calculate available space for pushing
        // IMPORTANT: We need to consider gaps BETWEEN widgets in the chain
        // Total available space = (viewport edge - rightmost widget) + (sum of all gaps between widgets)
        let availablePushSpace = 0;

        console.log('=== CHECKING AVAILABLE SPACE ===');
        console.log('pushAmount:', pushAmount);
        console.log('widgetsToPush.length:', widgetsToPush.length);

        if (widgetsToPush.length > 0) {
          if (isEastResize) {
            // Sort widgets left to right
            const sortedWidgets = [...widgetsToPush].sort((a, b) => a.x - b.x);

            // Calculate total gaps between widgets in the chain
            let totalGaps = 0;
            for (let i = 0; i < sortedWidgets.length - 1; i++) {
              const currentRightEdge = sortedWidgets[i].x + sortedWidgets[i].w;
              const nextLeftEdge = sortedWidgets[i + 1].x;
              const gap = nextLeftEdge - currentRightEdge;
              console.log(`Gap between widget ${i} (rightEdge=${currentRightEdge}) and widget ${i+1} (leftEdge=${nextLeftEdge}): ${gap}`);
              if (gap > 0) {
                totalGaps += gap;
              }
            }

            // Space at the end (viewport edge - rightmost widget)
            const rightmostEdge = Math.max(...widgetsToPush.map(w => w.x + w.w));
            let blockingEdge = GRID_CONFIG.cols;

            console.log('Rightmost edge:', rightmostEdge);
            console.log('GRID_CONFIG.cols:', GRID_CONFIG.cols);
            console.log('nonChainWidgets count:', nonChainWidgets.length);

            for (const nonChain of nonChainWidgets) {
              const hasOverlapWithChain = widgetsToPush.some(chainWidget =>
                hasVerticalOverlapBetween(chainWidget, nonChain)
              );
              if (hasOverlapWithChain && nonChain.x >= rightmostEdge) {
                blockingEdge = Math.min(blockingEdge, nonChain.x);
              }
            }

            const spaceAtEnd = blockingEdge - rightmostEdge;
            availablePushSpace = totalGaps + spaceAtEnd;

            console.log('Total gaps between widgets:', totalGaps);
            console.log('Space at end (viewport - rightmost):', spaceAtEnd);
            console.log('Total available push space:', availablePushSpace);
            console.log('================================');
          } else {
            // West resize - similar logic
            const sortedWidgets = [...widgetsToPush].sort((a, b) => b.x - a.x);

            let totalGaps = 0;
            for (let i = 0; i < sortedWidgets.length - 1; i++) {
              const currentLeftEdge = sortedWidgets[i].x;
              const nextRightEdge = sortedWidgets[i + 1].x + sortedWidgets[i + 1].w;
              const gap = currentLeftEdge - nextRightEdge;
              if (gap > 0) {
                totalGaps += gap;
              }
            }

            const leftmostEdge = Math.min(...widgetsToPush.map(w => w.x));
            let blockingEdge = 0;

            for (const nonChain of nonChainWidgets) {
              const hasOverlapWithChain = widgetsToPush.some(chainWidget =>
                hasVerticalOverlapBetween(chainWidget, nonChain)
              );
              if (hasOverlapWithChain && nonChain.x + nonChain.w <= leftmostEdge) {
                blockingEdge = Math.max(blockingEdge, nonChain.x + nonChain.w);
              }
            }

            const spaceAtEnd = leftmostEdge - blockingEdge;
            availablePushSpace = totalGaps + spaceAtEnd;
          }
        }

        // Calculate actual push (limited by available space)
        const actualPush = Math.min(pushAmount, availablePushSpace);
        const totalExpansion = gapFill + actualPush;

        // Calculate final dimensions
        const finalW = Math.max(minW, resizingLayout.w + totalExpansion);
        const finalX = isWestResize
          ? resizingLayout.x + resizingLayout.w - finalW
          : resizingLayout.x;

        console.log('=== FINAL CALCULATION ===');
        console.log('Available push space:', availablePushSpace);
        console.log('Actual push:', actualPush);
        console.log('Total expansion:', totalExpansion);
        console.log('Final W:', finalW);
        console.log('=========================');

        // Calculate new positions for pushed widgets
        // CASCADING LOGIC:
        // - Widget moves and fills its gap FIRST
        // - Only when widget's new right edge TOUCHES next widget, next widget starts moving
        // - Each widget absorbs push into its gap before passing remainder to next
        const newPositions: Map<string, number> = new Map();

        if (actualPush > 0) {
          if (isEastResize) {
            // Sort widgets left to right for cascading calculation
            const sortedWidgets = [...widgetsToPush].sort((a, b) => a.x - b.x);

            console.log('=== CASCADING POSITION CALC (GAP FILL FIRST) ===');
            console.log('Actual push:', actualPush);

            // Process widgets from left to right
            // Each widget moves, but next widget only moves if previous widget TOUCHES it
            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];
              const nextWidget = sortedWidgets[i + 1];

              // How much does this widget need to move?
              let pushForThisWidget: number;

              if (i === 0) {
                // First widget is pushed directly by resizing widget
                pushForThisWidget = actualPush;
              } else {
                // This widget is pushed ONLY if previous widget's new right edge reaches it
                const prevWidget = sortedWidgets[i - 1];
                const prevNewX = newPositions.get(prevWidget.id) ?? prevWidget.x;
                const prevNewRightEdge = prevNewX + prevWidget.w;

                // If previous widget's new right edge > this widget's left edge, we need to move
                if (prevNewRightEdge > w.x) {
                  pushForThisWidget = prevNewRightEdge - w.x;
                } else {
                  // Previous widget doesn't reach us - we DON'T MOVE
                  pushForThisWidget = 0;
                }
              }

              // Calculate gap after this widget (to next widget or viewport)
              const wRightEdge = w.x + w.w;
              const nextEdge = nextWidget ? nextWidget.x : GRID_CONFIG.cols;
              const gapAfter = nextEdge - wRightEdge;

              console.log(`Widget ${w.id.slice(-8)}: x=${w.x}, w=${w.w}, gapAfter=${gapAfter}, pushNeeded=${pushForThisWidget}`);

              if (pushForThisWidget <= 0) {
                // No push needed, stay in place
                newPositions.set(w.id, w.x);
                console.log(`  -> stays at x=${w.x} (no push needed)`);
              } else {
                // Move by push amount, but clamp to viewport
                const maxMove = GRID_CONFIG.cols - w.w - w.x; // Max we can move right
                const actualMove = Math.min(pushForThisWidget, maxMove);
                const newX = w.x + actualMove;
                newPositions.set(w.id, newX);
                console.log(`  -> moves to x=${newX} (moved ${actualMove})`);
              }
            }

            console.log('=== END CASCADING CALC ===');
          } else {
            // West resize - similar but reversed
            const sortedWidgets = [...widgetsToPush].sort((a, b) => b.x - a.x);

            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];

              let pushForThisWidget: number;

              if (i === 0) {
                pushForThisWidget = actualPush;
              } else {
                const prevWidget = sortedWidgets[i - 1];
                const prevNewX = newPositions.get(prevWidget.id) ?? prevWidget.x;
                const wRightEdge = w.x + w.w;

                // If previous widget's new left edge < this widget's right edge
                if (prevNewX < wRightEdge) {
                  pushForThisWidget = wRightEdge - prevNewX;
                } else {
                  pushForThisWidget = 0;
                }
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

        // CRITICAL FIX: Check if pushed widgets would vertically overlap with non-chain widgets
        let adjustedActualPush = actualPush;
        let adjustedFinalW = finalW;
        let adjustedFinalX = finalX;

        if (actualPush > 0) {
          for (const pushedWidget of widgetsToPush) {
            const pushedNewX = isEastResize
              ? pushedWidget.x + actualPush
              : pushedWidget.x - actualPush;
            const clampedPushedX = isEastResize
              ? Math.min(pushedNewX, GRID_CONFIG.cols - pushedWidget.w)
              : Math.max(0, pushedNewX);

            for (const nonChain of nonChainWidgets) {
              const pushedLeftEdge = clampedPushedX;
              const pushedRightEdge = clampedPushedX + pushedWidget.w;
              const nonChainLeftEdge = nonChain.x;
              const nonChainRightEdge = nonChain.x + nonChain.w;

              const hasHorizontalOverlap = !(pushedRightEdge <= nonChainLeftEdge || pushedLeftEdge >= nonChainRightEdge);
              const pushedTop = pushedWidget.y;
              const pushedBottom = pushedWidget.y + pushedWidget.h;
              const nonChainTop = nonChain.y;
              const nonChainBottom = nonChain.y + nonChain.h;
              const hasVertOverlap = !(pushedBottom <= nonChainTop || pushedTop >= nonChainBottom);

              if (hasHorizontalOverlap && hasVertOverlap) {
                const spaceBelow = maxRows - nonChainBottom;
                if (spaceBelow <= 0) {
                  if (isEastResize) {
                    const maxPushedX = nonChainLeftEdge - pushedWidget.w;
                    const maxPush = Math.max(0, maxPushedX - pushedWidget.x);
                    if (maxPush < adjustedActualPush) {
                      adjustedActualPush = maxPush;
                      adjustedFinalW = resizingLayout.w + gapFill + adjustedActualPush;
                    }
                  } else {
                    const maxPushedX = nonChainRightEdge;
                    const maxPush = Math.max(0, pushedWidget.x - maxPushedX);
                    if (maxPush < adjustedActualPush) {
                      adjustedActualPush = maxPush;
                      adjustedFinalW = resizingLayout.w + gapFill + adjustedActualPush;
                      adjustedFinalX = resizingLayout.x + resizingLayout.w - adjustedFinalW;
                    }
                  }
                }
              }
            }
          }

          // Also check resizing widget itself
          const resizingNewRightEdge = isWestResize ? resizingLayout.x + resizingLayout.w : resizingLayout.x + adjustedFinalW;
          const resizingNewLeftEdge = isWestResize ? adjustedFinalX : resizingLayout.x;

          for (const nonChain of nonChainWidgets) {
            const hasHorizontalOverlap = !(resizingNewRightEdge <= nonChain.x || resizingNewLeftEdge >= nonChain.x + nonChain.w);
            const hasVertOverlap = hasVerticalOverlapBetween(resizingLayout, nonChain);

            if (hasHorizontalOverlap && hasVertOverlap) {
              const spaceBelow = maxRows - (nonChain.y + nonChain.h);
              if (spaceBelow <= 0) {
                if (isEastResize) {
                  const maxW = nonChain.x - resizingLayout.x;
                  if (maxW < adjustedFinalW) {
                    adjustedFinalW = Math.max(resizingLayout.w, maxW);
                    adjustedActualPush = Math.max(0, adjustedFinalW - resizingLayout.w - gapFill);
                  }
                } else {
                  const maxX = nonChain.x + nonChain.w;
                  if (maxX > adjustedFinalX) {
                    adjustedFinalX = maxX;
                    adjustedFinalW = resizingLayout.x + resizingLayout.w - adjustedFinalX;
                    adjustedActualPush = Math.max(0, adjustedFinalW - resizingLayout.w - gapFill);
                  }
                }
              }
            }
          }
        }

        // Recalculate pushed widget positions with adjusted push using CASCADING logic
        // IMPORTANT: For horizontal resize, widgets that are vertically stacked (no vertical overlap)
        // should NOT cascade into each other - they should all be pushed by the same amount
        const adjustedPositions: Map<string, number> = new Map();
        if (adjustedActualPush > 0) {
          if (isEastResize) {
            // Sort widgets left to right for cascading calculation
            const sortedWidgets = [...widgetsToPush].sort((a, b) => a.x - b.x);

            console.log('=== ADJUSTED CASCADING CALC ===');
            console.log('Adjusted actual push:', adjustedActualPush);

            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];

              // Find the widget that would actually push this widget
              // It must be: to the left of this widget AND have vertical overlap with this widget
              let pushForThisWidget = adjustedActualPush; // Default: pushed by resizing widget

              // Check if any already-processed widget is to the left AND has vertical overlap
              // If so, use cascading logic from that widget
              let pushedByWidget: typeof w | null = null;
              let maxPushFromChain = 0;

              for (let j = 0; j < i; j++) {
                const prevWidget = sortedWidgets[j];
                const prevNewX = adjustedPositions.get(prevWidget.id) ?? prevWidget.x;
                const prevNewRightEdge = prevNewX + prevWidget.w;

                // Check if prevWidget has vertical overlap with current widget
                const hasVertOverlap = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                // Check if prevWidget is actually to the left (before pushing) AND its new right edge reaches us
                if (hasVertOverlap && prevWidget.x + prevWidget.w <= w.x) {
                  // This widget could cascade push us
                  if (prevNewRightEdge > w.x) {
                    const cascadePush = prevNewRightEdge - w.x;
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
                console.log(`  Widget ${w.id.slice(-8)}: cascaded from ${pushedByWidget.id.slice(-8)}, push=${pushForThisWidget}`);
              } else {
                // Check if resizing widget's new right edge reaches us
                const resizingNewRightEdge = resizingLayout.x + adjustedFinalW;
                if (resizingNewRightEdge > w.x) {
                  pushForThisWidget = resizingNewRightEdge - w.x;
                  console.log(`  Widget ${w.id.slice(-8)}: pushed by resizing widget, push=${pushForThisWidget}`);
                } else {
                  pushForThisWidget = 0;
                  console.log(`  Widget ${w.id.slice(-8)}: no push needed (gap exists)`);
                }
              }

              if (pushForThisWidget <= 0) {
                adjustedPositions.set(w.id, w.x);
                console.log(`  Widget ${w.id.slice(-8)}: stays at x=${w.x}`);
              } else {
                const maxMove = GRID_CONFIG.cols - w.w - w.x;
                const actualMove = Math.min(pushForThisWidget, maxMove);
                const newX = w.x + actualMove;
                adjustedPositions.set(w.id, newX);
                console.log(`  Widget ${w.id.slice(-8)}: moves to x=${newX} (push=${pushForThisWidget}, actualMove=${actualMove})`);
              }
            }
            console.log('=== END ADJUSTED CASCADING ===');
          } else {
            // West resize - cascading from right to left with vertical overlap check
            const sortedWidgets = [...widgetsToPush].sort((a, b) => b.x - a.x);

            for (let i = 0; i < sortedWidgets.length; i++) {
              const w = sortedWidgets[i];

              let pushForThisWidget = adjustedActualPush;
              let maxPushFromChain = 0;

              for (let j = 0; j < i; j++) {
                const prevWidget = sortedWidgets[j];
                const prevNewX = adjustedPositions.get(prevWidget.id) ?? prevWidget.x;

                const hasVertOverlap = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);
                const wRightEdge = w.x + w.w;

                if (hasVertOverlap && prevWidget.x >= wRightEdge) {
                  if (prevNewX < wRightEdge) {
                    const cascadePush = wRightEdge - prevNewX;
                    if (cascadePush > maxPushFromChain) {
                      maxPushFromChain = cascadePush;
                    }
                  }
                }
              }

              if (maxPushFromChain > 0) {
                pushForThisWidget = maxPushFromChain;
              } else {
                const resizingNewLeftEdge = adjustedFinalX;
                const wRightEdge = w.x + w.w;
                if (resizingNewLeftEdge < wRightEdge) {
                  pushForThisWidget = wRightEdge - resizingNewLeftEdge;
                } else {
                  pushForThisWidget = 0;
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

        // Move pushed widgets
        const movedWidgetIds: string[] = [];
        for (const w of widgetsToPush) {
          const newX = adjustedPositions.get(w.id) ?? w.x;
          if (newX !== w.x) {
            moveWidgetDom(w.id, newX, w.y);
            movedWidgetIds.push(w.id);
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

        console.log('=== VERTICAL GAP FILL LOGIC ===');
        console.log('Original edge:', isSouthResize ? originalBottomEdge : originalTopEdge);
        console.log('First widget edge:', firstWidgetEdge);
        console.log('Gap to first widget:', gapToFirstWidget);
        console.log('Total expansion requested:', expansion);
        console.log('Gap fill:', gapFill);
        console.log('Push amount:', pushAmount);
        console.log('===============================');

        // Build the list of ALL widgets that need to be pushed using BFS CHAIN DETECTION
        let widgetsToPush: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];

        if (isSouthResize) {
          // Get ALL widgets below resizing widget
          const widgetsBelow = allWidgets
            .filter(w => w.y >= originalBottomEdge)
            .sort((a, b) => a.y - b.y);

          console.log('=== SOUTH RESIZE VERTICAL DEBUG ===');
          console.log('Resizing widget bottom edge:', originalBottomEdge);
          console.log('All widgets below:', widgetsBelow.length);
          widgetsBelow.forEach(w => {
            const overlap = hasHorizontalOverlap(w);
            console.log(`  Widget ${w.id.slice(-8)}: y=${w.y}, x=${w.x}, w=${w.w}, h=${w.h}, horizontalOverlap=${overlap}`);
          });

          // Start with widgets that have direct horizontal overlap with resizing widget
          const directPushWidgets = widgetsBelow.filter(w => hasHorizontalOverlap(w));
          console.log('Direct push widgets (horizontal overlap with resizing):', directPushWidgets.length);

          // Chain reaction - BFS to find all connected widgets
          const pushedSet = new Set<string>();
          const queue = [...directPushWidgets];

          while (queue.length > 0) {
            const current = queue.shift()!;
            if (pushedSet.has(current.id)) continue;
            pushedSet.add(current.id);
            widgetsToPush.push(current);
            console.log(`Added to vertical push: ${current.id.slice(-8)} at y=${current.y}`);

            // Find ALL widgets below current that have horizontal overlap with current
            const currentBottomEdge = current.y + current.h;
            console.log(`  Looking for widgets below ${current.id.slice(-8)}, bottomEdge=${currentBottomEdge}`);

            for (const other of widgetsBelow) {
              if (pushedSet.has(other.id)) continue;

              // Check if other is below current
              const isBelow = other.y >= currentBottomEdge;
              // Check horizontal overlap with current widget
              const hasOverlap = !(current.x + current.w <= other.x || current.x >= other.x + other.w);

              console.log(`    Checking ${other.id.slice(-8)}: y=${other.y}, isBelow=${isBelow}, hasHorizontalOverlap=${hasOverlap}`);

              if (isBelow && hasOverlap) {
                console.log(`    -> Adding to queue!`);
                queue.push(other);
              }
            }
          }

          widgetsToPush.sort((a, b) => a.y - b.y); // Sort top to bottom
          console.log('=== END SOUTH RESIZE DEBUG ===');
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

        console.log('=== VERTICAL WIDGETS TO PUSH ===');
        console.log('Total widgets with direct overlap:', widgetsWithOverlap.length);
        console.log('Widgets to push (chain):', widgetsToPush.length);
        widgetsToPush.forEach(w => console.log(`  - ${w.id.slice(-8)}: y=${w.y}, h=${w.h}`));
        console.log('================================');

        // Find widgets NOT in the chain
        const chainIds = new Set(widgetsToPush.map(w => w.id));
        const nonChainWidgets = allWidgets.filter(w => !chainIds.has(w.id));

        // Calculate available space for pushing (INCLUDING GAPS BETWEEN WIDGETS)
        let availablePushSpace = 0;

        if (pushAmount > 0 && widgetsToPush.length > 0) {
          if (isSouthResize) {
            // Sort widgets top to bottom
            const sortedWidgets = [...widgetsToPush].sort((a, b) => a.y - b.y);

            // Calculate total gaps between widgets in the chain
            let totalGaps = 0;
            for (let i = 0; i < sortedWidgets.length - 1; i++) {
              const currentBottomEdge = sortedWidgets[i].y + sortedWidgets[i].h;
              const nextTopEdge = sortedWidgets[i + 1].y;
              const gap = nextTopEdge - currentBottomEdge;
              console.log(`Vertical gap between widget ${i} (bottom=${currentBottomEdge}) and widget ${i+1} (top=${nextTopEdge}): ${gap}`);
              if (gap > 0) {
                totalGaps += gap;
              }
            }

            const bottommostEdge = Math.max(...widgetsToPush.map(w => w.y + w.h));
            let blockingEdge = maxRows;

            for (const nonChain of nonChainWidgets) {
              const hasOverlapWithChain = widgetsToPush.some(chainWidget =>
                hasHorizontalOverlapBetween(chainWidget, nonChain)
              );
              if (hasOverlapWithChain && nonChain.y >= bottommostEdge) {
                blockingEdge = Math.min(blockingEdge, nonChain.y);
              }
            }
            const spaceAtEnd = blockingEdge - bottommostEdge;
            availablePushSpace = totalGaps + spaceAtEnd;

            console.log('=== VERTICAL AVAILABLE SPACE ===');
            console.log('Total gaps between widgets:', totalGaps);
            console.log('Space at end (viewport - bottommost):', spaceAtEnd);
            console.log('Total available push space:', availablePushSpace);
            console.log('================================');
          } else {
            // North resize - sort bottom to top
            const sortedWidgets = [...widgetsToPush].sort((a, b) => b.y - a.y);

            let totalGaps = 0;
            for (let i = 0; i < sortedWidgets.length - 1; i++) {
              const currentTopEdge = sortedWidgets[i].y;
              const nextBottomEdge = sortedWidgets[i + 1].y + sortedWidgets[i + 1].h;
              const gap = currentTopEdge - nextBottomEdge;
              if (gap > 0) {
                totalGaps += gap;
              }
            }

            const topmostEdge = Math.min(...widgetsToPush.map(w => w.y));
            let blockingEdge = 0;

            for (const nonChain of nonChainWidgets) {
              const hasOverlapWithChain = widgetsToPush.some(chainWidget =>
                hasHorizontalOverlapBetween(chainWidget, nonChain)
              );
              if (hasOverlapWithChain && nonChain.y + nonChain.h <= topmostEdge) {
                blockingEdge = Math.max(blockingEdge, nonChain.y + nonChain.h);
              }
            }
            const spaceAtEnd = topmostEdge - blockingEdge;
            availablePushSpace = totalGaps + spaceAtEnd;
          }
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

        console.log('=== VERTICAL FINAL CALCULATION ===');
        console.log('Available push space:', availablePushSpace);
        console.log('Actual push:', actualPush);
        console.log('Total expansion:', totalExpansion);
        console.log('Final H:', finalH);
        console.log('==================================');

        // Calculate new positions for pushed widgets
        const newPositions: Map<string, number> = new Map();

        if (actualPush > 0) {
          if (isSouthResize) {
            for (const w of widgetsToPush) {
              const newY = w.y + actualPush;
              const clampedY = Math.min(newY, maxRows - w.h);
              newPositions.set(w.id, clampedY);
            }
          } else {
            for (const w of widgetsToPush) {
              const newY = w.y - actualPush;
              const clampedY = Math.max(0, newY);
              newPositions.set(w.id, clampedY);
            }
          }
        }

        // Check for collisions with non-chain widgets
        let adjustedActualPush = actualPush;
        let adjustedFinalH = finalH;
        let adjustedFinalY = finalY;

        if (actualPush > 0) {
          for (const pushedWidget of widgetsToPush) {
            const pushedNewY = isSouthResize
              ? pushedWidget.y + actualPush
              : pushedWidget.y - actualPush;
            const clampedPushedY = isSouthResize
              ? Math.min(pushedNewY, maxRows - pushedWidget.h)
              : Math.max(0, pushedNewY);

            for (const nonChain of nonChainWidgets) {
              const hasHorzOverlap = hasHorizontalOverlapBetween(pushedWidget, nonChain);
              const pushedTop = clampedPushedY;
              const pushedBottom = clampedPushedY + pushedWidget.h;
              const nonChainTop = nonChain.y;
              const nonChainBottom = nonChain.y + nonChain.h;
              const hasVertOverlap = !(pushedBottom <= nonChainTop || pushedTop >= nonChainBottom);

              if (hasHorzOverlap && hasVertOverlap) {
                const spaceRight = GRID_CONFIG.cols - (nonChain.x + nonChain.w);
                if (spaceRight <= 0) {
                  if (isSouthResize) {
                    const maxPushedY = nonChainTop - pushedWidget.h;
                    const maxPush = Math.max(0, maxPushedY - pushedWidget.y);
                    if (maxPush < adjustedActualPush) {
                      adjustedActualPush = maxPush;
                      adjustedFinalH = resizingLayout.h + gapFill + adjustedActualPush;
                    }
                  } else {
                    const maxPushedY = nonChainBottom;
                    const maxPush = Math.max(0, pushedWidget.y - maxPushedY);
                    if (maxPush < adjustedActualPush) {
                      adjustedActualPush = maxPush;
                      adjustedFinalH = resizingLayout.h + gapFill + adjustedActualPush;
                      adjustedFinalY = resizingLayout.y + resizingLayout.h - adjustedFinalH;
                    }
                  }
                }
              }
            }
          }
        }

        // Recalculate pushed widget positions with adjusted push using CASCADING logic
        // IMPORTANT: For vertical resize, widgets that are horizontally stacked (no horizontal overlap)
        // should NOT cascade into each other - they should all be pushed by the same amount
        const adjustedPositions: Map<string, number> = new Map();
        if (adjustedActualPush > 0) {
          if (isSouthResize) {
            // Sort widgets top to bottom for cascading calculation
            const sortedWidgets = [...widgetsToPush].sort((a, b) => a.y - b.y);

            console.log('=== VERTICAL ADJUSTED CASCADING CALC ===');
            console.log('Adjusted actual push:', adjustedActualPush);

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
                console.log(`  Widget ${w.id.slice(-8)}: cascaded from ${pushedByWidget.id.slice(-8)}, push=${pushForThisWidget}`);
              } else {
                // Check if resizing widget's new bottom edge reaches us
                const resizingNewBottomEdge = resizingLayout.y + adjustedFinalH;
                if (resizingNewBottomEdge > w.y) {
                  pushForThisWidget = resizingNewBottomEdge - w.y;
                  console.log(`  Widget ${w.id.slice(-8)}: pushed by resizing widget, push=${pushForThisWidget}`);
                } else {
                  pushForThisWidget = 0;
                  console.log(`  Widget ${w.id.slice(-8)}: no push needed (gap exists)`);
                }
              }

              if (pushForThisWidget <= 0) {
                adjustedPositions.set(w.id, w.y);
                console.log(`  Widget ${w.id.slice(-8)}: stays at y=${w.y}`);
              } else {
                const maxMove = maxRows - w.h - w.y;
                const actualMove = Math.min(pushForThisWidget, maxMove);
                const newY = w.y + actualMove;
                adjustedPositions.set(w.id, newY);
                console.log(`  Widget ${w.id.slice(-8)}: moves to y=${newY} (push=${pushForThisWidget}, actualMove=${actualMove})`);
              }
            }
            console.log('=== END VERTICAL CASCADING ===');
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
        const hasInvalidPosition = newLayouts.some(layout =>
          layout.x < 0 ||
          layout.x + layout.w > GRID_CONFIG.cols ||
          layout.y < 0 ||
          layout.y + layout.h > maxRows
        );

        if (hasInvalidPosition) {
          console.log('[DEBUG] Invalid vertical layout - reverting');
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
        console.log('=== CORNER RESIZE START ===');
        console.log('Direction:', direction);

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
        const clampedY = isNorthResize ? resizingLayout.y + resizingLayout.h - clampedH : resizingLayout.y;

        console.log('Resizing widget:', resizingLayout.i, 'Original:', { x: resizingLayout.x, y: resizingLayout.y, w: resizingLayout.w, h: resizingLayout.h });
        console.log('Clamped:', { x: clampedX, y: clampedY, w: clampedW, h: clampedH });
        console.log('Expansion - horizontal:', clampedW - resizingLayout.w, 'vertical:', clampedH - resizingLayout.h);

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
        const resizingBoundsForHorz = { y: clampedY, h: clampedH };

        // Use ORIGINAL edges (same as horizontal-only resize)
        const originalRightEdge = resizingLayout.x + resizingLayout.w;
        const originalLeftEdge = resizingLayout.x;

        console.log('=== CORNER HORIZONTAL CHECK ===');
        console.log('requestedW:', requestedW, 'resizingLayout.w:', resizingLayout.w);
        console.log('Will process horizontal?', requestedW > resizingLayout.w);

        // Check if user is REQUESTING horizontal expansion (use requestedW, not clampedW)
        // This allows continuous resize - as user drags further, expansion keeps increasing
        if (requestedW > resizingLayout.w) {
          const horizontalExpansion = requestedW - resizingLayout.w;
          console.log('=== CORNER HORIZONTAL PUSH ===');
          console.log('Horizontal expansion:', horizontalExpansion);

          // Collect ALL widgets to push using BFS chain detection
          const widgetsToPushHorz: typeof allWidgets = [];

          if (isEastResize) {
            console.log('=== CORNER EAST RESIZE ===');
            console.log('Current right edge:', originalRightEdge);
            console.log('All widgets:', allWidgets.length);
            allWidgets.forEach(w => console.log(`  Widget: ${w.id.slice(-8)}: x=${w.x}, y=${w.y}, w=${w.w}, h=${w.h}`));

            const widgetsToRight = allWidgets
              .filter(w => w.x >= originalRightEdge)
              .sort((a, b) => a.x - b.x);

            console.log('Widgets to right (x >= currentRightEdge):', widgetsToRight.length);
            widgetsToRight.forEach(w => console.log(`  To right: ${w.id.slice(-8)}: x=${w.x}`));

            // Find gap to first widget with vertical overlap
            let gapToFirstWidget = GRID_CONFIG.cols - originalRightEdge;
            console.log('resizingBoundsForHorz:', resizingBoundsForHorz);
            const widgetsWithOverlap = widgetsToRight.filter(w => hasVerticalOverlapBetween(resizingBoundsForHorz, w));
            console.log('Widgets with vertical overlap:', widgetsWithOverlap.length);
            widgetsWithOverlap.forEach(w => console.log(`  With overlap: ${w.id.slice(-8)}: x=${w.x}, y=${w.y}, h=${w.h}`));

            if (widgetsWithOverlap.length > 0) {
              widgetsWithOverlap.sort((a, b) => a.x - b.x);
              gapToFirstWidget = widgetsWithOverlap[0].x - originalRightEdge;
            }

            // Calculate gap fill vs push
            const gapFillHorz = Math.min(horizontalExpansion, gapToFirstWidget);
            let pushAmountHorz = Math.max(0, horizontalExpansion - gapToFirstWidget);
            console.log('Gap to first widget:', gapToFirstWidget);
            console.log('Gap fill:', gapFillHorz, 'Initial push amount:', pushAmountHorz);

            // BFS chain detection - same as horizontal resize
            // Start with ALL widgets that have vertical overlap with resizing widget (not just adjacent)
            const directPushWidgets = widgetsToRight.filter(w =>
              hasVerticalOverlapBetween(resizingBoundsForHorz, w)
            );
            console.log('Direct push widgets (vertical overlap):', directPushWidgets.length);
            directPushWidgets.forEach(w => console.log(`  Direct: ${w.id.slice(-8)}: x=${w.x}`));

            const pushedSet = new Set<string>();
            const queue = [...directPushWidgets];

            while (queue.length > 0) {
              const current = queue.shift()!;
              if (pushedSet.has(current.id)) continue;
              pushedSet.add(current.id);
              widgetsToPushHorz.push(current);

              const currentRightEdge = current.x + current.w;
              for (const other of widgetsToRight) {
                if (pushedSet.has(other.id)) continue;
                const isToRight = other.x >= currentRightEdge;
                const hasOverlap = !(current.y + current.h <= other.y || current.y >= other.y + other.h);
                if (isToRight && hasOverlap) queue.push(other);
              }
            }

            widgetsToPushHorz.sort((a, b) => a.x - b.x);
            console.log('Widgets to push (BFS chain):', widgetsToPushHorz.length);
            widgetsToPushHorz.forEach(w => console.log(`  In chain: ${w.id.slice(-8)}: x=${w.x}`));

            // Identify non-chain widgets (widgets NOT in the push chain)
            const pushedIds = new Set(widgetsToPushHorz.map(w => w.id));
            const nonChainWidgets = allWidgets.filter(w => !pushedIds.has(w.id));
            console.log('Non-chain widgets:', nonChainWidgets.length);

            // Calculate available push space (INCLUDING gaps between widgets in chain - same as horizontal resize)
            if (widgetsToPushHorz.length > 0) {
              // There are widgets to push
              if (pushAmountHorz > 0) {
                // Sort widgets left to right
                const sortedWidgets = [...widgetsToPushHorz].sort((a, b) => a.x - b.x);

                // Calculate total gaps between widgets in the chain
                let totalGaps = 0;
                for (let i = 0; i < sortedWidgets.length - 1; i++) {
                  const currentRightEdge = sortedWidgets[i].x + sortedWidgets[i].w;
                  const nextLeftEdge = sortedWidgets[i + 1].x;
                  const gap = nextLeftEdge - currentRightEdge;
                  if (gap > 0) {
                    totalGaps += gap;
                  }
                }

                // Space at the end (viewport edge - rightmost widget)
                const rightmostEdge = Math.max(...widgetsToPushHorz.map(w => w.x + w.w));
                let blockingEdge = GRID_CONFIG.cols;

                // Check for non-chain widgets blocking
                for (const nonChain of nonChainWidgets) {
                  const hasOverlapWithChain = widgetsToPushHorz.some(chainWidget =>
                    hasVerticalOverlapBetween(chainWidget, nonChain)
                  );
                  if (hasOverlapWithChain && nonChain.x >= rightmostEdge) {
                    blockingEdge = Math.min(blockingEdge, nonChain.x);
                  }
                }

                const spaceAtEnd = blockingEdge - rightmostEdge;
                const availablePushSpace = totalGaps + spaceAtEnd;

                console.log('Total gaps between widgets:', totalGaps);
                console.log('Rightmost widget edge:', rightmostEdge);
                console.log('Space at end:', spaceAtEnd);
                console.log('Total available push space:', availablePushSpace);
                pushAmountHorz = Math.min(pushAmountHorz, availablePushSpace);
                console.log('Actual push amount (limited):', pushAmountHorz);

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
                        console.log('Non-chain collision! Limiting push from', pushAmountHorz, 'to', maxPush);
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
                      console.log('Resizing widget collision! Limiting push from', pushAmountHorz, 'to', newPushAmount);
                      pushAmountHorz = newPushAmount;
                    }
                  }
                }
              }

              // Limit clampedW to respect available space (original width + gap fill + push)
              const maxAchievableWidth = resizingLayout.w + gapFillHorz + pushAmountHorz;
              if (clampedW > maxAchievableWidth) {
                console.log('Limiting clampedW from', clampedW, 'to', maxAchievableWidth);
                clampedW = maxAchievableWidth;
              }
            } else {
              // No widgets to push - can expand freely up to gap (or viewport edge if no gap)
              console.log('No adjacent widgets - free expansion up to gap:', gapFillHorz);
              // Use original width + gap fill
              const maxAchievableWidth = resizingLayout.w + gapFillHorz;
              if (clampedW > maxAchievableWidth) {
                console.log('Limiting clampedW from', clampedW, 'to', maxAchievableWidth);
                clampedW = maxAchievableWidth;
              }
            }

            // Only push if there's actual push needed (after gap fill)
            if (pushAmountHorz > 0) {
              // Sort widgets left to right for cascading calculation (same as horizontal resize)
              const sortedWidgets = [...widgetsToPushHorz].sort((a, b) => a.x - b.x);

              console.log('=== CASCADING POSITION CALC (CORNER HORZ) ===');
              console.log('Actual push:', pushAmountHorz);

              // Calculate the resizing widget's new right edge (same as horizontal-only resize)
              const resizingNewRightEdge = resizingLayout.x + clampedW;

              // Process widgets from left to right - SAME LOGIC AS HORIZONTAL-ONLY RESIZE
              for (let i = 0; i < sortedWidgets.length; i++) {
                const w = sortedWidgets[i];

                // Find the widget that would actually push this widget
                // It must be: to the left of this widget AND have vertical overlap with this widget
                let pushForThisWidget = pushAmountHorz; // Default: pushed by resizing widget

                // Check if any already-processed widget is to the left AND has vertical overlap
                let pushedByWidget: typeof w | null = null;
                let maxPushFromChain = 0;

                for (let j = 0; j < i; j++) {
                  const prevWidget = sortedWidgets[j];
                  const prevNewX = horzPositions.get(prevWidget.id) ?? prevWidget.x;
                  const prevNewRightEdge = prevNewX + prevWidget.w;

                  // Check if prevWidget has vertical overlap with current widget
                  const hasVertOverlap = !(prevWidget.y + prevWidget.h <= w.y || prevWidget.y >= w.y + w.h);

                  // Check if prevWidget is actually to the left (before pushing) AND its new right edge reaches us
                  if (hasVertOverlap && prevWidget.x + prevWidget.w <= w.x) {
                    if (prevNewRightEdge > w.x) {
                      const cascadePush = prevNewRightEdge - w.x;
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
                  console.log(`  Widget ${w.id.slice(-8)}: cascaded from ${pushedByWidget.id.slice(-8)}, push=${pushForThisWidget}`);
                } else {
                  // Check if resizing widget's new right edge reaches us
                  if (resizingNewRightEdge > w.x) {
                    pushForThisWidget = resizingNewRightEdge - w.x;
                    console.log(`  Widget ${w.id.slice(-8)}: pushed by resizing widget, push=${pushForThisWidget}`);
                  } else {
                    pushForThisWidget = 0;
                    console.log(`  Widget ${w.id.slice(-8)}: no push needed (gap exists)`);
                  }
                }

                if (pushForThisWidget <= 0) {
                  horzPositions.set(w.id, w.x);
                  console.log(`  Widget ${w.id.slice(-8)}: stays at x=${w.x}`);
                } else {
                  const maxMove = GRID_CONFIG.cols - w.w - w.x;
                  const actualMove = Math.min(pushForThisWidget, maxMove);
                  const newX = w.x + actualMove;
                  horzPositions.set(w.id, newX);
                  console.log(`  Widget ${w.id.slice(-8)}: moves to x=${newX} (push=${pushForThisWidget}, actualMove=${actualMove})`);
                }
              }

              console.log('=== END CASCADING CALC ===');
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
            const pushAmountHorz = Math.max(0, horizontalExpansion - gapToFirstWidget);

            const directPushWidgets = widgetsToLeft.filter(w => hasVerticalOverlapBetween(resizingBoundsForHorz, w));
            const pushedSet = new Set<string>();
            const queue = [...directPushWidgets];

            while (queue.length > 0) {
              const current = queue.shift()!;
              if (pushedSet.has(current.id)) continue;
              pushedSet.add(current.id);
              widgetsToPushHorz.push(current);

              for (const other of widgetsToLeft) {
                if (pushedSet.has(other.id)) continue;
                if (other.x + other.w > current.x) continue;
                const hasOverlap = !(current.y + current.h <= other.y || current.y >= other.y + other.h);
                if (hasOverlap) queue.push(other);
              }
            }

            widgetsToPushHorz.sort((a, b) => b.x - a.x);

            if (pushAmountHorz > 0) {
              const newLeftEdgeAfterGap = originalLeftEdge - gapFillHorz - pushAmountHorz;

              for (const widget of widgetsToPushHorz) {
                let pushForThisWidget = 0;

                for (const prevWidget of widgetsToPushHorz) {
                  if (prevWidget.id === widget.id) continue;
                  const prevNewX = horzPositions.get(prevWidget.id);
                  if (prevNewX === undefined) continue;

                  const hasVertOverlap = !(prevWidget.y + prevWidget.h <= widget.y || prevWidget.y >= widget.y + widget.h);
                  const wRightEdge = widget.x + widget.w;

                  if (hasVertOverlap && prevWidget.x >= wRightEdge && prevNewX < wRightEdge) {
                    const cascadePush = wRightEdge - prevNewX;
                    if (cascadePush > pushForThisWidget) pushForThisWidget = cascadePush;
                  }
                }

                if (pushForThisWidget === 0) {
                  const wRightEdge = widget.x + widget.w;
                  if (newLeftEdgeAfterGap < wRightEdge) pushForThisWidget = wRightEdge - newLeftEdgeAfterGap;
                }

                if (pushForThisWidget > 0) {
                  horzPositions.set(widget.id, Math.max(0, widget.x - pushForThisWidget));
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

        console.log('=== CORNER VERTICAL CHECK ===');
        console.log('requestedH:', requestedH, 'resizingLayout.h:', resizingLayout.h);
        console.log('Will process vertical?', requestedH > resizingLayout.h);

        // Check if user is REQUESTING vertical expansion (use requestedH, not clampedH)
        // This allows continuous resize - as user drags further, expansion keeps increasing
        if (requestedH > resizingLayout.h) {
          const verticalExpansion = requestedH - resizingLayout.h;
          console.log('=== CORNER VERTICAL PUSH ===');
          console.log('Vertical expansion:', verticalExpansion);

          // Collect ALL widgets to push using BFS chain detection
          const widgetsToPushVert: typeof allWidgets = [];

          if (isSouthResize) {
            console.log('=== CORNER SOUTH RESIZE ===');
            const widgetsBelow = allWidgets
              .filter(w => w.y >= originalBottomEdge)
              .sort((a, b) => a.y - b.y);

            console.log('Current bottom edge:', originalBottomEdge);
            console.log('Widgets below:', widgetsBelow.length);
            widgetsBelow.forEach(w => console.log(`  - ${w.id.slice(-8)}: y=${w.y}, h=${w.h}`));

            // Find gap to first widget with horizontal overlap
            let gapToFirstWidget = maxRows - originalBottomEdge;
            const widgetsWithOverlap = widgetsBelow.filter(w => hasHorizontalOverlapBetween(resizingBoundsForVert, w));
            console.log('Widgets with horizontal overlap:', widgetsWithOverlap.length);
            if (widgetsWithOverlap.length > 0) {
              widgetsWithOverlap.sort((a, b) => a.y - b.y);
              gapToFirstWidget = widgetsWithOverlap[0].y - originalBottomEdge;
              console.log('First widget with overlap:', widgetsWithOverlap[0].id.slice(-8), 'at y=', widgetsWithOverlap[0].y);
            }

            // Calculate gap fill vs push
            const gapFillVert = Math.min(verticalExpansion, gapToFirstWidget);
            let pushAmountVert = Math.max(0, verticalExpansion - gapToFirstWidget);
            console.log('Gap to first widget:', gapToFirstWidget);
            console.log('Gap fill:', gapFillVert, 'Initial push amount:', pushAmountVert);

            // BFS chain detection - same as vertical resize
            // Start with ALL widgets that have horizontal overlap with resizing widget (not just adjacent)
            const directPushWidgets = widgetsBelow.filter(w =>
              hasHorizontalOverlapBetween(resizingBoundsForVert, w)
            );
            console.log('Direct push widgets (horizontal overlap):', directPushWidgets.length);
            directPushWidgets.forEach(w => console.log(`  Direct: ${w.id.slice(-8)}: y=${w.y}`));

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

                console.log('Total gaps between widgets:', totalGaps);
                console.log('Bottommost widget edge:', bottommostEdge);
                console.log('Space at end:', spaceAtEnd);
                console.log('Total available push space:', availablePushSpace);
                pushAmountVert = Math.min(pushAmountVert, availablePushSpace);
                console.log('Actual push amount (limited):', pushAmountVert);

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
                        console.log('Non-chain collision (vert)! Limiting push from', pushAmountVert, 'to', maxPush);
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
                      console.log('Resizing widget collision (vert)! Limiting push from', pushAmountVert, 'to', newPushAmount);
                      pushAmountVert = newPushAmount;
                    }
                  }
                }
              }

              // Limit clampedH to respect available space (original height + gap fill + push)
              const maxAchievableHeight = resizingLayout.h + gapFillVert + pushAmountVert;
              if (clampedH > maxAchievableHeight) {
                console.log('Limiting clampedH from', clampedH, 'to', maxAchievableHeight);
                clampedH = maxAchievableHeight;
              }
            } else {
              // No widgets to push - can expand freely up to gap (or viewport edge if no gap)
              console.log('No adjacent widgets (vert) - free expansion up to gap:', gapFillVert);
              // Use original height + gap fill
              const maxAchievableHeight = resizingLayout.h + gapFillVert;
              if (clampedH > maxAchievableHeight) {
                console.log('Limiting clampedH from', clampedH, 'to', maxAchievableHeight);
                clampedH = maxAchievableHeight;
              }
            }

            // Only push if there's actual push needed (after gap fill)
            if (pushAmountVert > 0) {
              // Sort widgets top to bottom for cascading calculation (same as vertical resize)
              const sortedWidgets = [...widgetsToPushVert].sort((a, b) => a.y - b.y);

              console.log('=== CASCADING POSITION CALC (CORNER VERT) ===');
              console.log('Actual push:', pushAmountVert);

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
                  console.log(`  Widget ${w.id.slice(-8)}: cascaded from ${pushedByWidget.id.slice(-8)}, push=${pushForThisWidget}`);
                } else {
                  // Check if resizing widget's new bottom edge reaches us
                  if (resizingNewBottomEdge > w.y) {
                    pushForThisWidget = resizingNewBottomEdge - w.y;
                    console.log(`  Widget ${w.id.slice(-8)}: pushed by resizing widget, push=${pushForThisWidget}`);
                  } else {
                    pushForThisWidget = 0;
                    console.log(`  Widget ${w.id.slice(-8)}: no push needed (gap exists)`);
                  }
                }

                if (pushForThisWidget <= 0) {
                  vertPositions.set(w.id, w.y);
                  console.log(`  Widget ${w.id.slice(-8)}: stays at y=${w.y}`);
                } else {
                  const maxMove = maxRows - w.h - w.y;
                  const actualMove = Math.min(pushForThisWidget, maxMove);
                  const newY = w.y + actualMove;
                  vertPositions.set(w.id, newY);
                  console.log(`  Widget ${w.id.slice(-8)}: moves to y=${newY} (push=${pushForThisWidget}, actualMove=${actualMove})`);
                }
              }

              console.log('=== END CASCADING CALC ===');
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
            const pushAmountVert = Math.max(0, verticalExpansion - gapToFirstWidget);

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

            if (pushAmountVert > 0) {
              const newTopEdgeAfterGap = originalTopEdge - gapFillVert - pushAmountVert;

              for (const widget of widgetsToPushVert) {
                let pushForThisWidget = 0;

                for (const prevWidget of widgetsToPushVert) {
                  if (prevWidget.id === widget.id) continue;
                  const prevNewY = vertPositions.get(prevWidget.id);
                  if (prevNewY === undefined) continue;

                  const hasHorzOverlap = !(prevWidget.x + prevWidget.w <= widget.x || prevWidget.x >= widget.x + widget.w);
                  const wBottomEdge = widget.y + widget.h;

                  if (hasHorzOverlap && prevWidget.y >= wBottomEdge && prevNewY < wBottomEdge) {
                    const cascadePush = wBottomEdge - prevNewY;
                    if (cascadePush > pushForThisWidget) pushForThisWidget = cascadePush;
                  }
                }

                if (pushForThisWidget === 0) {
                  const wBottomEdge = widget.y + widget.h;
                  if (newTopEdgeAfterGap < wBottomEdge) pushForThisWidget = wBottomEdge - newTopEdgeAfterGap;
                }

                if (pushForThisWidget > 0) {
                  vertPositions.set(widget.id, Math.max(0, widget.y - pushForThisWidget));
                }
              }
            }
          }
        }

        // Determine if we're expanding in each direction
        const isExpandingHorz = clampedW > resizingLayout.w;
        const isExpandingVert = clampedH > resizingLayout.h;

        // Apply DOM updates
        resizeWidgetDom(resizingWidgetIdRef.current, clampedW, clampedH);
        if (isWestResize || isNorthResize) {
          moveWidgetDom(resizingWidgetIdRef.current, clampedX, clampedY);
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
            return { ...l, x: clampedX, y: clampedY, w: clampedW, h: clampedH };
          }
          // For horizontal: use pushed position if expanding horizontally, otherwise original
          const newX = isExpandingHorz ? (horzPositions.get(l.i) ?? l.x) : l.x;
          // For vertical: use pushed position if expanding vertically, otherwise original
          const newY = isExpandingVert ? (vertPositions.get(l.i) ?? l.y) : l.y;
          return { ...l, x: newX, y: newY };
        });

        // Validate
        const hasInvalidPosition = newLayouts.some(layout =>
          layout.x < 0 ||
          layout.x + layout.w > GRID_CONFIG.cols ||
          layout.y < 0 ||
          layout.y + layout.h > maxRows
        );

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
    console.log('[DEBUG] handleResize called');
    try {
    // CRITICAL: Our custom mousemove handler handles ALL resize directions for real-time feedback
    // Skip this callback entirely to prevent competing resize logic
    const direction = resizeDirectionRef.current;
    if (direction) {
      console.log('[DEBUG] handleResize: Skipping, handled by mousemove handler');
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
