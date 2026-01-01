// Debug logger for resize operations
// Enable/disable logging
const ENABLE_RESIZE_DEBUG = true;

interface ResizeLogEntry {
  timestamp: number;
  phase: string;
  data: Record<string, unknown>;
}

class ResizeDebugLogger {
  private logs: ResizeLogEntry[] = [];
  private sessionId: string = '';

  clear() {
    this.logs = [];
    this.sessionId = '';
    console.clear();
    console.log('🧹 Resize debug logs cleared');
  }

  startSession(widgetId: string, direction: string) {
    if (!ENABLE_RESIZE_DEBUG) return;
    this.sessionId = `resize-${Date.now()}`;
    this.logs = [];
    console.log('\n' + '='.repeat(80));
    console.log(`🔄 RESIZE SESSION START: ${this.sessionId}`);
    console.log(`   Widget: ${widgetId.slice(-8)}`);
    console.log(`   Direction: ${direction}`);
    console.log('='.repeat(80));
  }

  log(phase: string, data: Record<string, unknown>) {
    if (!ENABLE_RESIZE_DEBUG) return;
    this.logs.push({ timestamp: Date.now(), phase, data });

    const prefix = this.getPhasePrefix(phase);
    console.log(`\n${prefix} ${phase}`);

    // Format data nicely
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        console.log(`   ${key}: ${JSON.stringify(value)}`);
      } else {
        console.log(`   ${key}: ${value}`);
      }
    }
  }

  logWidgetPositions(label: string, widgets: Array<{ id: string; x: number; w: number; rightEdge?: number }>) {
    if (!ENABLE_RESIZE_DEBUG) return;
    console.log(`\n📊 ${label}:`);
    console.log('   ' + '-'.repeat(50));
    for (const w of widgets) {
      const id = w.id.length > 8 ? w.id.slice(-8) : w.id;
      const rightEdge = w.rightEdge ?? w.x + w.w;
      const bar = '█'.repeat(Math.min(w.w, 20));
      console.log(`   [${id}] x:${w.x.toString().padStart(2)} w:${w.w.toString().padStart(2)} → ${rightEdge.toString().padStart(2)} ${bar}`);
    }
    console.log('   ' + '-'.repeat(50));
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

    console.log('\n📐 PUSH CALCULATION:');
    console.log(`   Viewport columns: ${cols}`);
    console.log(`   Resizing widget: x=${resizingWidget.x}, w=${resizingWidget.w}, newRightEdge=${resizingWidget.newRightEdge}`);

    console.log('\n   Widgets to push:');
    for (const w of widgetsToPush) {
      const id = w.id.length > 8 ? w.id.slice(-8) : w.id;
      console.log(`     - ${id}: x=${w.x}, w=${w.w}${w.maxW ? `, maxW=${w.maxW}` : ''}`);
    }

    console.log(`\n   Can push: ${canPush ? '✅ YES' : '❌ NO'}`);

    if (newPositions.length > 0) {
      console.log('   New positions:');
      for (const [id, x] of newPositions) {
        const shortId = id.length > 8 ? id.slice(-8) : id;
        console.log(`     - ${shortId}: → x=${x}`);
      }
    }
  }

  logFinalResult(params: {
    originalW: number;
    finalW: number;
    maxAllowedWidth: number;
    movedWidgets: string[];
  }) {
    if (!ENABLE_RESIZE_DEBUG) return;

    const { originalW, finalW, maxAllowedWidth, movedWidgets } = params;

    console.log('\n✨ FINAL RESULT:');
    console.log(`   Original width: ${originalW}`);
    console.log(`   Requested width: (user drag)`);
    console.log(`   Max allowed width: ${maxAllowedWidth}`);
    console.log(`   Final width: ${finalW}`);
    console.log(`   Width change: ${finalW - originalW > 0 ? '+' : ''}${finalW - originalW}`);
    console.log(`   Widgets moved: ${movedWidgets.length > 0 ? movedWidgets.map(id => id.slice(-8)).join(', ') : 'none'}`);
  }

  endSession() {
    if (!ENABLE_RESIZE_DEBUG) return;
    console.log('\n' + '='.repeat(80));
    console.log(`🏁 RESIZE SESSION END: ${this.sessionId}`);
    console.log('='.repeat(80) + '\n');
  }

  private getPhasePrefix(phase: string): string {
    if (phase.includes('START')) return '🟢';
    if (phase.includes('PUSH')) return '➡️';
    if (phase.includes('CALC')) return '🔢';
    if (phase.includes('ERROR') || phase.includes('FAIL')) return '❌';
    if (phase.includes('SUCCESS')) return '✅';
    if (phase.includes('LIMIT')) return '⚠️';
    return '📍';
  }
}

export const resizeLogger = new ResizeDebugLogger();
