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

// Swap preview information
export interface SwapPreview {
  sourceId: string;
  targetId: string;
  sourceNewPos: GridZone;
  targetNewPos: GridZone;
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
 * When resizing from the right, dependent widgets will be pushed horizontally
 * until they touch the viewport edge or another widget
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
  _widgetMinSizes: WidgetMinSizes
): ResizeSpaceResult {
  const resizingWidget = layouts.find(l => l.i === resizingId);
  if (!resizingWidget) {
    console.log('[DEBUG] Resizing widget not found');
    return { canResize: false, newLayouts: layouts, movedWidgets: [], shrunkWidgets: [] };
  }

  console.log('[DEBUG] calculateResizeSpace:', {
    resizingId,
    current: { x: resizingWidget.x, y: resizingWidget.y, w: resizingWidget.w, h: resizingWidget.h, maxW: resizingWidget.maxW },
    new: { x: newX, y: newY, w: newW, h: newH },
    allWidgets: layouts.map(l => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
  });

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

  // Detect resize direction based on requested size vs current size
  // Use > instead of >= to properly detect when we're requesting a larger size
  const isResizingRight = newW > resizingWidget.w && newX === resizingWidget.x;
  const isResizingLeft = newX < resizingWidget.x;
  const isResizingDown = newH > resizingWidget.h && newY === resizingWidget.y;
  const isResizingUp = newY < resizingWidget.y;

  console.log('[DEBUG] Resize direction:', { isResizingRight, isResizingLeft, isResizingDown, isResizingUp });
  console.log('[DEBUG] Resizing widget current pos:', { x: resizingWidget.x, y: resizingWidget.y, w: resizingWidget.w, h: resizingWidget.h, maxW: resizingWidget.maxW });
  console.log('[DEBUG] Requested new pos:', { x: newX, y: newY, w: newW, h: newH });

  // Find widgets that would be affected - check for overlap OR adjacency in resize direction
  const affectedWidgets = layouts.filter(l => {
    if (l.i === resizingId) return false;
    const widgetZone: GridZone = { x: l.x, y: l.y, w: l.w, h: l.h };

    // Check for direct overlap with the new bounds
    const overlaps = zonesOverlap(widgetZone, newBounds);
    if (overlaps) {
      console.log('[DEBUG] Widget', l.i, 'overlaps with newBounds');
      return true;
    }

    // For right resize: find widgets that are adjacent (touching the new right edge)
    if (isResizingRight) {
      const hasVerticalOverlap = !(l.y >= newY + newH || l.y + l.h <= newY);
      // Widget is immediately adjacent (touching or would touch the new right edge)
      const isAdjacent = l.x === newX + newW;
      // Widget starts within the expansion zone
      const isInExpansionPath = l.x >= resizingWidget.x + resizingWidget.w && l.x < newX + newW;

      const isAffected = hasVerticalOverlap && (isAdjacent || isInExpansionPath);

      console.log('[DEBUG] Right resize check for widget', l.i, ':', {
        widgetX: l.x, newRightEdge: newX + newW, currentRightEdge: resizingWidget.x + resizingWidget.w,
        hasVerticalOverlap, isAdjacent, isInExpansionPath, isAffected
      });

      if (isAffected) return true;
    }

    // For left resize: widget is to the left and has vertical overlap
    if (isResizingLeft) {
      const isToLeft = l.x + l.w <= resizingWidget.x;
      const wouldBeBlocking = l.x + l.w > newX; // Widget ends after the new left edge
      const hasVerticalOverlap = !(l.y >= newY + newH || l.y + l.h <= newY);
      if (isToLeft && wouldBeBlocking && hasVerticalOverlap) return true;
    }

    // For down resize: widget is below and has horizontal overlap
    if (isResizingDown) {
      const hasHorizontalOverlap = !(l.x >= newX + newW || l.x + l.w <= newX);
      const isAdjacent = l.y === newY + newH;
      const isInExpansionPath = l.y >= resizingWidget.y + resizingWidget.h && l.y < newY + newH;
      if (hasHorizontalOverlap && (isAdjacent || isInExpansionPath)) return true;
    }

    // For up resize: widget is above and has horizontal overlap
    if (isResizingUp) {
      const isAbove = l.y + l.h <= resizingWidget.y;
      const wouldBeBlocking = l.y + l.h > newY;
      const hasHorizontalOverlap = !(l.x >= newX + newW || l.x + l.w <= newX);
      if (isAbove && wouldBeBlocking && hasHorizontalOverlap) return true;
    }

    return false;
  });

  console.log('[DEBUG] Affected widgets:', affectedWidgets.map(w => w.i));

  if (affectedWidgets.length === 0) {
    // No conflicts, resize directly (including position change for top/left resize)
    console.log('[DEBUG] No affected widgets, allowing direct resize');
    const newLayouts = layouts.map(l =>
      l.i === resizingId ? { ...l, x: newX, y: newY, w: newW, h: newH } : l
    );
    return { canResize: true, newLayouts, movedWidgets: [], shrunkWidgets: [] };
  }

  let workingLayouts = layouts.map(l => ({ ...l }));
  const movedWidgets: string[] = [];
  const shrunkWidgets: string[] = [];

  // Phase 1: Try to push affected widgets horizontally (for right-side resize)
  // or vertically (for bottom-side resize) in the direction of the resize
  if (isResizingRight || isResizingLeft || isResizingDown || isResizingUp) {
    const direction = isResizingRight ? 'right' : isResizingLeft ? 'left' : isResizingDown ? 'down' : 'up';
    console.log('[DEBUG] Attempting push in direction:', direction);
    console.log('[DEBUG] newBounds (desired resize):', newBounds);

    const pushResult = tryPushWidgetsInDirection(
      workingLayouts,
      affectedWidgets,
      resizingId,
      newBounds, // Pass the actual desired resize bounds
      cols,
      maxRows,
      direction
    );

    console.log('[DEBUG] Push result:', pushResult);

    if (pushResult.success && pushResult.movedWidgets.length > 0) {
      workingLayouts = pushResult.layouts;
      movedWidgets.push(...pushResult.movedWidgets);

      // Apply resize to the resizing widget
      workingLayouts = workingLayouts.map(l =>
        l.i === resizingId ? { ...l, x: newX, y: newY, w: newW, h: newH } : l
      );

      console.log('[DEBUG] Push successful, final layouts:', workingLayouts.map(l => ({ i: l.i, x: l.x, y: l.y, w: l.w })));
      return { canResize: true, newLayouts: workingLayouts, movedWidgets, shrunkWidgets };
    }

    // For horizontal resize (right/left), if push fails (widget at viewport edge), reject the resize
    // Don't fall back to moving widgets down or shrinking - just stop the resize
    if (isResizingRight || isResizingLeft) {
      console.log('[DEBUG] Horizontal push failed (viewport edge reached), rejecting resize');
      return { canResize: false, newLayouts: layouts, movedWidgets: [], shrunkWidgets: [] };
    }

    // For vertical resize (down/up), if push fails, also reject - don't move widgets to random positions
    if (isResizingDown || isResizingUp) {
      console.log('[DEBUG] Vertical push failed (viewport edge reached), rejecting resize');
      return { canResize: false, newLayouts: layouts, movedWidgets: [], shrunkWidgets: [] };
    }
  }

  // Don't do any fallback repositioning or shrinking - widgets should only be pushed in the resize direction
  // If push failed above, we already returned. If we get here with affected widgets, reject the resize.
  if (affectedWidgets.length > 0 && movedWidgets.length === 0) {
    console.log('[DEBUG] Affected widgets exist but none were pushed, rejecting resize');
    return { canResize: false, newLayouts: layouts, movedWidgets: [], shrunkWidgets: [] };
  }

  // Apply resize to the resizing widget (including position change for top/left resize)
  workingLayouts = workingLayouts.map(l =>
    l.i === resizingId ? { ...l, x: newX, y: newY, w: newW, h: newH } : l
  );

  return { canResize: true, newLayouts: workingLayouts, movedWidgets, shrunkWidgets: [] };
}

/**
 * Try to push widgets in a specific direction (horizontally or vertically)
 * Pushes widgets all the way to the viewport edge (not just to clear the resizing widget)
 */
function tryPushWidgetsInDirection(
  layouts: GridItemLayout[],
  affectedWidgets: GridItemLayout[],
  resizingId: string,
  newBounds: GridZone,
  cols: number,
  maxRows: number,
  direction: 'right' | 'left' | 'down' | 'up'
): { success: boolean; layouts: GridItemLayout[]; movedWidgets: string[] } {
  console.log('[DEBUG] tryPushWidgetsInDirection called:', {
    direction, newBounds, cols, maxRows,
    affectedWidgets: affectedWidgets.map(w => ({ i: w.i, x: w.x, y: w.y, w: w.w, h: w.h })),
  });

  let workingLayouts = layouts.map(l => ({ ...l }));
  const movedWidgets: string[] = [];
  const processedWidgets = new Set<string>();

  // Add resizing widget to processed so we don't try to push it
  processedWidgets.add(resizingId);

  // Queue of widgets to process (widgets that need to be pushed)
  const widgetIdsToPush = affectedWidgets.map(w => w.i);
  console.log('[DEBUG] widgetIdsToPush:', widgetIdsToPush);

  while (widgetIdsToPush.length > 0) {
    const widgetId = widgetIdsToPush.shift()!;
    console.log('[DEBUG] Processing widget:', widgetId);

    // Skip if already processed
    if (processedWidgets.has(widgetId)) {
      console.log('[DEBUG] Already processed, skipping');
      continue;
    }
    processedWidgets.add(widgetId);

    const currentWidget = workingLayouts.find(l => l.i === widgetId);
    if (!currentWidget) {
      console.log('[DEBUG] Widget not found in layouts');
      continue;
    }
    console.log('[DEBUG] Current widget:', { x: currentWidget.x, y: currentWidget.y, w: currentWidget.w, h: currentWidget.h });

    // Check if this widget needs to be pushed based on overlap with newBounds
    let needsPush = false;

    if (direction === 'right') {
      const hasVerticalOverlap = !(currentWidget.y >= newBounds.y + newBounds.h || currentWidget.y + currentWidget.h <= newBounds.y);
      const hasHorizontalOverlap = currentWidget.x < newBounds.x + newBounds.w && currentWidget.x + currentWidget.w > newBounds.x;
      const isHorizontallyAdjacent = currentWidget.x === newBounds.x + newBounds.w;
      needsPush = hasVerticalOverlap && (hasHorizontalOverlap || isHorizontallyAdjacent);
    } else if (direction === 'left') {
      const hasVerticalOverlap = !(currentWidget.y >= newBounds.y + newBounds.h || currentWidget.y + currentWidget.h <= newBounds.y);
      const hasHorizontalOverlap = currentWidget.x < newBounds.x + newBounds.w && currentWidget.x + currentWidget.w > newBounds.x;
      needsPush = hasVerticalOverlap && hasHorizontalOverlap;
    } else if (direction === 'down') {
      const hasHorizontalOverlap = !(currentWidget.x >= newBounds.x + newBounds.w || currentWidget.x + currentWidget.w <= newBounds.x);
      const hasVerticalOverlap = currentWidget.y < newBounds.y + newBounds.h && currentWidget.y + currentWidget.h > newBounds.y;
      needsPush = hasHorizontalOverlap && hasVerticalOverlap;
    } else if (direction === 'up') {
      const hasHorizontalOverlap = !(currentWidget.x >= newBounds.x + newBounds.w || currentWidget.x + currentWidget.w <= newBounds.x);
      const hasVerticalOverlap = currentWidget.y < newBounds.y + newBounds.h && currentWidget.y + currentWidget.h > newBounds.y;
      needsPush = hasHorizontalOverlap && hasVerticalOverlap;
    }

    console.log('[DEBUG] needsPush:', needsPush);

    if (!needsPush) continue;

    // Calculate new position - push only enough to clear the resizing widget's new bounds
    // The widget should move to just after the resizing widget's new right edge
    let newPos = { x: currentWidget.x, y: currentWidget.y };
    if (direction === 'right') {
      // Push just enough to clear the right edge of newBounds
      // The target widget should be placed immediately after the resizing widget
      newPos.x = newBounds.x + newBounds.w;
    } else if (direction === 'left') {
      // Push just enough to clear the left edge of newBounds
      newPos.x = newBounds.x - currentWidget.w;
    } else if (direction === 'down') {
      // Push just enough to clear the bottom edge of newBounds
      newPos.y = newBounds.y + newBounds.h;
    } else if (direction === 'up') {
      // Push just enough to clear the top edge of newBounds
      newPos.y = newBounds.y - currentWidget.h;
    }

    console.log('[DEBUG] New position calculated:', newPos, 'current:', { x: currentWidget.x, y: currentWidget.y });

    // Check if the new position is within bounds
    if (newPos.x < 0 || newPos.y < 0 || newPos.x + currentWidget.w > cols || newPos.y + currentWidget.h > maxRows) {
      console.log('[DEBUG] Push failed: widget would exceed boundary');
      return { success: false, layouts, movedWidgets: [] };
    }

    // Check if the widget actually needs to move (new position is different from current)
    if (newPos.x === currentWidget.x && newPos.y === currentWidget.y) {
      console.log('[DEBUG] Widget already at target position, no move needed');
      continue;
    }

    // Apply the push
    console.log('[DEBUG] Applying push: moving widget', currentWidget.i, 'to', newPos);
    workingLayouts = workingLayouts.map(l =>
      l.i === currentWidget.i ? { ...l, x: newPos.x, y: newPos.y } : l
    );
    movedWidgets.push(currentWidget.i);

    // Add this widget's new position as a zone for chain reactions
    const newWidgetZone: GridZone = {
      x: newPos.x,
      y: newPos.y,
      w: currentWidget.w,
      h: currentWidget.h,
    };

    // Find any widgets that would be affected by this push (chain reaction)
    const chainAffectedWidgets = workingLayouts.filter(l => {
      if (processedWidgets.has(l.i)) return false;
      if (widgetIdsToPush.includes(l.i)) return false;
      const widgetZone: GridZone = { x: l.x, y: l.y, w: l.w, h: l.h };
      return zonesOverlap(widgetZone, newWidgetZone);
    });

    // Add chain-affected widgets to the queue
    for (const chainWidget of chainAffectedWidgets) {
      widgetIdsToPush.push(chainWidget.i);
    }
  }

  console.log('[DEBUG] tryPushWidgetsInDirection returning success, movedWidgets:', movedWidgets);
  return { success: true, layouts: workingLayouts, movedWidgets };
}

/**
 * Calculate swap between two widgets
 * Widgets always keep their original sizes - positions are adjusted automatically
 * to fit the available space. When direct swap is not possible, tries to push
 * other widgets horizontally to make space.
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

  console.log('[SWAP DEBUG] calculateSwap called:', {
    sourceId,
    targetId,
    sourceLayout: sourceLayout ? { x: sourceLayout.x, y: sourceLayout.y, w: sourceLayout.w, h: sourceLayout.h } : null,
    targetLayout: targetLayout ? { x: targetLayout.x, y: targetLayout.y, w: targetLayout.w, h: targetLayout.h } : null,
    cols,
    maxRows
  });

  if (!sourceLayout || !targetLayout) {
    console.log('[SWAP DEBUG] Source or target not found, returning null');
    return null;
  }

  // Default grid size if not provided
  const gridCols = cols ?? 12;
  const gridRows = maxRows ?? 20;

  // SIMPLE SWAP: Source goes to Target's position, Target goes to Source's position
  // NO pushing of other widgets - if it doesn't fit, swap fails

  // New positions after swap
  const sourceNewX = targetLayout.x;
  const sourceNewY = targetLayout.y;
  const targetNewX = sourceLayout.x;
  const targetNewY = sourceLayout.y;

  console.log('[SWAP DEBUG] Trying simple swap:', {
    source: { from: { x: sourceLayout.x, y: sourceLayout.y }, to: { x: sourceNewX, y: sourceNewY } },
    target: { from: { x: targetLayout.x, y: targetLayout.y }, to: { x: targetNewX, y: targetNewY } }
  });

  // Check 1: Source at target's position - within grid bounds?
  if (sourceNewX + sourceLayout.w > gridCols || sourceNewY + sourceLayout.h > gridRows) {
    console.log('[SWAP DEBUG] Source would exceed grid bounds at target position');
    return null;
  }

  // Check 2: Target at source's position - within grid bounds?
  if (targetNewX + targetLayout.w > gridCols || targetNewY + targetLayout.h > gridRows) {
    console.log('[SWAP DEBUG] Target would exceed grid bounds at source position');
    return null;
  }

  // Create zones for new positions
  const sourceNewZone: GridZone = { x: sourceNewX, y: sourceNewY, w: sourceLayout.w, h: sourceLayout.h };
  const targetNewZone: GridZone = { x: targetNewX, y: targetNewY, w: targetLayout.w, h: targetLayout.h };

  // Check 3: Do the swapped widgets overlap each other? (due to different sizes)
  if (zonesOverlap(sourceNewZone, targetNewZone)) {
    console.log('[SWAP DEBUG] Swapped widgets would overlap each other - sizes incompatible');
    return null;
  }

  // Check 4: Do swapped widgets overlap any OTHER widget?
  for (const layout of layouts) {
    if (layout.i === sourceId || layout.i === targetId) continue;

    const otherZone: GridZone = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };

    if (zonesOverlap(sourceNewZone, otherZone)) {
      console.log('[SWAP DEBUG] Source at new position overlaps with widget:', layout.i);
      return null;
    }

    if (zonesOverlap(targetNewZone, otherZone)) {
      console.log('[SWAP DEBUG] Target at new position overlaps with widget:', layout.i);
      return null;
    }
  }

  // All checks passed - simple swap is possible!
  console.log('[SWAP DEBUG] Simple swap successful - no other widgets affected');

  return layouts.map(l => {
    if (l.i === sourceId) {
      return { ...l, x: sourceNewX, y: sourceNewY };
    } else if (l.i === targetId) {
      return { ...l, x: targetNewX, y: targetNewY };
    }
    return l;
  });
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
