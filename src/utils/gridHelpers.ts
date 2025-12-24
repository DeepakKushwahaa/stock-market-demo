import type { GridItemLayout } from '../types/gridLayout.types';

// Occupancy grid representation
export interface OccupancyGrid {
  grid: boolean[][];
  cols: number;
  rows: number;
}

// Grid zone (position and size)
export interface GridZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Swap preview information (single widget swap)
export interface SwapPreview {
  sourceId: string;
  targetId: string;
  sourceNewPos: GridZone;
  targetNewPos: GridZone;
}

// Multi-widget swap preview information (large widget swapping with multiple small widgets)
export interface MultiSwapPreview {
  sourceId: string;
  targetIds: string[];
  sourceNewPos: GridZone;
  targetNewPositions: { id: string; pos: GridZone }[];
}

// Push calculation result
export interface PushResult {
  canPush: boolean;
  newLayouts: GridItemLayout[];
  pushedWidgets: string[];
}

// Resize space management result
export interface ResizeSpaceResult {
  canResize: boolean;
  newLayouts: GridItemLayout[];
  movedWidgets: string[];
  shrunkWidgets: string[];
}

// Widget minimum sizes lookup
export interface WidgetMinSizes {
  [widgetId: string]: { minW: number; minH: number };
}

// Auto-adjust result for adding new widget
export interface AutoAdjustResult {
  canAdd: boolean;
  adjustedLayouts: GridItemLayout[];
  newWidgetPosition: { x: number; y: number } | null;
  shrunkWidgets: string[];
}

/**
 * Create an occupancy grid from existing layouts
 * @param layouts - Array of grid item layouts
 * @param cols - Number of columns in the grid
 * @param maxRows - Maximum number of rows
 * @param excludeId - Optional widget ID to exclude from the grid
 * @returns OccupancyGrid with occupied cells marked as true
 */
export function createOccupancyGrid(
  layouts: GridItemLayout[],
  cols: number,
  maxRows: number,
  excludeId?: string
): OccupancyGrid {
  const grid: boolean[][] = [];
  for (let row = 0; row < maxRows; row++) {
    grid[row] = new Array(cols).fill(false);
  }

  for (const layout of layouts) {
    if (layout.i === excludeId) continue;
    for (let row = layout.y; row < Math.min(layout.y + layout.h, maxRows); row++) {
      for (let col = layout.x; col < Math.min(layout.x + layout.w, cols); col++) {
        if (row >= 0 && col >= 0 && grid[row]) {
          grid[row][col] = true;
        }
      }
    }
  }

  return { grid, cols, rows: maxRows };
}

/**
 * Check if a widget can fit at a specific position
 * @param occupancy - Occupancy grid
 * @param x - Target x position
 * @param y - Target y position
 * @param w - Widget width
 * @param h - Widget height
 * @returns true if the widget can fit at the position
 */
export function canFitAt(
  occupancy: OccupancyGrid,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  // Check bounds
  if (x < 0 || y < 0 || x + w > occupancy.cols || y + h > occupancy.rows) {
    return false;
  }

  // Check for occupied cells
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      if (occupancy.grid[row]?.[col]) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Find all positions where a widget of given size can fit
 * @param occupancy - Occupancy grid
 * @param widgetW - Widget width
 * @param widgetH - Widget height
 * @returns Array of positions where the widget can fit
 */
export function findAllFitPositions(
  occupancy: OccupancyGrid,
  widgetW: number,
  widgetH: number
): GridZone[] {
  const positions: GridZone[] = [];

  for (let y = 0; y <= occupancy.rows - widgetH; y++) {
    for (let x = 0; x <= occupancy.cols - widgetW; x++) {
      if (canFitAt(occupancy, x, y, widgetW, widgetH)) {
        positions.push({ x, y, w: widgetW, h: widgetH });
      }
    }
  }

  return positions;
}

/**
 * Clamp a position to ensure widget stays within viewport bounds
 * @param x - X position
 * @param y - Y position
 * @param w - Widget width
 * @param h - Widget height
 * @param cols - Number of columns
 * @param maxRows - Maximum rows
 * @returns Clamped position
 */
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  cols: number,
  maxRows: number
): { x: number; y: number } {
  let clampedX = x;
  let clampedY = y;

  // Clamp to left/top bounds
  if (clampedX < 0) clampedX = 0;
  if (clampedY < 0) clampedY = 0;

  // Clamp to right/bottom bounds
  if (clampedX + w > cols) clampedX = Math.max(0, cols - w);
  if (clampedY + h > maxRows) clampedY = Math.max(0, maxRows - h);

  return { x: clampedX, y: clampedY };
}

/**
 * Adjust all layouts to fit within viewport, finding valid positions for any that don't fit
 * @param layouts - Array of layouts to adjust
 * @param cols - Number of columns
 * @param maxRows - Maximum rows
 * @returns Adjusted layouts with all widgets within viewport
 */
export function adjustLayoutsToViewport(
  layouts: GridItemLayout[],
  cols: number,
  maxRows: number
): GridItemLayout[] {
  const adjustedLayouts: GridItemLayout[] = [];
  const occupancy = createOccupancyGrid([], cols, maxRows);

  // Sort by position (top-left first) to maintain relative positions
  const sortedLayouts = [...layouts].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  for (const layout of sortedLayouts) {
    // First, clamp the position to viewport
    let { x, y } = clampToViewport(layout.x, layout.y, layout.w, layout.h, cols, maxRows);

    // Check if clamped position is available
    if (canFitAt(occupancy, x, y, layout.w, layout.h)) {
      // Mark as occupied
      for (let row = y; row < Math.min(y + layout.h, maxRows); row++) {
        for (let col = x; col < Math.min(x + layout.w, cols); col++) {
          if (occupancy.grid[row]) {
            occupancy.grid[row][col] = true;
          }
        }
      }
      adjustedLayouts.push({ ...layout, x, y });
    } else {
      // Find nearest available position
      const newPos = findBestPositionNearExported(occupancy, x, y, layout.w, layout.h, cols, maxRows);
      if (newPos) {
        // Mark as occupied
        for (let row = newPos.y; row < Math.min(newPos.y + layout.h, maxRows); row++) {
          for (let col = newPos.x; col < Math.min(newPos.x + layout.w, cols); col++) {
            if (occupancy.grid[row]) {
              occupancy.grid[row][col] = true;
            }
          }
        }
        adjustedLayouts.push({ ...layout, x: newPos.x, y: newPos.y });
      } else {
        // Last resort: find any available position
        const anyPos = findFirstFitPosition(occupancy, layout.w, layout.h);
        if (anyPos) {
          for (let row = anyPos.y; row < Math.min(anyPos.y + layout.h, maxRows); row++) {
            for (let col = anyPos.x; col < Math.min(anyPos.x + layout.w, cols); col++) {
              if (occupancy.grid[row]) {
                occupancy.grid[row][col] = true;
              }
            }
          }
          adjustedLayouts.push({ ...layout, x: anyPos.x, y: anyPos.y });
        } else {
          // Can't fit - keep original (clamped) position as fallback
          adjustedLayouts.push({ ...layout, x, y });
        }
      }
    }
  }

  // Final safety: force clamp all positions to ensure nothing is outside viewport
  return adjustedLayouts.map(layout => {
    const clamped = clampToViewport(layout.x, layout.y, layout.w, layout.h, cols, maxRows);
    return { ...layout, x: clamped.x, y: clamped.y };
  });
}

/**
 * Force all layouts to fit within viewport bounds (simple clamp without collision detection)
 * Use this as a last resort safety check
 */
