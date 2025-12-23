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

// Cast GridLayout to any to work around type definition issues
const RGL = GridLayout as any;

export const DashboardLayout: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const { layouts, widgets, updateLayouts, removeWidget, addWidget, setMaxRows, previewWidget, newlyAddedWidgetId } = useLayout();

  // Store the last valid layout to revert to if resize pushes widgets outside viewport
  const lastValidLayoutRef = useRef<GridItemLayout[]>(layouts);
  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);

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

  const handleLayoutChange = useCallback((newLayout: GridItemLayout[]) => {
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

  // Handle resize start - store the current valid layout
  const handleResizeStart = useCallback((_layout: GridItemLayout[], _oldItem: GridItemLayout, _newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isResizingRef.current = true;
    lastValidLayoutRef.current = layouts.map(l => ({ ...l }));
    setResizePreview(null);
  }, [layouts]);

  // Handle resize stop - apply space management or validate layout
  const handleResizeStop = useCallback((newLayout: GridItemLayout[], oldItem: GridItemLayout, newItem: GridItemLayout, _placeholder: GridItemLayout, _e: MouseEvent, _element: HTMLElement) => {
    isResizingRef.current = false;
    const cols = GRID_CONFIG.cols;

    // Feature 6: Apply resize space management if preview is active
    if (resizePreview && resizePreview.newLayouts.length > 0) {
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
      updateLayouts(validLayout);
      setResizePreview(null);
      return;
    }

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

  // Feature 6: Handle resize to detect space management needs
  // Supports resizing from all directions (top, bottom, left, right)
  const handleResize = useCallback((
    _layout: GridItemLayout[],
    oldItem: GridItemLayout,
    newItem: GridItemLayout,
    _placeholder: GridItemLayout,
    _e: MouseEvent,
    _element: HTMLElement
  ) => {
    // Check if this is an enlargement (size increased OR position moved to expand)
    // Enlargement can happen in any direction:
    // - Right/Bottom: w or h increases
    // - Left: x decreases (widget expands left)
    // - Top: y decreases (widget expands up)
    const isEnlarging =
      newItem.w > oldItem.w ||
      newItem.h > oldItem.h ||
      newItem.x < oldItem.x ||
      newItem.y < oldItem.y;

    if (isEnlarging) {
      const widgetMinSizes = getWidgetMinSizes();
      const result = calculateResizeSpace(
        layouts,
        newItem.i,
        newItem.x,
        newItem.y,
        newItem.w,
        newItem.h,
        GRID_CONFIG.cols,
        maxRows,
        widgetMinSizes
      );

      if (result.canResize && (result.movedWidgets.length > 0 || result.shrunkWidgets.length > 0)) {
        setResizePreview({
          newLayouts: result.newLayouts,
          movedWidgets: result.movedWidgets,
          shrunkWidgets: result.shrunkWidgets,
        });
      } else {
        setResizePreview(null);
      }
    } else {
      // Feature 7: Shrinking - no preview needed, empty space will be preserved
      setResizePreview(null);
    }
  }, [layouts, maxRows, getWidgetMinSizes]);

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
    </div>
  );
};
