// import { GoldenLayoutConfig } from '../types/layout.types';

export const defaultLayoutConfig: any = {
  settings: {
    showPopoutIcon: false,
    showMaximiseIcon: true,
    showCloseIcon: true,
  },
  dimensions: {
    borderWidth: 5,
    minItemHeight: 150,
    minItemWidth: 200,
    headerHeight: 30,
  },
  // Start with a column containing one empty row
  content: [{
    type: 'column',
    content: [{
      type: 'row',
      content: []
    }]
  }]
};