export function forceLayoutsInViewport(
  layouts: GridItemLayout[],
  cols: number,
  maxRows: number
): GridItemLayout[] {
  return layouts.map(layout => {
    let x = layout.x;
    let y = layout.y;

    // Force within bounds
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + layout.w > cols) x = Math.max(0, cols - layout.w);
    if (y + layout.h > maxRows) y = Math.max(0, maxRows - layout.h);

    return { ...layout, x, y };
  });
}

/**
 * Find the first position where a widget can fit
 * @param occupancy - Occupancy grid
 * @param widgetW - Widget width
 * @param widgetH - Widget height
 * @returns First available position or null
 */
export function findFirstFitPosition(
  occupancy: OccupancyGrid,
  widgetW: number,
  widgetH: number
): { x: number; y: number } | null {
  for (let y = 0; y <= occupancy.rows - widgetH; y++) {
    for (let x = 0; x <= occupancy.cols - widgetW; x++) {
      if (canFitAt(occupancy, x, y, widgetW, widgetH)) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * Find contiguous empty regions in the grid
 * @param occupancy - Occupancy grid
 * @returns Array of empty rectangular regions
 */
export function findEmptyRegions(occupancy: OccupancyGrid): GridZone[] {
  const regions: GridZone[] = [];
  const visited: boolean[][] = occupancy.grid.map(row => row.map(() => false));

  for (let y = 0; y < occupancy.rows; y++) {
    for (let x = 0; x < occupancy.cols; x++) {
      if (!occupancy.grid[y][x] && !visited[y][x]) {
        // Find width of empty cells in this row
        let maxW = 0;
        for (let col = x; col < occupancy.cols && !occupancy.grid[y][col]; col++) {
          maxW++;
        }

        // Find height maintaining the width
        let maxH = 0;
        for (let row = y; row < occupancy.rows; row++) {
          let rowEmpty = true;
          for (let col = x; col < x + maxW; col++) {
            if (occupancy.grid[row][col]) {
              rowEmpty = false;
              break;
            }
          }
          if (rowEmpty) {
            maxH++;
          } else {
            break;
          }
        }

        // Mark cells as visited
        for (let row = y; row < y + maxH; row++) {
          for (let col = x; col < x + maxW; col++) {
            visited[row][col] = true;
          }
        }

        regions.push({ x, y, w: maxW, h: maxH });
      }
    }
  }

  return regions;
}

/**
 * Get the widget at a specific grid position
 * @param layouts - Array of grid item layouts
 * @param x - Grid x position
 * @param y - Grid y position
 * @param excludeId - Optional widget ID to exclude
 * @returns The widget layout at the position or null
 */
export function getWidgetAtPosition(
  layouts: GridItemLayout[],
  x: number,
  y: number,
  excludeId?: string
): GridItemLayout | null {
  for (const layout of layouts) {
    if (layout.i === excludeId) continue;
    if (
      x >= layout.x &&
      x < layout.x + layout.w &&
      y >= layout.y &&
      y < layout.y + layout.h
    ) {
      return layout;
    }
  }
  return null;
}

/**
 * Check if two zones overlap
 */
function zonesOverlap(a: GridZone, b: GridZone): boolean {
  return !(
    a.x >= b.x + b.w ||
    a.x + a.w <= b.x ||
    a.y >= b.y + b.h ||
    a.y + a.h <= b.y
  );
}

/**
 * Try to push a widget in a specific direction
 */
function tryPushInDirection(
  layouts: GridItemLayout[],
  widgetId: string,
  dx: number,
  dy: number,
  avoidZone: GridZone,
  cols: number,
  maxRows: number,
  excludeId?: string
): GridItemLayout[] | null {
  const widget = layouts.find(l => l.i === widgetId);
  if (!widget) return null;

  const newX = widget.x + dx;
  const newY = widget.y + dy;

  // Check bounds
  if (newX < 0 || newX + widget.w > cols || newY < 0 || newY + widget.h > maxRows) {
    return null;
  }

  // Check if new position overlaps with avoid zone
  const newZone: GridZone = { x: newX, y: newY, w: widget.w, h: widget.h };
  if (zonesOverlap(newZone, avoidZone)) {
    return null;
  }

  // Create occupancy grid excluding the widget being pushed and the exclude ID
  const occupancy = createOccupancyGrid(
    layouts.filter(l => l.i !== widgetId && l.i !== excludeId),
    cols,
    maxRows
  );

  // Mark avoid zone as occupied
  for (let row = avoidZone.y; row < Math.min(avoidZone.y + avoidZone.h, maxRows); row++) {
    for (let col = avoidZone.x; col < Math.min(avoidZone.x + avoidZone.w, cols); col++) {
      if (occupancy.grid[row]) {
        occupancy.grid[row][col] = true;
      }
    }
  }

  if (canFitAt(occupancy, newX, newY, widget.w, widget.h)) {
    return layouts.map(l =>
      l.i === widgetId ? { ...l, x: newX, y: newY } : l
    );
  }

  return null;
}

/**
 * Calculate push operations to make space for a widget
 * @param layouts - Current layouts
 * @param targetX - Target x position
 * @param targetY - Target y position
 * @param targetW - Target widget width
 * @param targetH - Target widget height
 * @param cols - Number of columns
 * @param maxRows - Maximum rows
 * @param excludeId - Optional widget ID to exclude
 * @returns PushResult with new layouts if push is possible
 */
export function calculatePush(
  layouts: GridItemLayout[],
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number,
  cols: number,
  maxRows: number,
  excludeId?: string
): PushResult {
  const targetZone: GridZone = { x: targetX, y: targetY, w: targetW, h: targetH };

  // Find widgets that overlap with target position
  const overlappingWidgets = layouts.filter(l => {
    if (l.i === excludeId) return false;
    const widgetZone: GridZone = { x: l.x, y: l.y, w: l.w, h: l.h };
    return zonesOverlap(widgetZone, targetZone);
  });

  if (overlappingWidgets.length === 0) {
    return { canPush: true, newLayouts: layouts, pushedWidgets: [] };
  }

  let workingLayouts = layouts.map(l => ({ ...l }));
  const pushedWidgets: string[] = [];

  // Try to push each overlapping widget
  // Push priority: right, down, left, up
  for (const widget of overlappingWidgets) {
    const directions = [
      { dx: targetW, dy: 0 },   // Push right
      { dx: 0, dy: targetH },   // Push down
      { dx: -widget.w, dy: 0 }, // Push left
      { dx: 0, dy: -widget.h }, // Push up
    ];

    let pushed = false;
    for (const dir of directions) {
      const result = tryPushInDirection(
        workingLayouts,
        widget.i,
        dir.dx,
        dir.dy,
        targetZone,
        cols,
        maxRows,
        excludeId
      );

      if (result) {
        workingLayouts = result;
        pushedWidgets.push(widget.i);
        pushed = true;
        break;
      }
    }

    if (!pushed) {
      return { canPush: false, newLayouts: layouts, pushedWidgets: [] };
    }
  }

  return { canPush: true, newLayouts: workingLayouts, pushedWidgets };
}

/**
 * Calculate space management for widget resize
 * Supports resizing from all directions (top, bottom, left, right)
 * @param layouts - Current layouts
 * @param resizingId - ID of the widget being resized
 * @param newX - New x position (may change when resizing from left)
 * @param newY - New y position (may change when resizing from top)
 * @param newW - New width
 * @param newH - New height
 * @param cols - Number of columns
 * @param maxRows - Maximum rows
 * @param widgetMinSizes - Minimum sizes for each widget
 * @returns ResizeSpaceResult with new layouts if resize is possible
 */
export function calculateResizeSpace(
  layouts: GridItemLayout[],
  resizingId: string,
  newX: number,
  newY: number,
  newW: number,
  newH: number,
  cols: number,
  maxRows: number,
  widgetMinSizes: WidgetMinSizes
): ResizeSpaceResult {
  const resizingWidget = layouts.find(l => l.i === resizingId);
  if (!resizingWidget) {
    return { canResize: false, newLayouts: layouts, movedWidgets: [], shrunkWidgets: [] };
  }

  const newBounds: GridZone = {
    x: newX,
    y: newY,
    w: newW,
    h: newH,
  };

  // Check bounds (including negative positions for top/left resize)
  if (newBounds.x < 0 || newBounds.y < 0 || newBounds.x + newBounds.w > cols || newBounds.y + newBounds.h > maxRows) {
    return { canResize: false, newLayouts: layouts, movedWidgets: [], shrunkWidgets: [] };
  }

  // Find widgets that would be affected
  const affectedWidgets = layouts.filter(l => {
    if (l.i === resizingId) return false;
    const widgetZone: GridZone = { x: l.x, y: l.y, w: l.w, h: l.h };
    return zonesOverlap(widgetZone, newBounds);
  });

  if (affectedWidgets.length === 0) {
    // No conflicts, resize directly (including position change for top/left resize)
    const newLayouts = layouts.map(l =>
      l.i === resizingId ? { ...l, x: newX, y: newY, w: newW, h: newH } : l
    );
    return { canResize: true, newLayouts, movedWidgets: [], shrunkWidgets: [] };
  }

  let workingLayouts = layouts.map(l => ({ ...l }));
  const movedWidgets: string[] = [];
  const shrunkWidgets: string[] = [];
  let stillAffected = [...affectedWidgets];

  // Phase 1: Try to move affected widgets to empty spaces
  for (const widget of stillAffected) {
    const occupancy = createOccupancyGrid(
      workingLayouts.filter(l => l.i !== widget.i && l.i !== resizingId),
      cols,
      maxRows
    );

    // Mark new bounds of resizing widget as occupied
    for (let r = newBounds.y; r < Math.min(newBounds.y + newBounds.h, maxRows); r++) {
      for (let c = newBounds.x; c < Math.min(newBounds.x + newBounds.w, cols); c++) {
        if (occupancy.grid[r]) {
          occupancy.grid[r][c] = true;
        }
      }
    }

    // Find empty space for this widget
    const emptySpot = findFirstFitPosition(occupancy, widget.w, widget.h);

    if (emptySpot) {
      workingLayouts = workingLayouts.map(l =>
        l.i === widget.i ? { ...l, x: emptySpot.x, y: emptySpot.y } : l
      );
      movedWidgets.push(widget.i);
      stillAffected = stillAffected.filter(w => w.i !== widget.i);
    }
  }

  // Phase 2: If still affected widgets remain, try shrinking (largest first)
  if (stillAffected.length > 0) {
    // Sort by size (largest first)
    stillAffected.sort((a, b) => (b.w * b.h) - (a.w * a.h));

    for (const widget of stillAffected) {
      const minSizes = widgetMinSizes[widget.i] || { minW: 2, minH: 2 };
      const currentWidget = workingLayouts.find(l => l.i === widget.i);
      if (!currentWidget) continue;

      // Calculate overlap amounts
      const overlapRight = Math.max(0, (newBounds.x + newBounds.w) - currentWidget.x);
      const overlapBottom = Math.max(0, (newBounds.y + newBounds.h) - currentWidget.y);
      const overlapLeft = Math.max(0, (currentWidget.x + currentWidget.w) - newBounds.x);
      const overlapTop = Math.max(0, (currentWidget.y + currentWidget.h) - newBounds.y);

      let shrinkSuccess = false;

      // Try shrinking from the side closest to the resizing widget
      // Shrink from left (move widget right and reduce width)
      if (overlapRight > 0 && currentWidget.w - overlapRight >= minSizes.minW) {
        workingLayouts = workingLayouts.map(l =>
          l.i === widget.i
            ? { ...l, x: l.x + overlapRight, w: l.w - overlapRight }
            : l
        );
        shrunkWidgets.push(widget.i);
        shrinkSuccess = true;
      }
      // Shrink from top (move widget down and reduce height)
      else if (overlapBottom > 0 && currentWidget.h - overlapBottom >= minSizes.minH) {
        workingLayouts = workingLayouts.map(l =>
          l.i === widget.i
            ? { ...l, y: l.y + overlapBottom, h: l.h - overlapBottom }
            : l
        );
        if (!shrinkSuccess) shrunkWidgets.push(widget.i);
        shrinkSuccess = true;
      }
      // Shrink from right (just reduce width)
      else if (overlapLeft > 0 && currentWidget.w - overlapLeft >= minSizes.minW) {
        workingLayouts = workingLayouts.map(l =>
          l.i === widget.i
            ? { ...l, w: l.w - overlapLeft }
            : l
        );
        if (!shrinkSuccess) shrunkWidgets.push(widget.i);
        shrinkSuccess = true;
      }
      // Shrink from bottom (just reduce height)
      else if (overlapTop > 0 && currentWidget.h - overlapTop >= minSizes.minH) {
        workingLayouts = workingLayouts.map(l =>
          l.i === widget.i
            ? { ...l, h: l.h - overlapTop }
            : l
        );
        if (!shrinkSuccess) shrunkWidgets.push(widget.i);
        shrinkSuccess = true;
      }

      if (!shrinkSuccess) {
        // Cannot accommodate this resize
        return { canResize: false, newLayouts: layouts, movedWidgets: [], shrunkWidgets: [] };
      }
    }
  }

  // Apply resize to the resizing widget (including position change for top/left resize)
  workingLayouts = workingLayouts.map(l =>
    l.i === resizingId ? { ...l, x: newX, y: newY, w: newW, h: newH } : l
  );

  return { canResize: true, newLayouts: workingLayouts, movedWidgets, shrunkWidgets };
}

/**
 * Calculate swap preview positions for two widgets
 * Returns the positions where both widgets would end up after a swap,
 * with each widget keeping its original size
 * @param layouts - Current layouts
 * @param sourceId - Source widget ID (being dragged)
 * @param targetId - Target widget ID (being swapped with)
 * @param cols - Number of columns in the grid
 * @param maxRows - Maximum rows in the grid
 * @returns Preview positions for both widgets, or null if swap not possible
 */
export function calculateSwapPreview(
  layouts: GridItemLayout[],
  sourceId: string,
  targetId: string,
  cols: number,
  maxRows: number
): { sourceNewPos: GridZone; targetNewPos: GridZone } | null {
  const sourceLayout = layouts.find(l => l.i === sourceId);
  const targetLayout = layouts.find(l => l.i === targetId);

  if (!sourceLayout || !targetLayout) {
    return null;
  }

  // Create occupancy grid excluding both source and target widgets
  const occupancy = createOccupancyGrid(layouts, cols, maxRows, sourceId);
  // Also exclude target from the occupancy
  for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, maxRows); row++) {
    for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, cols); col++) {
      if (occupancy.grid[row]) {
        occupancy.grid[row][col] = false;
      }
    }
  }

  // Calculate where source would go (target's position, adjusted for source's size)
  let sourceNewX = targetLayout.x;
  let sourceNewY = targetLayout.y;

  // Adjust if source doesn't fit at target's exact position due to size differences
  if (sourceNewX + sourceLayout.w > cols) {
    sourceNewX = cols - sourceLayout.w;
  }
  if (sourceNewX < 0) sourceNewX = 0;
  if (sourceNewY + sourceLayout.h > maxRows) {
    sourceNewY = maxRows - sourceLayout.h;
  }
  if (sourceNewY < 0) sourceNewY = 0;

  // Calculate where target would go (source's position, adjusted for target's size)
  let targetNewX = sourceLayout.x;
  let targetNewY = sourceLayout.y;

  // Adjust if target doesn't fit at source's exact position due to size differences
  if (targetNewX + targetLayout.w > cols) {
    targetNewX = cols - targetLayout.w;
  }
  if (targetNewX < 0) targetNewX = 0;
  if (targetNewY + targetLayout.h > maxRows) {
    targetNewY = maxRows - targetLayout.h;
  }
  if (targetNewY < 0) targetNewY = 0;

  // Check if positions overlap - if so, we need to find alternative positions
  const sourceNewZone: GridZone = { x: sourceNewX, y: sourceNewY, w: sourceLayout.w, h: sourceLayout.h };
  const targetNewZone: GridZone = { x: targetNewX, y: targetNewY, w: targetLayout.w, h: targetLayout.h };

  if (zonesOverlap(sourceNewZone, targetNewZone)) {
    // Try to find non-overlapping positions
    // Place source at target position, then find best spot for target near source's original position
    const tempOccupancy = createOccupancyGrid(layouts, cols, maxRows, sourceId);
    for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, maxRows); row++) {
      for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, cols); col++) {
        if (tempOccupancy.grid[row]) {
          tempOccupancy.grid[row][col] = false;
        }
      }
    }
    // Mark source's new position as occupied
    for (let row = sourceNewY; row < Math.min(sourceNewY + sourceLayout.h, maxRows); row++) {
      for (let col = sourceNewX; col < Math.min(sourceNewX + sourceLayout.w, cols); col++) {
        if (tempOccupancy.grid[row]) {
          tempOccupancy.grid[row][col] = true;
        }
      }
    }

    // Find best position for target near source's original position
    const targetPos = findBestPositionNearExported(
      tempOccupancy,
      sourceLayout.x,
      sourceLayout.y,
      targetLayout.w,
      targetLayout.h,
      cols,
      maxRows
    );

    if (targetPos) {
      targetNewX = targetPos.x;
      targetNewY = targetPos.y;
    } else {
      return null; // Can't find valid swap positions
    }
  } else {
    // Check if both can actually fit at their positions
    const sourceCanFit = canFitAt(occupancy, sourceNewX, sourceNewY, sourceLayout.w, sourceLayout.h);

    // Create occupancy with source placed to check target
    const occupancyWithSource = createOccupancyGrid(layouts, cols, maxRows, sourceId);
    for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, maxRows); row++) {
      for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, cols); col++) {
        if (occupancyWithSource.grid[row]) {
          occupancyWithSource.grid[row][col] = false;
        }
      }
    }
    for (let row = sourceNewY; row < Math.min(sourceNewY + sourceLayout.h, maxRows); row++) {
      for (let col = sourceNewX; col < Math.min(sourceNewX + sourceLayout.w, cols); col++) {
        if (occupancyWithSource.grid[row]) {
          occupancyWithSource.grid[row][col] = true;
        }
      }
    }

    const targetCanFit = canFitAt(occupancyWithSource, targetNewX, targetNewY, targetLayout.w, targetLayout.h);

    if (!sourceCanFit || !targetCanFit) {
      // Try to find alternative positions
      if (!sourceCanFit) {
        const sourcePos = findBestPositionNearExported(occupancy, targetLayout.x, targetLayout.y, sourceLayout.w, sourceLayout.h, cols, maxRows);
        if (!sourcePos) return null;
        sourceNewX = sourcePos.x;
        sourceNewY = sourcePos.y;
      }

      // Recalculate occupancy with source placed
      const newOccupancy = createOccupancyGrid(layouts, cols, maxRows, sourceId);
      for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, maxRows); row++) {
        for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, cols); col++) {
          if (newOccupancy.grid[row]) {
            newOccupancy.grid[row][col] = false;
          }
        }
      }
      for (let row = sourceNewY; row < Math.min(sourceNewY + sourceLayout.h, maxRows); row++) {
        for (let col = sourceNewX; col < Math.min(sourceNewX + sourceLayout.w, cols); col++) {
          if (newOccupancy.grid[row]) {
            newOccupancy.grid[row][col] = true;
          }
        }
      }

      if (!canFitAt(newOccupancy, targetNewX, targetNewY, targetLayout.w, targetLayout.h)) {
        const targetPos = findBestPositionNearExported(newOccupancy, sourceLayout.x, sourceLayout.y, targetLayout.w, targetLayout.h, cols, maxRows);
        if (!targetPos) return null;
        targetNewX = targetPos.x;
        targetNewY = targetPos.y;
      }
    }
  }

  // Final validation: ensure both widgets are within viewport bounds
  if (sourceNewX < 0 || sourceNewY < 0 ||
      sourceNewX + sourceLayout.w > cols || sourceNewY + sourceLayout.h > maxRows) {
    return null;
  }
  if (targetNewX < 0 || targetNewY < 0 ||
      targetNewX + targetLayout.w > cols || targetNewY + targetLayout.h > maxRows) {
    return null;
  }

  return {
    sourceNewPos: { x: sourceNewX, y: sourceNewY, w: sourceLayout.w, h: sourceLayout.h },
    targetNewPos: { x: targetNewX, y: targetNewY, w: targetLayout.w, h: targetLayout.h },
  };
}

