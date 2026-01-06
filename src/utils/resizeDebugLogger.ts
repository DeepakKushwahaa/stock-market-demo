// Debug logger for resize operations
// Logs are stored in localStorage and can be downloaded as a file
const ENABLE_RESIZE_DEBUG = false;
const MAX_LOGS = 1000;
const STORAGE_KEY = 'resize_debug_logs';

interface LogEntry {
  timestamp: string;
  sessionId: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

class ResizeDebugLogger {
  private sessionId: string = '';
  private logs: LogEntry[] = [];

  constructor() {
    // Load existing logs from localStorage
    this.loadLogs();
  }

  private loadLogs() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch {
      this.logs = [];
    }
  }

  private saveLogs() {
    try {
      // Keep only the last MAX_LOGS entries
      if (this.logs.length > MAX_LOGS) {
        this.logs = this.logs.slice(-MAX_LOGS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs));
    } catch {
      // Silently fail if localStorage is not available
    }
  }

  private addLog(type: string, message: string, data?: Record<string, unknown>) {
    if (!ENABLE_RESIZE_DEBUG) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type,
      message,
      data,
    };

    this.logs.push(entry);
    this.saveLogs();
  }

  clear() {
    this.logs = [];
    this.sessionId = '';
    localStorage.removeItem(STORAGE_KEY);
  }

  startSession(widgetId: string, direction: string) {
    if (!ENABLE_RESIZE_DEBUG) return;
    this.sessionId = `resize-${Date.now()}`;

    const separator = '='.repeat(80);
    this.addLog('SESSION_START', separator);
    this.addLog('SESSION_START', `RESIZE SESSION START: ${this.sessionId}`);
    this.addLog('SESSION_START', `Widget: ${widgetId.slice(-8)}, Direction: ${direction}`);
    this.addLog('SESSION_START', separator);
  }

  log(phase: string, data: Record<string, unknown>) {
    if (!ENABLE_RESIZE_DEBUG) return;

    let message = phase;
    const formattedData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        formattedData[key] = JSON.stringify(value);
      } else {
        formattedData[key] = value;
      }
    }

    this.addLog(phase, message, formattedData);
  }

  logWidgetPositions(label: string, widgets: Array<{ id: string; x: number; w: number; rightEdge?: number }>) {
    if (!ENABLE_RESIZE_DEBUG) return;

    const lines: string[] = [`${label}:`];
    lines.push('-'.repeat(50));

    for (const w of widgets) {
      const id = w.id.length > 8 ? w.id.slice(-8) : w.id;
      const rightEdge = w.rightEdge ?? w.x + w.w;
      const bar = '█'.repeat(Math.min(w.w, 20));
      lines.push(`[${id}] x:${w.x.toString().padStart(2)} w:${w.w.toString().padStart(2)} → ${rightEdge.toString().padStart(2)} ${bar}`);
    }

    lines.push('-'.repeat(50));
    this.addLog('WIDGET_POSITIONS', lines.join('\n'));
  }

  logPushCalculation(params: {
    resizingWidget: { x: number; w: number; newRightEdge: number };
    widgetsToPush: Array<{ id: string; x: number; w: number; maxW?: number }>;
    canPush: boolean;
    newPositions: Array<[string, number]>;
    cols: number;
  }) {
    if (!ENABLE_RESIZE_DEBUG) return;

    const { resizingWidget, widgetsToPush, canPush, newPositions, cols } = params;

    const lines: string[] = ['PUSH CALCULATION:'];
    lines.push(`Viewport columns: ${cols}`);
    lines.push(`Resizing widget: x=${resizingWidget.x}, w=${resizingWidget.w}, newRightEdge=${resizingWidget.newRightEdge}`);
    lines.push('');
    lines.push('Widgets to push:');

    for (const w of widgetsToPush) {
      const id = w.id.length > 8 ? w.id.slice(-8) : w.id;
      lines.push(`  - ${id}: x=${w.x}, w=${w.w}${w.maxW ? `, maxW=${w.maxW}` : ''}`);
    }

    lines.push('');
    lines.push(`Can push: ${canPush ? 'YES' : 'NO'}`);

    if (newPositions.length > 0) {
      lines.push('New positions:');
      for (const [id, x] of newPositions) {
        const shortId = id.length > 8 ? id.slice(-8) : id;
        lines.push(`  - ${shortId}: → x=${x}`);
      }
    }

    this.addLog('PUSH_CALC', lines.join('\n'));
  }

  logFinalResult(params: {
    originalW: number;
    finalW: number;
    maxAllowedWidth: number;
    movedWidgets: string[];
  }) {
    if (!ENABLE_RESIZE_DEBUG) return;

    const { originalW, finalW, maxAllowedWidth, movedWidgets } = params;

    const lines: string[] = ['FINAL RESULT:'];
    lines.push(`Original width: ${originalW}`);
    lines.push(`Requested width: (user drag)`);
    lines.push(`Max allowed width: ${maxAllowedWidth}`);
    lines.push(`Final width: ${finalW}`);
    lines.push(`Width change: ${finalW - originalW > 0 ? '+' : ''}${finalW - originalW}`);
    lines.push(`Widgets moved: ${movedWidgets.length > 0 ? movedWidgets.map(id => id.slice(-8)).join(', ') : 'none'}`);

    this.addLog('FINAL_RESULT', lines.join('\n'));
  }

  endSession() {
    if (!ENABLE_RESIZE_DEBUG) return;
    const separator = '='.repeat(80);
    this.addLog('SESSION_END', separator);
    this.addLog('SESSION_END', `RESIZE SESSION END: ${this.sessionId}`);
    this.addLog('SESSION_END', separator);
  }

  // Download logs as a text file
  downloadLogs() {
    const content = this.logs.map(entry => {
      let line = `[${entry.timestamp}] [${entry.sessionId}] [${entry.type}] ${entry.message}`;
      if (entry.data) {
        line += '\n  Data: ' + JSON.stringify(entry.data, null, 2).replace(/\n/g, '\n  ');
      }
      return line;
    }).join('\n\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resize-debug-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Get logs count
  getLogsCount(): number {
    return this.logs.length;
  }

  // Get all logs (for display in UI if needed)
  getLogs(): LogEntry[] {
    return [...this.logs];
  }
}

export const resizeLogger = new ResizeDebugLogger();

// Expose to window for easy console access
if (typeof window !== 'undefined') {
  (window as unknown as { resizeLogger: ResizeDebugLogger }).resizeLogger = resizeLogger;
}
