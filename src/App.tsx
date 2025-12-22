import { LayoutProvider, useLayout } from './contexts/LayoutContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { WidgetPanel } from './components/layout/WidgetPanel';

function AppContent() {
  const { isWidgetPanelOpen, toggleWidgetPanel } = useLayout();

  return (
    <div className="flex h-screen w-screen bg-gray-900 overflow-hidden">
      <div className="flex-1 transition-all duration-300" style={{ marginRight: isWidgetPanelOpen ? '320px' : '0' }}>
        <DashboardLayout />
      </div>

      {/* Widget Panel with slide animation */}
      <div
        className={`fixed right-0 top-0 h-screen w-80 bg-gray-800 shadow-2xl z-50 border-l border-gray-700 transform transition-transform duration-300 ease-in-out ${
          isWidgetPanelOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <WidgetPanel />
      </div>

      {/* Floating toggle button - only show when panel is closed */}
      {!isWidgetPanelOpen && (
        <button
          onClick={toggleWidgetPanel}
          className="fixed z-40 bg-blue-600 hover:bg-blue-700 text-white p-3! rounded-lg shadow-lg transition-all duration-300 cursor-pointer bottom-4 right-4"
          title="Open widget panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
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