/**
 * Exported version of findBestPositionNear for use in preview calculations
 */
export function findBestPositionNearExported(
  occupancy: OccupancyGrid,
  targetX: number,
  targetY: number,
  widgetW: number,
  widgetH: number,
  cols: number,
  maxRows: number
): { x: number; y: number } | null {
  // First try the exact target position
  if (canFitAt(occupancy, targetX, targetY, widgetW, widgetH)) {
    return { x: targetX, y: targetY };
  }

  // Search in expanding rings around the target
  const maxDistance = Math.max(cols, maxRows);

  for (let distance = 1; distance < maxDistance; distance++) {
    for (let dy = -distance; dy <= distance; dy++) {
      for (let dx = -distance; dx <= distance; dx++) {
        if (Math.abs(dx) !== distance && Math.abs(dy) !== distance) continue;

        const x = targetX + dx;
        const y = targetY + dy;

        if (x < 0 || y < 0 || x + widgetW > cols || y + widgetH > maxRows) continue;

        if (canFitAt(occupancy, x, y, widgetW, widgetH)) {
          return { x, y };
        }
      }
    }
  }

  return findFirstFitPosition(occupancy, widgetW, widgetH);
}

/**
 * Find all widgets that would be overlapped if source widget is placed at a position
 * @param layouts - Current layouts
 * @param sourceId - Source widget ID (being dragged)
 * @param targetX - Target X position for source widget
 * @param targetY - Target Y position for source widget
 * @param sourceW - Source widget width
 * @param sourceH - Source widget height
 * @returns Array of widget IDs that would be overlapped
 */
