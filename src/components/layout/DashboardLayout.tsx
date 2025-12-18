import React, { useEffect, useRef } from 'react';
import {GoldenLayout} from 'golden-layout';
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
      // Initialize Golden Layout
      const layout = new GoldenLayout(layoutConfig, containerRef.current);

      // Register all widget components
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

      // Initialize the layout
      layout.init();
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
              const config = layout.toConfig();
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const layout = layoutRef.current as any;
    if (!layout || !layout.isInitialised) return;

    try {
      const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
      console.log('Drop received:', dragData);

      // Use Golden Layout's addItem method
      if (layout.addItem) {
        console.log('Using layout.addItem method for drop');
        layout.addItem(dragData);
      } else if (layout.newItem) {
        console.log('Using layout.newItem method for drop');
        layout.newItem(dragData);
      } else {
        console.log('Using fallback method for drop');
        const config = layout.toConfig();

        if (!config.content || config.content.length === 0) {
          config.content = [{
            type: 'row',
            content: [{
              type: 'stack',
              content: [dragData]
            }]
          }];
        } else {
          // Find first stack and add to it
          const findAndAddToStack = (items: any[]): boolean => {
            for (const item of items) {
              if (item.type === 'stack') {
                if (!item.content) item.content = [];
                item.content.push(dragData);
                return true;
              }
              if (item.content && findAndAddToStack(item.content)) {
                return true;
              }
            }
            return false;
          };

          if (!findAndAddToStack(config.content)) {
            // No stack found, add to first row
            if (config.content[0]?.content) {
              config.content[0].content.push({
                type: 'stack',
                content: [dragData]
              });
            }
          }
        }

        updateLayout(config);
        setTimeout(() => window.location.reload(), 100);
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
