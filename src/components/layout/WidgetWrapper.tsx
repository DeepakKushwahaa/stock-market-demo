import React from 'react';

interface WidgetWrapperProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  isHighlighted?: boolean;
}

export const WidgetWrapper: React.FC<WidgetWrapperProps> = ({
  title,
  onClose,
  children,
  isHighlighted = false
}) => {
  return (
    <div className={`h-full flex flex-col bg-white rounded-xl overflow-hidden border shadow-sm hover:shadow-md transition-all duration-200 ${
      isHighlighted
        ? 'border-emerald-400 ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-500/20'
        : 'border-slate-200'
    }`}>
      {/* Header - acts as drag handle */}
      <div className="widget-drag-handle flex items-center justify-between px-3! py-1.5! bg-slate-50 cursor-move select-none border-b border-slate-100">
        {/* Drag indicator */}
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col gap-0.5 opacity-30">
            <div className="flex gap-0.5">
              <span className="w-1 h-1 bg-slate-400 rounded-full"></span>
              <span className="w-1 h-1 bg-slate-400 rounded-full"></span>
            </div>
            <div className="flex gap-0.5">
              <span className="w-1 h-1 bg-slate-400 rounded-full"></span>
              <span className="w-1 h-1 bg-slate-400 rounded-full"></span>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-slate-700 truncate">{title}</h3>
        </div>

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