export function findOverlappedWidgets(
  layouts: GridItemLayout[],
  sourceId: string,
  targetX: number,
  targetY: number,
  sourceW: number,
  sourceH: number
): GridItemLayout[] {
  const sourceZone: GridZone = { x: targetX, y: targetY, w: sourceW, h: sourceH };
  const overlapped: GridItemLayout[] = [];

  for (const layout of layouts) {
    if (layout.i === sourceId) continue;

    const layoutZone: GridZone = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
    if (zonesOverlap(sourceZone, layoutZone)) {
      overlapped.push(layout);
    }
  }

  return overlapped;
}

/**
 * Calculate multi-widget swap preview
 * When a large widget is dragged over multiple small widgets, this calculates
 * where all affected widgets should move to
 * @param layouts - Current layouts
 * @param sourceId - Source widget ID (being dragged)
 * @param targetX - Target X position where source wants to go
 * @param targetY - Target Y position where source wants to go
 * @param cols - Number of columns in the grid
 * @param maxRows - Maximum rows in the grid
 * @returns MultiSwapPreview with positions for all affected widgets, or null if not possible
 */
export function calculateMultiSwapPreview(
  layouts: GridItemLayout[],
  sourceId: string,
  targetX: number,
  targetY: number,
  cols: number,
  maxRows: number
): MultiSwapPreview | null {
  const sourceLayout = layouts.find(l => l.i === sourceId);
  if (!sourceLayout) return null;

  // FIRST: Clamp target position to fit within grid bounds
  // This ensures consistency between overlap detection and final positions
  let sourceNewX = targetX;
  let sourceNewY = targetY;
  if (sourceNewX + sourceLayout.w > cols) sourceNewX = cols - sourceLayout.w;
  if (sourceNewX < 0) sourceNewX = 0;
  if (sourceNewY + sourceLayout.h > maxRows) sourceNewY = maxRows - sourceLayout.h;
  if (sourceNewY < 0) sourceNewY = 0;

  // Find all widgets that would be overlapped by the source at the CLAMPED position
  // This ensures we detect overlaps based on where the widget will actually land
  const overlappedWidgets = findOverlappedWidgets(
    layouts,
    sourceId,
    sourceNewX,  // Use clamped position
    sourceNewY,  // Use clamped position
    sourceLayout.w,
    sourceLayout.h
  );

  if (overlappedWidgets.length === 0) return null;

  const sourceNewZone: GridZone = { x: sourceNewX, y: sourceNewY, w: sourceLayout.w, h: sourceLayout.h };

  // Create occupancy grid excluding source widget
  const occupancy = createOccupancyGrid(layouts, cols, maxRows, sourceId);

  // Clear all overlapped widgets from occupancy
  for (const widget of overlappedWidgets) {
    for (let row = widget.y; row < Math.min(widget.y + widget.h, maxRows); row++) {
      for (let col = widget.x; col < Math.min(widget.x + widget.w, cols); col++) {
        if (occupancy.grid[row]) {
          occupancy.grid[row][col] = false;
        }
      }
    }
  }

  // Mark source's new position as occupied
  for (let row = sourceNewY; row < Math.min(sourceNewY + sourceLayout.h, maxRows); row++) {
    for (let col = sourceNewX; col < Math.min(sourceNewX + sourceLayout.w, cols); col++) {
      if (occupancy.grid[row]) {
        occupancy.grid[row][col] = true;
      }
    }
  }

  // Try to place all overlapped widgets in the source's original space or nearby
  const targetNewPositions: { id: string; pos: GridZone }[] = [];
  // Create a deep copy of occupancy with explicit bounds to ensure viewport limits are respected
  const workingOccupancy: OccupancyGrid = {
    grid: occupancy.grid.map(row => [...row]),
    cols: cols,
    rows: maxRows
  };

  // Sort overlapped widgets by size (largest first) to place them more efficiently
  const sortedWidgets = [...overlappedWidgets].sort((a, b) => (b.w * b.h) - (a.w * a.h));

  for (const widget of sortedWidgets) {
    // First try to place at source's original position
    let newPos = findBestPositionNearExported(
      workingOccupancy,
      sourceLayout.x,
      sourceLayout.y,
      widget.w,
      widget.h,
      cols,
      maxRows
    );

    if (!newPos) {
      // Try to find any available position
      newPos = findFirstFitPosition(workingOccupancy, widget.w, widget.h);
    }

    if (!newPos) {
      // Can't place this widget - swap not possible
      return null;
    }

    // Validate the position is within bounds BEFORE accepting it
    if (newPos.x < 0 || newPos.y < 0 ||
        newPos.x + widget.w > cols || newPos.y + widget.h > maxRows) {
      // Position is outside viewport - swap not possible
      return null;
    }

    // Mark this position as occupied
    for (let row = newPos.y; row < Math.min(newPos.y + widget.h, maxRows); row++) {
      for (let col = newPos.x; col < Math.min(newPos.x + widget.w, cols); col++) {
        if (workingOccupancy.grid[row]) {
          workingOccupancy.grid[row][col] = true;
        }
      }
    }

    targetNewPositions.push({
      id: widget.i,
      pos: { x: newPos.x, y: newPos.y, w: widget.w, h: widget.h }
    });
  }

  // Final validation: ensure source is within bounds
  if (sourceNewX < 0 || sourceNewY < 0 ||
      sourceNewX + sourceLayout.w > cols || sourceNewY + sourceLayout.h > maxRows) {
    return null;
  }

  // Final validation: ensure all target positions are within bounds
  for (const target of targetNewPositions) {
    if (target.pos.x < 0 || target.pos.y < 0 ||
        target.pos.x + target.pos.w > cols || target.pos.y + target.pos.h > maxRows) {
      return null;
    }
  }

  return {
    sourceId,
    targetIds: overlappedWidgets.map(w => w.i),
    sourceNewPos: sourceNewZone,
    targetNewPositions
  };
}

