export interface LayoutSettings {
  showPopoutIcon?: boolean;
  showMaximiseIcon?: boolean;
  showCloseIcon?: boolean;
  reorderEnabled?: boolean;
}

export interface LayoutDimensions {
  borderWidth?: number;
  minItemHeight?: number;
  minItemWidth?: number;
  headerHeight?: number;
  dragProxyWidth?: number;
  dragProxyHeight?: number;
}

export interface ComponentConfig {
  type: 'component';
  componentName: string;
  componentState?: Record<string, unknown>;
  title?: string;
  isClosable?: boolean;
}

export interface StackConfig {
  type: 'stack';
  content: (ComponentConfig | StackConfig | RowConfig | ColumnConfig)[];
  activeItemIndex?: number;
  isClosable?: boolean;
}

export interface RowConfig {
  type: 'row';
  content: (ComponentConfig | StackConfig | RowConfig | ColumnConfig)[];
  isClosable?: boolean;
}

export interface ColumnConfig {
  type: 'column';
  content: (ComponentConfig | StackConfig | RowConfig | ColumnConfig)[];
  isClosable?: boolean;
}

export type ItemConfig = ComponentConfig | StackConfig | RowConfig | ColumnConfig;

export interface GoldenLayoutConfig {
  settings?: LayoutSettings;
  dimensions?: LayoutDimensions;
  content: ItemConfig[];
}
