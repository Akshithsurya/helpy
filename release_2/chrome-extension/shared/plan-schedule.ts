import { Task } from '../../src/types';
import { PlanError, PLAN_ERROR_CODES } from './plan-core';

export interface CycleDetectionResult {
  hasCycle: boolean;
  cycles: string[][];
}

export interface DependencyGraphResult {
  isValid: boolean;
  hasCycle: boolean;
  topologicalOrder: string[];
  cycles: string[][];
}

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

export function detectCycles(tasks: Task[]): CycleDetectionResult {
  const idToTask = new Map<string, Task>();
  tasks.forEach(t => idToTask.set(t.id, t));
  const cycles: string[][] = [];
  const color: Map<string, number> = new Map();
  const stack: string[] = [];

  function dfs(id: string) {
    color.set(id, GRAY);
    stack.push(id);
    const task = idToTask.get(id);
    const deps = task?.dependencies || [];
    for (const dep of deps) {
      if (!idToTask.has(dep)) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const startIdx = stack.indexOf(dep);
        if (startIdx !== -1) {
          const cycle = [...stack.slice(startIdx), dep];
          cycles.push(cycle);
        }
      } else if (c === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  }

  tasks.forEach(t => {
    if ((color.get(t.id) ?? WHITE) === WHITE) dfs(t.id);
  });

  return { hasCycle: cycles.length > 0, cycles };
}

export function topologicalSort(tasks: Task[]): string[] | null {
  const idToTask = new Map<string, Task>();
  tasks.forEach(t => idToTask.set(t.id, t));
  const inDegree: Map<string, number> = new Map();
  tasks.forEach(t => inDegree.set(t.id, 0));
  tasks.forEach(t => {
    for (const dep of t.dependencies || []) {
      if (idToTask.has(dep)) {
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
      }
    }
  });

  const queue: string[] = [];
  tasks.forEach(t => {
    if ((inDegree.get(t.id) ?? 0) === 0) queue.push(t.id);
  });

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    tasks.forEach(t => {
      if ((t.dependencies || []).includes(id)) {
        const d = (inDegree.get(t.id) ?? 1) - 1;
        inDegree.set(t.id, d);
        if (d === 0) queue.push(t.id);
      }
    });
  }

  if (order.length !== tasks.length) return null;
  return order;
}

export function buildDependencyGraph(tasks: Task[]): DependencyGraphResult {
  const cycleResult = detectCycles(tasks);
  if (cycleResult.hasCycle) {
    throw new PlanError(
      PLAN_ERROR_CODES.CYCLE_DEPENDENCY,
      'Dependency cycle detected in tasks',
      { cycles: cycleResult.cycles }
    );
  }
  const order = topologicalSort(tasks);
  return {
    isValid: order !== null,
    hasCycle: cycleResult.hasCycle,
    topologicalOrder: order ?? [],
    cycles: cycleResult.cycles,
  };
}