/**
 * Execute multi-widget swap
 * @param layouts - Current layouts
 * @param multiSwapPreview - The multi-swap preview containing new positions
 * @param cols - Number of columns in the grid
 * @param maxRows - Maximum rows in the grid
 * @returns New layouts with all widgets repositioned (adjusted to fit viewport)
 */
export function calculateMultiSwap(
  layouts: GridItemLayout[],
  multiSwapPreview: MultiSwapPreview,
  cols?: number,
  maxRows?: number
): GridItemLayout[] {
  const { sourceId, sourceNewPos, targetNewPositions } = multiSwapPreview;

  // Default grid size if not provided
  const gridCols = cols ?? 25;
  const gridRows = maxRows ?? 20;

  // Create a map of new positions
  const newPositions = new Map<string, GridZone>();
  newPositions.set(sourceId, sourceNewPos);
  for (const target of targetNewPositions) {
    newPositions.set(target.id, target.pos);
  }

  // Apply new positions to layouts
  const newLayouts = layouts.map(l => {
    const newPos = newPositions.get(l.i);
    if (newPos) {
      return {
        ...l,
        x: newPos.x,
        y: newPos.y,
        // Keep original w and h
      };
    }
    return l;
  });

  // Adjust all layouts to ensure they fit within viewport
  return adjustLayoutsToViewport(newLayouts, gridCols, gridRows);
}

/**
 * Calculate swap between two widgets
 * Widgets always keep their original sizes - positions are adjusted automatically
 * to fit the available space
 * @param layouts - Current layouts
 * @param sourceId - Source widget ID (being dragged)
 * @param targetId - Target widget ID (being swapped with)
 * @param cols - Number of columns in the grid
 * @param maxRows - Maximum rows in the grid
 * @returns New layouts with swapped positions (sizes preserved), or null if swap not possible
 */
