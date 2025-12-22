import React from 'react';

interface WidgetWrapperProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const WidgetWrapper: React.FC<WidgetWrapperProps> = ({
  title,
  onClose,
  children
}) => {
  return (
    <div className="h-full flex flex-col bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
      {/* Header - acts as drag handle */}
      <div className="widget-drag-handle flex items-center justify-between px-3! py-2! bg-gradient-to-b from-gray-700 to-gray-800 cursor-move select-none border-b border-gray-600">
        {/* Drag indicator */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5 opacity-40">
            <div className="flex gap-0.5">
              <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
              <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
            </div>
            <div className="flex gap-0.5">
              <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
              <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
            </div>
          </div>
          <h3 className="text-sm font-medium text-gray-200 truncate">{title}</h3>
        </div>

        {/* Close button */}
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-600 text-gray-400 hover:text-white transition-colors cursor-pointer"
          title="Close widget"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Widget content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
};
