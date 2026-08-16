'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.generateTaskTitle =
  exports.calculateChunkDuration =
  exports.calculateNumChunks =
  exports.generateTaskTitleJS =
  exports.calculateChunkDurationJS =
  exports.calculateNumChunksJS =
  exports.initWASM =
    void 0;
let wasmReady = false;
let wasmModule = null;
const initWASM = async () => {
  if (wasmReady && wasmModule) {
    return true;
  }
  // For now, we'll provide a fallback to JavaScript implementations
  // If Emscripten is installed, the WASM module would be loaded here
  console.log('WASM module not compiled, using JavaScript fallback');
  wasmReady = true;
  return false;
};
exports.initWASM = initWASM;
// JavaScript fallback implementations
const calculateNumChunksJS = (totalDuration, chunkSize) => {
  if (chunkSize <= 0) chunkSize = 15;
  const num = Math.ceil(totalDuration / chunkSize);
  return num > 0 ? num : 1;
};
exports.calculateNumChunksJS = calculateNumChunksJS;
const calculateChunkDurationJS = (totalDuration, chunkSize, chunkIndex, numChunks) => {
  if (chunkIndex < 0 || chunkIndex >= numChunks) return 0;
  if (chunkIndex < numChunks - 1) {
    return chunkSize;
  }
  return totalDuration - chunkSize * (numChunks - 1);
};
exports.calculateChunkDurationJS = calculateChunkDurationJS;
const generateTaskTitleJS = (goal, descriptor, partNumber) => {
  if (goal && goal.length > 0) {
    return `${descriptor}: ${goal}`;
  } else {
    return `${descriptor} - Part ${partNumber}`;
  }
};
exports.generateTaskTitleJS = generateTaskTitleJS;
// Export functions that use WASM if available, otherwise JS fallback
const calculateNumChunks = (totalDuration, chunkSize) => {
  if (wasmReady && wasmModule) {
    // Type assertion to bypass TypeScript checks since we know wasmModule is non-null here
    return wasmModule.calculate_num_chunks(totalDuration, chunkSize);
  }
  return (0, exports.calculateNumChunksJS)(totalDuration, chunkSize);
};
exports.calculateNumChunks = calculateNumChunks;
const calculateChunkDuration = (totalDuration, chunkSize, chunkIndex, numChunks) => {
  if (wasmReady && wasmModule) {
    return wasmModule.calculate_chunk_duration(totalDuration, chunkSize, chunkIndex, numChunks);
  }
  return (0, exports.calculateChunkDurationJS)(totalDuration, chunkSize, chunkIndex, numChunks);
};
exports.calculateChunkDuration = calculateChunkDuration;
const generateTaskTitle = (goal, descriptor, partNumber) => {
  if (wasmReady && wasmModule) {
    const module = wasmModule;
    const goalPtr = module._malloc(goal.length + 1);
    const descriptorPtr = module._malloc(descriptor.length + 1);
    module.stringToUTF8(goal, goalPtr, goal.length + 1);
    module.stringToUTF8(descriptor, descriptorPtr, descriptor.length + 1);
    const titlePtr = module.generate_task_title(goalPtr, descriptorPtr, partNumber);
    const title = module.UTF8ToString(titlePtr);
    module._free(goalPtr);
    module._free(descriptorPtr);
    module.free_string(titlePtr);
    return title;
  }
  return (0, exports.generateTaskTitleJS)(goal, descriptor, partNumber);
};
exports.generateTaskTitle = generateTaskTitle;
