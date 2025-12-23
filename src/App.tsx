import { LayoutProvider, useLayout } from './contexts/LayoutContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { WidgetPanel } from './components/layout/WidgetPanel';

function AppContent() {
  const { isWidgetPanelOpen, toggleWidgetPanel } = useLayout();

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 overflow-hidden">
      {/* Top Header Bar */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4! shrink-0 z-50">
        {/* Left: Logo and Dashboard Name */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-800">Trading Dashboard</h1>
            <button className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Center: Search */}
        <div className="flex-1 max-w-md mx-8!">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search symbols, widgets..."
              className="w-full pl-10! pr-4! py-2! bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button className="p-2! text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>
          <button className="p-2! text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <div className="w-px h-6 bg-slate-200 mx-1!"></div>
          <button className="w-8 h-8 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center text-white text-sm font-medium">
            JD
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Dashboard Canvas */}
        <div className="flex-1 h-full min-h-0 transition-all duration-300" style={{ marginRight: isWidgetPanelOpen ? '300px' : '0' }}>
          <DashboardLayout />
        </div>

        {/* Widget Panel with slide animation */}
        <div
          className={`fixed right-0 top-14 bottom-0 w-[300px] bg-white shadow-xl z-40 border-l border-slate-200 transform transition-transform duration-300 ease-in-out ${
            isWidgetPanelOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <WidgetPanel />
        </div>
      </div>

      {/* Floating toggle button - only show when panel is closed */}
      {!isWidgetPanelOpen && (
        <button
          onClick={toggleWidgetPanel}
          className="fixed z-40 bg-emerald-500 hover:bg-emerald-600 text-white p-3 rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-300 cursor-pointer bottom-6 right-6 hover:scale-105"
          title="Open widget panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>
      )}
    </div>
  );
}

function App() {
  return (
    <LayoutProvider>
      <AppContent />
    </LayoutProvider>
  );
}

export default App;