export function calculateSwap(
  layouts: GridItemLayout[],
  sourceId: string,
  targetId: string,
  cols?: number,
  maxRows?: number
): GridItemLayout[] | null {
  const sourceLayout = layouts.find(l => l.i === sourceId);
  const targetLayout = layouts.find(l => l.i === targetId);

  if (!sourceLayout || !targetLayout) {
    return null;
  }

  // Default grid size if not provided
  const gridCols = cols ?? 12;
  const gridRows = maxRows ?? 20;

  // Create occupancy grid excluding both source and target widgets
  const occupancy = createOccupancyGrid(layouts, gridCols, gridRows, sourceId);
  // Also exclude target from the occupancy
  for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, gridRows); row++) {
    for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, gridCols); col++) {
      if (occupancy.grid[row]) {
        occupancy.grid[row][col] = false;
      }
    }
  }

  // Try to find positions for both widgets with their original sizes
  // Strategy 1: Direct swap - source goes to target's position, target goes to source's position
  let sourceNewX = targetLayout.x;
  let sourceNewY = targetLayout.y;
  let targetNewX = sourceLayout.x;
  let targetNewY = sourceLayout.y;

  // Adjust source position if it doesn't fit at target's exact position
  // Try to keep it close to the target's original position
  if (sourceNewX + sourceLayout.w > gridCols) {
    sourceNewX = gridCols - sourceLayout.w;
  }
  if (sourceNewX < 0) sourceNewX = 0;

  if (sourceNewY + sourceLayout.h > gridRows) {
    sourceNewY = gridRows - sourceLayout.h;
  }
  if (sourceNewY < 0) sourceNewY = 0;

  // Adjust target position if it doesn't fit at source's exact position
  if (targetNewX + targetLayout.w > gridCols) {
    targetNewX = gridCols - targetLayout.w;
  }
  if (targetNewX < 0) targetNewX = 0;

  if (targetNewY + targetLayout.h > gridRows) {
    targetNewY = gridRows - targetLayout.h;
  }
  if (targetNewY < 0) targetNewY = 0;

  // Check if adjusted positions overlap
  const sourceNewZone: GridZone = { x: sourceNewX, y: sourceNewY, w: sourceLayout.w, h: sourceLayout.h };
  const targetNewZone: GridZone = { x: targetNewX, y: targetNewY, w: targetLayout.w, h: targetLayout.h };

  // If they overlap, we need to find alternative positions
  if (zonesOverlap(sourceNewZone, targetNewZone)) {
    // Try placing source at target position first, then find space for target
    const sourceCanFitAtTarget = canFitAt(occupancy, sourceNewX, sourceNewY, sourceLayout.w, sourceLayout.h);

    if (sourceCanFitAtTarget) {
      // Mark source's new position as occupied temporarily
      const tempOccupancy = createOccupancyGrid(layouts, gridCols, gridRows, sourceId);
      for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, gridRows); row++) {
        for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, gridCols); col++) {
          if (tempOccupancy.grid[row]) {
            tempOccupancy.grid[row][col] = false;
          }
        }
      }
      // Mark source's new position
      for (let row = sourceNewY; row < Math.min(sourceNewY + sourceLayout.h, gridRows); row++) {
        for (let col = sourceNewX; col < Math.min(sourceNewX + sourceLayout.w, gridCols); col++) {
          if (tempOccupancy.grid[row]) {
            tempOccupancy.grid[row][col] = true;
          }
        }
      }

      // Find best position for target widget near source's original position
      const targetPos = findBestPositionNear(
        tempOccupancy,
        sourceLayout.x,
        sourceLayout.y,
        targetLayout.w,
        targetLayout.h,
        gridCols,
        gridRows
      );

      if (targetPos) {
        targetNewX = targetPos.x;
        targetNewY = targetPos.y;
      } else {
        return null; // Can't find space for target
      }
    } else {
      // Try the reverse: place target first, then source
      const targetCanFitAtSource = canFitAt(occupancy, targetNewX, targetNewY, targetLayout.w, targetLayout.h);

      if (targetCanFitAtSource) {
        // Mark target's new position as occupied temporarily
        const tempOccupancy = createOccupancyGrid(layouts, gridCols, gridRows, sourceId);
        for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, gridRows); row++) {
          for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, gridCols); col++) {
            if (tempOccupancy.grid[row]) {
              tempOccupancy.grid[row][col] = false;
            }
          }
        }
        // Mark target's new position
        for (let row = targetNewY; row < Math.min(targetNewY + targetLayout.h, gridRows); row++) {
          for (let col = targetNewX; col < Math.min(targetNewX + targetLayout.w, gridCols); col++) {
            if (tempOccupancy.grid[row]) {
              tempOccupancy.grid[row][col] = true;
            }
          }
        }

        // Find best position for source widget near target's original position
        const sourcePos = findBestPositionNear(
          tempOccupancy,
          targetLayout.x,
          targetLayout.y,
          sourceLayout.w,
          sourceLayout.h,
          gridCols,
          gridRows
        );

        if (sourcePos) {
          sourceNewX = sourcePos.x;
          sourceNewY = sourcePos.y;
        } else {
          return null; // Can't find space for source
        }
      } else {
        return null; // Neither widget can fit at the other's position
      }
    }
  } else {
    // No overlap - verify both can fit at their positions
    const sourceCanFit = canFitAt(occupancy, sourceNewX, sourceNewY, sourceLayout.w, sourceLayout.h);

    // Create occupancy with source placed
    const occupancyWithSource = createOccupancyGrid(layouts, gridCols, gridRows, sourceId);
    for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, gridRows); row++) {
      for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, gridCols); col++) {
        if (occupancyWithSource.grid[row]) {
          occupancyWithSource.grid[row][col] = false;
        }
      }
    }
    for (let row = sourceNewY; row < Math.min(sourceNewY + sourceLayout.h, gridRows); row++) {
      for (let col = sourceNewX; col < Math.min(sourceNewX + sourceLayout.w, gridCols); col++) {
        if (occupancyWithSource.grid[row]) {
          occupancyWithSource.grid[row][col] = true;
        }
      }
    }

    const targetCanFit = canFitAt(occupancyWithSource, targetNewX, targetNewY, targetLayout.w, targetLayout.h);

    if (!sourceCanFit || !targetCanFit) {
      // Try to find alternative positions
      if (!sourceCanFit) {
        const sourcePos = findBestPositionNear(occupancy, targetLayout.x, targetLayout.y, sourceLayout.w, sourceLayout.h, gridCols, gridRows);
        if (sourcePos) {
          sourceNewX = sourcePos.x;
          sourceNewY = sourcePos.y;
        } else {
          return null;
        }
      }

      // Recalculate occupancy with source placed
      const newOccupancy = createOccupancyGrid(layouts, gridCols, gridRows, sourceId);
      for (let row = targetLayout.y; row < Math.min(targetLayout.y + targetLayout.h, gridRows); row++) {
        for (let col = targetLayout.x; col < Math.min(targetLayout.x + targetLayout.w, gridCols); col++) {
          if (newOccupancy.grid[row]) {
            newOccupancy.grid[row][col] = false;
          }
        }
      }
      for (let row = sourceNewY; row < Math.min(sourceNewY + sourceLayout.h, gridRows); row++) {
        for (let col = sourceNewX; col < Math.min(sourceNewX + sourceLayout.w, gridCols); col++) {
          if (newOccupancy.grid[row]) {
            newOccupancy.grid[row][col] = true;
          }
        }
      }

      if (!canFitAt(newOccupancy, targetNewX, targetNewY, targetLayout.w, targetLayout.h)) {
        const targetPos = findBestPositionNear(newOccupancy, sourceLayout.x, sourceLayout.y, targetLayout.w, targetLayout.h, gridCols, gridRows);
        if (targetPos) {
          targetNewX = targetPos.x;
          targetNewY = targetPos.y;
        } else {
          return null;
        }
      }
    }
  }

  // Create swapped layouts with original sizes preserved
  const newLayouts = layouts.map(l => {
    if (l.i === sourceId) {
      return {
        ...l,
        x: sourceNewX,
        y: sourceNewY,
        // Keep original w and h
      };
    } else if (l.i === targetId) {
      return {
        ...l,
        x: targetNewX,
        y: targetNewY,
        // Keep original w and h
      };
    }
    return l;
  });

  // Adjust all layouts to ensure they fit within viewport
  return adjustLayoutsToViewport(newLayouts, gridCols, gridRows);
}

