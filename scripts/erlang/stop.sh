#!/bin/bash
set -euo pipefail

# Stop the Helpy Plan Erlang service

# Resolve script directory first for reliable common.sh loading
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
COMMON_LIB="${SCRIPT_DIR}/common.sh"
if [[ ! -f "$COMMON_LIB" ]]; then
    echo "ERROR: Missing required common.sh at $COMMON_LIB" >&2
    exit 1
fi
# shellcheck source=common.sh
source "$COMMON_LIB"

# Configuration constants for easy tuning
readonly RPC_TIMEOUT=5        # Wait time for RPC-initiated shutdown
readonly SIGTERM_TIMEOUT=10   # Wait time for SIGTERM before force kill
readonly SIGKILL_WAIT=2       # Wait time for SIGKILL to take effect
readonly PID_FILE_NAME="helpy_plan.pid"
readonly REQUIRED_VARS=("ERLANG_DIR" "NODE_NAME" "LOG_DIR")

# Global PID_FILE variable to maintain context across functions
PID_FILE=""
RPC_PID=""

# Enhanced cleanup function: handles all temporary resources, not just PID file
cleanup() {
    local exit_code="$1"
    # Clean up PID file if it exists
    if [[ -n "$PID_FILE" && -f "$PID_FILE" ]]; then
        rm -f "$PID_FILE" 2>/dev/null
        log_info "Removed PID file $PID_FILE"
    fi
    # Clean up any lingering RPC child processes
    if [[ -n "$RPC_PID" && ps -p "$RPC_PID" &>/dev/null ]]; then
        kill -9 "$RPC_PID" 2>/dev/null || true
        log_info "Terminated orphaned RPC process $RPC_PID"
    fi
    exit "$exit_code"
}

# Universal trap for all common exit signals to ensure cleanup runs every time
trap 'cleanup $?' EXIT
trap 'log_warn "Script interrupted by user"; cleanup 1' INT TERM HUP

# Validate required environment variables with strict checks
for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        log_error "Required environment variable $var is not set"
        exit 1
    fi
    # Additional path validation for filesystem variables
    if [[ "$var" =~ _DIR$ && ! -d "${!var}" ]]; then
        log_error "$var directory ${!var} does not exist or is not accessible"
        exit 1
    fi
done

# Change to Erlang directory with explicit error handling
if ! cd "$ERLANG_DIR"; then
    log_error "Failed to enter Erlang directory at $ERLANG_DIR"
    exit 1
fi

# Centralized PID file path with proper security context
PID_FILE="$LOG_DIR/$PID_FILE_NAME"
# Verify PID file is writable if it exists, or parent directory is writable if it doesn't
if [[ -f "$PID_FILE" ]]; then
    if [[ ! -w "$PID_FILE" ]]; then
        log_error "PID file $PID_FILE is not writable"
        exit 1
    fi
else
    if [[ ! -w "$LOG_DIR" ]]; then
        log_error "Log directory $LOG_DIR is not writable, cannot manage PID file"
        exit 1
    fi
fi

# Check if node is already stopped
if ! is_node_running; then
    log_warn "Node $NODE_NAME is not running"
    # Clean up stale PID file if it exists
    if [[ -f "$PID_FILE" ]]; then
        rm -f "$PID_FILE"
        log_info "Removed stale PID file"
    fi
    exit 0
fi

log_info "Stopping Helpy Plan service..."

# Get and validate PID
PID=$(get_node_pid)
if [[ -z "$PID" || ! "$PID" =~ ^[0-9]+$ ]]; then
    log_error "Could not find valid PID for node $NODE_NAME"
    cleanup 1
fi

# Verify the PID is actually our running node (with process name validation)
if ! ps -p "$PID" &>/dev/null; then
    log_warn "PID $PID is not running. Cleaning up."
    cleanup 1
fi
# Additional check to ensure we're killing the correct process
PROC_NAME=$(ps -p "$PID" -o comm= 2>/dev/null || true)
if [[ ! "$PROC_NAME" =~ beam|erl ]]; then
    log_error "PID $PID is not an Erlang process (found $PROC_NAME), aborting to avoid wrong process termination"
    exit 1
fi

# Generic wait loop for process termination, reduces code duplication
wait_for_shutdown() {
    local max_wait="$1"
    local check_interval=1
    for ((i=1; i<=max_wait; i++)); do
        if ! is_node_running; then
            return 0
        fi
        if (( i % 5 == 0 )); then
            log_info "Still waiting for service to stop (${i}s elapsed)..."
        fi
        sleep "$check_interval"
    done
    return 1
}

# Attempt graceful Erlang node shutdown via rpc first (native service shutdown)
log_info "Attempting graceful Erlang node shutdown via RPC"
# Use Erlang's built-in remsh instead of erpc for better compatibility
if command -v erl &>/dev/null; then
    # Run RPC shutdown in background to avoid blocking if connection hangs
    erl -noshell -remsh "$NODE_NAME" -eval 'init:stop().' &>/dev/null &
    RPC_PID=$!

    # Wait for RPC process with timeout handling
    if timeout "$RPC_TIMEOUT" wait "$RPC_PID" 2>/dev/null; then
        if wait_for_shutdown "$RPC_TIMEOUT"; then
            log_info "Service stopped successfully via graceful Erlang shutdown"
            cleanup 0
        fi
        log_warn "Graceful Erlang shutdown initiated but node still running, falling back to SIGTERM"
    else
        # RPC timed out or failed - clean up stuck process
        log_warn "RPC shutdown timed out or failed, falling back to SIGTERM"
        kill -9 "$RPC_PID" 2>/dev/null || true
        RPC_PID=""
    fi
else
    log_info "erl command not found, RPC shutdown unavailable, falling back to SIGTERM"
fi

# Send SIGTERM to process
log_info "Sending SIGTERM to process $PID ($PROC_NAME)"
if ! kill -TERM "$PID" 2>/dev/null; then
    log_warn "Failed to send SIGTERM, process may have already exited"
    # Verify process actually exited before cleanup
    if ! is_node_running; then
        log_info "Service exited before SIGTERM could be sent"
        cleanup 0
    fi
fi

# Wait for graceful shutdown
if wait_for_shutdown "$SIGTERM_TIMEOUT"; then
    log_info "Service stopped successfully after SIGTERM"
    cleanup 0
fi

# Force kill if graceful shutdown failed
log_warn "Service did not stop gracefully after ${SIGTERM_TIMEOUT}s, sending SIGKILL"
if ! kill -KILL "$PID" 2>/dev/null; then
    log_warn "Failed to send SIGKILL, process may have already exited"
fi

# Wait additional time for force kill to take effect
sleep "$SIGKILL_WAIT"

# Verify force kill worked
if is_node_running; then
    log_error "Failed to stop service even after SIGKILL"
    exit 1
else
    log_info "Service forcefully stopped"
    cleanup 0
fi

