import { writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';

export interface ErrorLogEntry {
  timestamp: string;
  phase: string;
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
}

export class ScanLogger {
  private logs: ErrorLogEntry[] = [];

  constructor(
    private scanId: string,
    private artifactsPath: string
  ) {}

  log(phase: string, errorCode: string, message: string, details?: Record<string, unknown>, error?: Error) {
    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      phase,
      errorCode,
      message,
      ...(details && { details }),
      ...(error?.stack && { stack: error.stack }),
    };
    this.logs.push(entry);
    console.error(JSON.stringify({ type: 'error_log', ...entry }));
  }

  hasErrors(): boolean {
    return this.logs.length > 0;
  }

  getErrorCount(): number {
    return this.logs.length;
  }

  async saveErrorArtifact() {
    if (this.logs.length === 0) return;

    try {
      const errorPath = join(this.artifactsPath, this.scanId, 'error.json');
      await mkdir(dirname(errorPath), { recursive: true });
      await writeFile(
        errorPath,
        JSON.stringify(
          {
            scanId: this.scanId,
            errors: this.logs,
            savedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (error) {
      console.error(JSON.stringify({
        type: 'error_artifact_save_failed',
        scanId: this.scanId,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }
}

export const logger = {
  error: (phase: string, errorCode: string, message: string, details?: Record<string, unknown>, error?: Error) => {
    const entry = {
      timestamp: new Date().toISOString(),
      phase,
      errorCode,
      message,
      ...(details && { details }),
      ...(error?.stack && { stack: error.stack }),
    };
    console.error(JSON.stringify({ type: 'error_log', ...entry }));
  },
};
