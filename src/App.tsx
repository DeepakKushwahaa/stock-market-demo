import { LayoutProvider } from './contexts/LayoutContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { WidgetPanel } from './components/layout/WidgetPanel';

function App() {
  return (
    <LayoutProvider>
      <div className="flex h-screen w-screen bg-gray-900 overflow-hidden">
        <div className="flex-1">
          <DashboardLayout />
        </div>
        <WidgetPanel />
        {/* hello */}
      </div>
    </LayoutProvider>
  );
}

export default App;
