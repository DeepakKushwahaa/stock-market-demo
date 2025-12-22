declare module '@eleung/react-grid-layout' {
  import * as React from 'react';

  export interface Layout {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    maxW?: number;
    minH?: number;
    maxH?: number;
    static?: boolean;
    isDraggable?: boolean;
    isResizable?: boolean;
    isBounded?: boolean;
  }

  export interface Layouts {
    [P: string]: Layout[];
  }

  export type ItemCallback = (
    layout: Layout[],
    oldItem: Layout,
    newItem: Layout,
    placeholder: Layout,
    event: MouseEvent,
    element: HTMLElement
  ) => void;

  export type DragOverEvent = MouseEvent & {
    nativeEvent: {
      layerX: number;
      layerY: number;
    } & Event;
  };

  export interface CoreProps {
    className?: string;
    style?: React.CSSProperties;
    width?: number;
    autoSize?: boolean;
    cols?: number;
    draggableCancel?: string;
    draggableHandle?: string;
    compactType?: 'horizontal' | 'vertical' | null;
    layout?: Layout[];
    margin?: [number, number];
    containerPadding?: [number, number] | null;
    rowHeight?: number;
    maxRows?: number;
    isBounded?: boolean;
    isDraggable?: boolean;
    isResizable?: boolean;
    isDroppable?: boolean;
    preventCollision?: boolean;
    useCSSTransforms?: boolean;
    transformScale?: number;
    droppingItem?: Partial<Layout>;
    resizeHandles?: Array<'s' | 'w' | 'e' | 'n' | 'sw' | 'nw' | 'se' | 'ne'>;
    resizeHandle?: React.ReactNode | ((resizeHandleAxis: string) => React.ReactNode);
    onLayoutChange?: (layout: Layout[]) => void;
    onDragStart?: ItemCallback;
    onDrag?: ItemCallback;
    onDragStop?: ItemCallback;
    onResizeStart?: ItemCallback;
    onResize?: ItemCallback;
    onResizeStop?: ItemCallback;
    onDrop?: (layout: Layout[], item: Layout, e: Event) => void;
    onDropDragOver?: (e: DragOverEvent) => { w?: number; h?: number } | false | undefined;
    children?: React.ReactNode;
    innerRef?: React.Ref<HTMLDivElement>;
  }

  export interface ResponsiveProps extends CoreProps {
    breakpoint?: string;
    breakpoints?: { [P: string]: number };
    cols?: { [P: string]: number };
    layouts?: Layouts;
    onBreakpointChange?: (newBreakpoint: string, newCols: number) => void;
    onLayoutChange?: (currentLayout: Layout[], allLayouts: Layouts) => void;
    onWidthChange?: (
      containerWidth: number,
      margin: [number, number],
      cols: number,
      containerPadding: [number, number] | null
    ) => void;
  }

  export class Responsive extends React.Component<ResponsiveProps> {}

  export function WidthProvider<P extends object>(
    component: React.ComponentClass<P>
  ): React.ComponentClass<Omit<P, 'width'>>;

  export default class GridLayout extends React.Component<CoreProps> {}
}

declare module '@eleung/react-grid-layout/css/styles.css' {}