/**
 * Find the best position for a widget near a target position
 * Searches in expanding rings around the target position
 */
function findBestPositionNear(
  occupancy: OccupancyGrid,
  targetX: number,
  targetY: number,
  widgetW: number,
  widgetH: number,
  cols: number,
  maxRows: number
): { x: number; y: number } | null {
  // First try the exact target position
  if (canFitAt(occupancy, targetX, targetY, widgetW, widgetH)) {
    return { x: targetX, y: targetY };
  }

  // Search in expanding rings around the target
  const maxDistance = Math.max(cols, maxRows);

  for (let distance = 1; distance < maxDistance; distance++) {
    // Check all positions at this distance
    for (let dy = -distance; dy <= distance; dy++) {
      for (let dx = -distance; dx <= distance; dx++) {
        // Only check positions on the ring (perimeter)
        if (Math.abs(dx) !== distance && Math.abs(dy) !== distance) continue;

        const x = targetX + dx;
        const y = targetY + dy;

        // Check bounds
        if (x < 0 || y < 0 || x + widgetW > cols || y + widgetH > maxRows) continue;

        if (canFitAt(occupancy, x, y, widgetW, widgetH)) {
          return { x, y };
        }
      }
    }
  }

  // Fall back to finding any available position
  return findFirstFitPosition(occupancy, widgetW, widgetH);
}

/**
 * Calculate auto-adjustment of existing widgets to make space for a new widget
 * Uses a multi-phase approach:
 * 1. Check for existing space
 * 2. Repack/reposition widgets without size changes
 * 3. Gradually shrink widgets (1 unit at a time) with repacking
 * 4. Shrink all widgets to minimum and use optimal packing
 * @param layouts - Current layouts
 * @param newWidgetW - Width of new widget to add
 * @param newWidgetH - Height of new widget to add
 * @param cols - Number of columns
 * @param maxRows - Maximum rows (viewport constraint)
 * @param widgetMinSizes - Minimum sizes for each existing widget
 * @param maxWidgets - Maximum number of widgets allowed (default 10)
 * @returns AutoAdjustResult with adjusted layouts and position for new widget
 */
export function calculateAutoAdjustForNewWidget(
  layouts: GridItemLayout[],
  newWidgetW: number,
  newWidgetH: number,
  cols: number,
  maxRows: number,
  widgetMinSizes: WidgetMinSizes,
  _maxWidgets: number = 10
): AutoAdjustResult {
  // Note: maxWidgets check removed - now only checks if there's physical space
  // The space availability check (including shrinking to min sizes) determines if widget can be added

  // Phase 1: Check if there's already space without any adjustment
  const occupancy = createOccupancyGrid(layouts, cols, maxRows);
  const existingPosition = findFirstFitPosition(occupancy, newWidgetW, newWidgetH);

  if (existingPosition) {
    return {
      canAdd: true,
      adjustedLayouts: layouts,
      newWidgetPosition: existingPosition,
      shrunkWidgets: [],
    };
  }

  // Phase 2: Try repacking existing widgets without size changes
  const repackedLayouts = repackWidgetsOptimal(layouts, cols, maxRows);
  const repackedOccupancy = createOccupancyGrid(repackedLayouts, cols, maxRows);
  const repackedPosition = findFirstFitPosition(repackedOccupancy, newWidgetW, newWidgetH);

  if (repackedPosition) {
    return {
      canAdd: true,
      adjustedLayouts: repackedLayouts,
      newWidgetPosition: repackedPosition,
      shrunkWidgets: [],
    };
  }

  // Calculate total grid cells available and needed
  const totalCells = cols * maxRows;
  const newWidgetCells = newWidgetW * newWidgetH;

  // Calculate minimum possible usage to check if it's even theoretically possible
  let minPossibleUsage = 0;
  for (const layout of layouts) {
    const minSize = widgetMinSizes[layout.i] || { minW: 2, minH: 2 };
    minPossibleUsage += minSize.minW * minSize.minH;
  }

  if (minPossibleUsage + newWidgetCells > totalCells) {
    return { canAdd: false, adjustedLayouts: layouts, newWidgetPosition: null, shrunkWidgets: [] };
  }

  let workingLayouts = layouts.map(l => ({ ...l }));
  const shrunkWidgetIds = new Set<string>();

  // Phase 3: Gradually shrink widgets one unit at a time with repacking
  const maxIterations = 200; // Increased safety limit for more thorough search
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // Find the widget that can be shrunk and has the most "extra" space
    // Priority: larger widgets with more space above minimum
    let bestCandidate: { id: string; shrinkType: 'w' | 'h'; excessSpace: number; currentSize: number } | null = null;

    for (const layout of workingLayouts) {
      const minSize = widgetMinSizes[layout.i] || { minW: 2, minH: 2 };

      // Calculate excess space for width and height
      const excessW = layout.w - minSize.minW;
      const excessH = layout.h - minSize.minH;
      const currentSize = layout.w * layout.h;

      // Check if we can shrink width - prefer shrinking larger widgets
      if (excessW > 0) {
        const priority = currentSize + (excessW + excessH);
        if (!bestCandidate || priority > bestCandidate.excessSpace + bestCandidate.currentSize) {
          bestCandidate = { id: layout.i, shrinkType: 'w', excessSpace: excessW + excessH, currentSize };
        }
      }

      // Check if we can shrink height - prefer shrinking larger widgets
      if (excessH > 0) {
        const priority = currentSize + (excessW + excessH);
        if (!bestCandidate || priority > bestCandidate.excessSpace + bestCandidate.currentSize) {
          bestCandidate = { id: layout.i, shrinkType: 'h', excessSpace: excessW + excessH, currentSize };
        }
      }
    }

    // No more widgets can be shrunk
    if (!bestCandidate) {
      break;
    }

    // Shrink the selected widget by 1 unit
    workingLayouts = workingLayouts.map(l => {
      if (l.i === bestCandidate!.id) {
        shrunkWidgetIds.add(l.i);
        if (bestCandidate!.shrinkType === 'w') {
          return { ...l, w: l.w - 1 };
        } else {
          return { ...l, h: l.h - 1 };
        }
      }
      return l;
    });

    // Try multiple packing strategies and use the one that works
    // Strategy 1: Simple repack
    let packedLayouts = repackWidgets(workingLayouts, cols, maxRows);
    let packedOccupancy = createOccupancyGrid(packedLayouts, cols, maxRows);
    let position = findFirstFitPosition(packedOccupancy, newWidgetW, newWidgetH);

    if (position) {
      return {
        canAdd: true,
        adjustedLayouts: packedLayouts,
        newWidgetPosition: position,
        shrunkWidgets: Array.from(shrunkWidgetIds),
      };
    }

    // Strategy 2: Optimal repack (try different orderings)
    packedLayouts = repackWidgetsOptimal(workingLayouts, cols, maxRows);
    packedOccupancy = createOccupancyGrid(packedLayouts, cols, maxRows);
    position = findFirstFitPosition(packedOccupancy, newWidgetW, newWidgetH);

    if (position) {
      return {
        canAdd: true,
        adjustedLayouts: packedLayouts,
        newWidgetPosition: position,
        shrunkWidgets: Array.from(shrunkWidgetIds),
      };
    }

    // Update working layouts with the best packing for next iteration
    workingLayouts = packedLayouts;
  }

  // Phase 4: Last resort - shrink ALL widgets to minimum and try optimal packing
  const minimumLayouts = workingLayouts.map(l => {
    const minSize = widgetMinSizes[l.i] || { minW: 2, minH: 2 };
    shrunkWidgetIds.add(l.i);
    return {
      ...l,
      w: minSize.minW,
      h: minSize.minH,
    };
  });

  const minPackedLayouts = repackWidgetsOptimal(minimumLayouts, cols, maxRows);
  const minPackedOccupancy = createOccupancyGrid(minPackedLayouts, cols, maxRows);
  const minPosition = findFirstFitPosition(minPackedOccupancy, newWidgetW, newWidgetH);

  if (minPosition) {
    return {
      canAdd: true,
      adjustedLayouts: minPackedLayouts,
      newWidgetPosition: minPosition,
      shrunkWidgets: Array.from(shrunkWidgetIds),
    };
  }

  return { canAdd: false, adjustedLayouts: layouts, newWidgetPosition: null, shrunkWidgets: [] };
}

