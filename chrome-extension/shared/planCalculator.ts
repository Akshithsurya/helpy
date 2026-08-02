
// Type definitions for our WASM module
interface PlanCalculatorWASM {
  calculate_num_chunks: (totalDuration: number, chunkSize: number) => number;
  calculate_chunk_duration: (
    totalDuration: number,
    chunkSize: number,
    chunkIndex: number,
    numChunks: number
  ) => number;
  generate_task_title: (goalPtr: number, descriptorPtr: number, partNumber: number) => number;
  free_string: (ptr: number) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, ptr: number, maxBytes: number) => number;
}

declare const Module: PlanCalculatorWASM & {
  onRuntimeInitialized?: () => void;
};

let wasmReady = false;
let wasmModule: PlanCalculatorWASM | null = null;

export const initWASM = async (): Promise<boolean> => {
  if (wasmReady && wasmModule) {
    return true;
  }

  // For now, we'll provide a fallback to JavaScript implementations
  // If Emscripten is installed, the WASM module would be loaded here
  console.log('WASM module not compiled, using JavaScript fallback');
  wasmReady = true;
  return false;
};

// JavaScript fallback implementations
export const calculateNumChunksJS = (totalDuration: number, chunkSize: number): number => {
  if (chunkSize <= 0) chunkSize = 15;
  const num = Math.ceil(totalDuration / chunkSize);
  return num > 0 ? num : 1;
};

export const calculateChunkDurationJS = (
  totalDuration: number,
  chunkSize: number,
  chunkIndex: number,
  numChunks: number
): number => {
  if (chunkIndex < 0 || chunkIndex >= numChunks) return 0;
  if (chunkIndex < numChunks - 1) {
    return chunkSize;
  }
  return totalDuration - chunkSize * (numChunks - 1);
};

export const generateTaskTitleJS = (goal: string, descriptor: string, partNumber: number): string => {
  if (goal && goal.length > 0) {
    return `${descriptor}: ${goal}`;
  } else {
    return `${descriptor} - Part ${partNumber}`;
  }
};

// Export functions that use WASM if available, otherwise JS fallback
export const calculateNumChunks = (totalDuration: number, chunkSize: number): number => {
  if (wasmReady && wasmModule) {
    // Type assertion to bypass TypeScript checks since we know wasmModule is non-null here
    return (wasmModule as PlanCalculatorWASM).calculate_num_chunks(totalDuration, chunkSize);
  }
  return calculateNumChunksJS(totalDuration, chunkSize);
};

export const calculateChunkDuration = (
  totalDuration: number,
  chunkSize: number,
  chunkIndex: number,
  numChunks: number
): number => {
  if (wasmReady && wasmModule) {
    return (wasmModule as PlanCalculatorWASM).calculate_chunk_duration(
      totalDuration,
      chunkSize,
      chunkIndex,
      numChunks
    );
  }
  return calculateChunkDurationJS(
    totalDuration,
    chunkSize,
    chunkIndex,
    numChunks
  );
};

export const generateTaskTitle = (goal: string, descriptor: string, partNumber: number): string => {
  if (wasmReady && wasmModule) {
    const module = wasmModule as PlanCalculatorWASM;
    const goalPtr = module._malloc(goal.length + 1);
    const descriptorPtr = module._malloc(descriptor.length + 1);
    module.stringToUTF8(goal, goalPtr, goal.length + 1);
    module.stringToUTF8(descriptor, descriptorPtr, descriptor.length + 1);
    const titlePtr = module.generate_task_title(
      goalPtr,
      descriptorPtr,
      partNumber
    );
    const title = module.UTF8ToString(titlePtr);
    module._free(goalPtr);
    module._free(descriptorPtr);
    module.free_string(titlePtr);
    return title;
  }
  return generateTaskTitleJS(goal, descriptor, partNumber);
};
