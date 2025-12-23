import React from 'react';

interface WidgetWrapperProps {
  title: string;
  onClose: () => void;
  onToggleMaximize: () => void;
  isMaximized: boolean;
  children: React.ReactNode;
  isHighlighted?: boolean;
}

export const WidgetWrapper: React.FC<WidgetWrapperProps> = ({
  title,
  onClose,
  onToggleMaximize,
  isMaximized,
  children,
  isHighlighted = false
}) => {
  return (
    <div className={`h-full flex flex-col bg-white rounded-xl overflow-hidden border shadow-sm hover:shadow-md transition-all duration-200 relative ${
      isHighlighted
        ? 'border-emerald-400 ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-500/20'
        : 'border-slate-200'
    }`}>

      {/* Header - acts as drag handle (disabled when maximized) */}
      <div className={`flex items-center justify-between px-3! py-1.5! bg-slate-50 select-none border-b border-slate-100 ${
        isMaximized ? 'cursor-default' : 'widget-drag-handle cursor-move'
      }`}>
        <h3 className="text-sm font-semibold text-slate-700 truncate pl-2!">{title}</h3>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Settings button */}
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            title="Widget settings"
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
                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              />
            </svg>
          </button>
          {/* Maximize/Minimize button */}
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleMaximize();
            }}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-blue-100 text-slate-400 hover:text-blue-500 transition-colors cursor-pointer"
            title={isMaximized ? "Minimize widget" : "Maximize widget"}
          >
            {isMaximized ? (
              // Minimize icon (restore down)
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
                  d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"
                />
              </svg>
            ) : (
              // Maximize icon (expand)
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
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
            )}
          </button>
          {/* Close button */}
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-rose-100 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
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
      </div>

      {/* Widget content */}
      <div className="flex-1 overflow-hidden bg-white">
        {children}
      </div>
    </div>
  );
};