/**
 * Repack widgets to remove gaps and optimize space usage
 * Uses a simple left-to-right, top-to-bottom packing algorithm
 */
function repackWidgets(
  layouts: GridItemLayout[],
  cols: number,
  maxRows: number
): GridItemLayout[] {
  if (layouts.length === 0) return layouts;

  // Sort by position (top-left first)
  const sorted = [...layouts].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  const packed: GridItemLayout[] = [];
  const occupancy = createOccupancyGrid([], cols, maxRows);

  for (const widget of sorted) {
    // Find the first position where this widget can fit
    let placed = false;

    for (let y = 0; y <= maxRows - widget.h && !placed; y++) {
      for (let x = 0; x <= cols - widget.w && !placed; x++) {
        if (canFitAt(occupancy, x, y, widget.w, widget.h)) {
          // Place widget here
          const packedWidget = { ...widget, x, y };
          packed.push(packedWidget);

          // Mark cells as occupied
          for (let row = y; row < y + widget.h; row++) {
            for (let col = x; col < x + widget.w; col++) {
              if (occupancy.grid[row]) {
                occupancy.grid[row][col] = true;
              }
            }
          }
          placed = true;
        }
      }
    }

    // If we couldn't place it (shouldn't happen), keep original position
    if (!placed) {
      packed.push(widget);
    }
  }

  return packed;
}

/**
 * Optimal repack using multiple strategies to find the best arrangement
 * Tries different sorting orders to maximize space utilization
 */
function repackWidgetsOptimal(
  layouts: GridItemLayout[],
  cols: number,
  maxRows: number
): GridItemLayout[] {
  if (layouts.length === 0) return layouts;

  // Try different sorting strategies and pick the one with best space utilization
  const strategies = [
    // Strategy 1: Sort by size (largest first) - better bin packing
    [...layouts].sort((a, b) => (b.w * b.h) - (a.w * a.h)),
    // Strategy 2: Sort by width (widest first)
    [...layouts].sort((a, b) => b.w - a.w || b.h - a.h),
    // Strategy 3: Sort by height (tallest first)
    [...layouts].sort((a, b) => b.h - a.h || b.w - a.w),
    // Strategy 4: Sort by position (original order)
    [...layouts].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    }),
    // Strategy 5: Sort by area efficiency (widgets that fill rows better)
    [...layouts].sort((a, b) => {
      const aFillsRow = cols % a.w === 0 ? 1 : 0;
      const bFillsRow = cols % b.w === 0 ? 1 : 0;
      if (aFillsRow !== bFillsRow) return bFillsRow - aFillsRow;
      return (b.w * b.h) - (a.w * a.h);
    }),
  ];

  let bestPacking: GridItemLayout[] = layouts;
  let bestMaxY = Infinity;
  let bestEmptySpaceAtTop = -1;

  for (const sorted of strategies) {
    const packed: GridItemLayout[] = [];
    const occupancy = createOccupancyGrid([], cols, maxRows);

    for (const widget of sorted) {
      let placed = false;

      // Find the first position where this widget can fit
      for (let y = 0; y <= maxRows - widget.h && !placed; y++) {
        for (let x = 0; x <= cols - widget.w && !placed; x++) {
          if (canFitAt(occupancy, x, y, widget.w, widget.h)) {
            const packedWidget = { ...widget, x, y };
            packed.push(packedWidget);

            // Mark cells as occupied
            for (let row = y; row < y + widget.h; row++) {
              for (let col = x; col < x + widget.w; col++) {
                if (occupancy.grid[row]) {
                  occupancy.grid[row][col] = true;
                }
              }
            }
            placed = true;
          }
        }
      }

      if (!placed) {
        packed.push(widget);
      }
    }

    // Calculate metrics for this packing
    const maxY = packed.length > 0 ? Math.max(...packed.map(w => w.y + w.h)) : 0;

    // Calculate empty space in the top rows (better packing = less wasted space at top)
    let emptySpaceAtTop = 0;
    for (let y = 0; y < Math.min(maxY, maxRows); y++) {
      for (let x = 0; x < cols; x++) {
        if (!occupancy.grid[y]?.[x]) {
          emptySpaceAtTop++;
        }
      }
    }

    // Prefer packings that use less vertical space and have more contiguous empty areas
    if (maxY < bestMaxY || (maxY === bestMaxY && emptySpaceAtTop > bestEmptySpaceAtTop)) {
      bestPacking = packed;
      bestMaxY = maxY;
      bestEmptySpaceAtTop = emptySpaceAtTop;
    }
  }

  return bestPacking;
}

/**
 * Convert pixel coordinates to grid coordinates
 * @param clientX - Mouse X position
 * @param clientY - Mouse Y position
 * @param containerRect - Container bounding rect
 * @param containerWidth - Container width
 * @param cols - Number of columns
 * @param rowHeight - Row height in pixels
 * @param margin - Grid margin [x, y]
 * @param containerPadding - Container padding [x, y]
 * @param maxRows - Maximum rows
 * @returns Grid coordinates { x, y } or null if outside grid
 */
export function pixelToGridCoords(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  containerWidth: number,
  cols: number,
  rowHeight: number,
  margin: [number, number],
  containerPadding: [number, number],
  maxRows: number
): { x: number; y: number } | null {
  const relX = clientX - containerRect.left - containerPadding[0];
  const relY = clientY - containerRect.top - containerPadding[1];

  if (relX < 0 || relY < 0) return null;

  const colWidth = (containerWidth - containerPadding[0] * 2 - margin[0] * (cols - 1)) / cols;
  const cellWidth = colWidth + margin[0];
  const cellHeight = rowHeight + margin[1];

  const gridX = Math.floor(relX / cellWidth);
  const gridY = Math.floor(relY / cellHeight);

  if (gridX < 0 || gridX >= cols || gridY < 0 || gridY >= maxRows) {
    return null;
  }

  return { x: gridX, y: gridY };
}
