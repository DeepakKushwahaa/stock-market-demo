import React, { useEffect, useRef } from 'react';
import {GoldenLayout, LayoutConfig} from 'golden-layout';
import { createRoot } from 'react-dom/client';
import { useLayout } from '../../contexts/LayoutContext';
import { WidgetRegistry } from '../widgets';

export const DashboardLayout: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<any | null>(null);
  const rootsRef = useRef<Map<string, any>>(new Map());
  const { layoutConfig, updateLayout, setLayoutInstance } = useLayout();

  useEffect(() => {
    if (!containerRef.current) return;
    if (layoutRef.current) return; // Only initialize once

    try {
      // Initialize Golden Layout with container first
      const layout = new GoldenLayout(containerRef.current);

      // Register all widget components before loading config
      Object.entries(WidgetRegistry).forEach(([name, Component]) => {
        layout.registerComponent(name, (container: any, componentState: any) => {
          // Get the DOM element - Golden Layout v2 uses getElement() which returns jQuery object
          const elementArray = container.getElement();
          const element = elementArray && elementArray.length > 0 ? elementArray[0] : elementArray;

          if (!element || !(element instanceof HTMLElement)) {
            console.error('Invalid container element for component:', name);
            return;
          }

          // Create a unique key for this component instance
          const componentKey = `${name}-${Date.now()}-${Math.random()}`;

          // Create React root and render component
          const root = createRoot(element);
          rootsRef.current.set(componentKey, root);

          root.render(<Component {...componentState} />);

          // Cleanup when container is destroyed
          container.on('destroy', () => {
            const rootToDestroy = rootsRef.current.get(componentKey);
            if (rootToDestroy) {
              rootToDestroy.unmount();
              rootsRef.current.delete(componentKey);
            }
          });
        });
      });

      // Load the layout config (either saved or default)
      // If it's a ResolvedLayoutConfig (from saveLayout), convert it to LayoutConfig
      let configToLoad = layoutConfig;
      if (layoutConfig.root) {
        // It's a ResolvedLayoutConfig, convert it
        configToLoad = LayoutConfig.fromResolved(layoutConfig);
      }
      layout.loadLayout(configToLoad);

      layoutRef.current = layout;
      setLayoutInstance(layout);

      // Save layout configuration on state changes
      let saveTimeout: any;
      const handleStateChange = () => {
        // Debounce save to avoid excessive localStorage writes
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          try {
            // Only save if layout is initialized
            if (layout.isInitialised) {
              // Use saveLayout() for serializable config that can be restored
              const config = layout.saveLayout();
              updateLayout(config);
            }
          } catch (error) {
            console.error('Error saving layout:', error);
          }
        }, 500);
      };

      layout.on('stateChanged', handleStateChange);

      // Handle window resize
      const handleResize = () => {
        if (layoutRef.current && containerRef.current) {
          layoutRef.current.updateSize(
            containerRef.current.offsetWidth,
            containerRef.current.offsetHeight
          );
        }
      };

      window.addEventListener('resize', handleResize);

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        clearTimeout(saveTimeout);

        // Unmount all React roots
        rootsRef.current.forEach((root) => {
          try {
            root.unmount();
          } catch (error) {
            console.error('Error unmounting root:', error);
          }
        });
        rootsRef.current.clear();

        // Destroy Golden Layout
        if (layoutRef.current) {
          try {
            layoutRef.current.destroy();
          } catch (error) {
            console.error('Error destroying layout:', error);
          }
          layoutRef.current = null;
        }
      };
    } catch (error) {
      console.error('Error initializing Golden Layout:', error);
    }
  }, []); // Empty dependency array - only initialize once

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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const layout = layoutRef.current as any;
    if (!layout || !layout.isInitialised) return;

    try {
      // Check if max widgets reached
      const currentWidgetCount = countWidgets(layout.root);
      if (currentWidgetCount >= MAX_WIDGETS) {
        alert(`Maximum ${MAX_WIDGETS} widgets allowed`);
        return;
      }

      const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));

      // Component config
      const componentConfig = {
        type: 'component',
        componentType: dragData.componentName,
        componentState: dragData.componentState,
        title: dragData.title,
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
        layout.newComponent(dragData.componentName, dragData.componentState, dragData.title);
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
      console.error('Error handling drop:', error);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ height: '100vh', width: 'calc(100vw - 320px)' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    />
  );
};
