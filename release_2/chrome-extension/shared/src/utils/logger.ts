export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: any;
}

class Logger {
  private logHistory: LogEntry[] = [];
  private maxHistorySize: number = 1000;
  private currentLevel: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  debug(message: string, metadata?: any): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  info(message: string, metadata?: any): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  warn(message: string, metadata?: any): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  error(message: string, metadata?: any): void {
    this.log(LogLevel.ERROR, message, metadata);
  }

  private log(level: LogLevel, message: string, metadata?: any): void {
    if (level < this.currentLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata
    };

    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }

    this.output(entry);
  }

  private output(entry: LogEntry): void {
    const levelStr = LogLevel[entry.level].toLowerCase();
    const output = `[${entry.timestamp}] [${levelStr.toUpperCase()}] ${entry.message}`;
    if (entry.level >= LogLevel.ERROR) {
      console.error(output, entry.metadata || '');
    } else if (entry.level === LogLevel.WARN) {
      console.warn(output, entry.metadata || '');
    } else {
      console.log(output, entry.metadata || '');
    }
  }

  getHistory(level?: LogLevel): LogEntry[] {
    if (level !== undefined) {
      return this.logHistory.filter(entry => entry.level === level);
    }
    return [...this.logHistory];
  }

  clearHistory(): void {
    this.logHistory = [];
  }

  exportHistory(): string {
    return JSON.stringify(this.logHistory, null, 2);
  }

  // Helper method to get history as a formatted string
  getHistoryString(): string {
    return this.logHistory
      .map(entry => {
        const levelStr = LogLevel[entry.level].toLowerCase();
        const metaStr = entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : '';
        return `[${entry.timestamp}] [${levelStr.toUpperCase()}] ${entry.message}${metaStr}`;
      })
      .join('\n');
  }
}

export const logger = new Logger();
