/**
 * Performance monitoring utilities for MCP tools
 */

export class PerformanceTimer {
  private startTime: number;
  private checkpoints: Map<string, number> = new Map();

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Mark a checkpoint in the execution
   */
  checkpoint(name: string): void {
    this.checkpoints.set(name, Date.now());
  }

  /**
   * Get elapsed time since start
   */
  getElapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get time between checkpoints
   */
  getCheckpointDuration(from: string, to: string): number {
    const fromTime = this.checkpoints.get(from);
    const toTime = this.checkpoints.get(to);
    
    if (!fromTime || !toTime) {
      throw new Error(`Checkpoint not found: ${from} or ${to}`);
    }
    
    return toTime - fromTime;
  }

  /**
   * Get all checkpoint durations from start
   */
  getAllCheckpointDurations(): Record<string, number> {
    const durations: Record<string, number> = {};
    
    for (const [name, time] of this.checkpoints) {
      durations[name] = time - this.startTime;
    }
    
    return durations;
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    totalDuration: number;
    checkpoints: Record<string, number>;
    checkpointDurations: Record<string, number>;
  } {
    return {
      totalDuration: this.getElapsed(),
      checkpoints: Object.fromEntries(this.checkpoints),
      checkpointDurations: this.getAllCheckpointDurations()
    };
  }
}