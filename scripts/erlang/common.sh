#!/bin/bash

# Common utilities for Helpy Plan Erlang service scripts
set -euo pipefail

# Resolve absolute path with realpath fallback for improved reliability
resolve_path() {
    local target_path="$1"
    local error_msg="$2"
    local resolved_path
    # Use realpath if available for more robust path resolution
    if command -v realpath &>/dev/null; then
        if ! resolved_path=$(realpath -- "$target_path" 2>/dev/null); then
            log_error "$error_msg"
            exit 1
        fi
    else
        # Fallback to original method for systems without realpath
        local dir
        dir=$(dirname -- "$target_path")
        if ! cd "$dir" 2>/dev/null; then
            log_error "$error_msg"
            exit 1
        fi
        resolved_path=$(pwd)/$(basename -- "$target_path")
    fi
    echo "$resolved_path"
}

# Configuration - Allow environment variable overrides
# Resolve absolute paths with robust error handling
SCRIPT_DIR=$(resolve_path "$(dirname -- "${BASH_SOURCE[0]}")" "Failed to resolve script directory")
PROJECT_ROOT="${PROJECT_ROOT:-$(resolve_path "$SCRIPT_DIR/../.." "Failed to resolve project root from $SCRIPT_DIR")}"
ERLANG_DIR="${ERLANG_DIR:-$PROJECT_ROOT/erlang}"
LOG_DIR="${LOG_DIR:-$PROJECT_ROOT/logs}"
NODE_NAME="${NODE_NAME:-helpy_plan@localhost}"
COOKIE="${COOKIE:-helpy_plan_cookie}"
PID_DIR="${PID_DIR:-$PROJECT_ROOT/run}"
NODE_PID_FILE="$PID_DIR/helpy_plan.pid"
# Add lock file to prevent multiple simultaneous script executions
SCRIPT_LOCK_FILE="$PID_DIR/helpy_plan_script.lock"

# Parse node short name once for reuse across functions
NODE_SHORTNAME=${NODE_NAME%@*}

# Terminal color detection with 256-color fallback support
if [ -t 1 ]; then
    # Check if terminal supports ANSI colors
    if [ "${TERM:-dumb}" != "dumb" ] && tput setaf 1 &>/dev/null; then
        RED=$(tput setaf 1)
        GREEN=$(tput setaf 2)
        YELLOW=$(tput setaf 3)
        NC=$(tput sgr0) # No Color
    else
        RED=$'\033[0;31m'
        GREEN=$'\033[0;32m'
        YELLOW=$'\033[1;33m'
        NC=$'\033[0m' # No Color
    fi
else
    RED=''
    GREEN=''
    YELLOW=''
    NC=''
fi

# Structured logging with timestamps for log file compatibility
log_info() {
    printf "%s%s%s %s\n" "${GREEN}$(date '+%Y-%m-%d %H:%M:%S') [INFO]" "${NC}" "$1"
}

log_warn() {
    printf "%s%s%s %s\n" "${YELLOW}$(date '+%Y-%m-%d %H:%M:%S') [WARN]" "${NC}" "$1" >&2
}

log_error() {
    printf "%s%s%s %s\n" "${RED}$(date '+%Y-%m-%d %H:%M:%S') [ERROR]" "${NC}" "$1" >&2
}

# Enhanced debug logging for development environments
log_debug() {
    if [ "${DEBUG:-0}" -eq 1 ]; then
        printf "%s %s\n" "$(date '+%Y-%m-%d %H:%M:%S') [DEBUG]" "$1"
    fi
}

# Create required directories with secure permissions
ensure_dirs() {
    mkdir -m 0750 -p -- "$LOG_DIR" "$PID_DIR"
    # Verify directory creation succeeded
    if [ ! -d "$LOG_DIR" ] || [ ! -d "$PID_DIR" ]; then
        log_error "Failed to create required directories in $PROJECT_ROOT"
        exit 1
    fi
    # Set proper ownership if running as root (optional, for production environments)
    if [ "$(id -u)" -eq 0 ]; then
        chown -R root:adm -- "$LOG_DIR" "$PID_DIR" 2>/dev/null || true
    fi
}

# Validate critical paths exist and have proper permissions
validate_paths() {
    if [[ ! -d "$ERLANG_DIR" ]]; then
        log_error "Erlang directory not found at $ERLANG_DIR"
        return 1
    fi
    # Verify we have read access to Erlang directory
    if [[ ! -r "$ERLANG_DIR" ]]; then
        log_error "No read permissions for Erlang directory at $ERLANG_DIR"
        return 1
    fi
    # Validate critical Erlang components exist
    if ! command -v erl &>/dev/null; then
        log_error "Erlang interpreter (erl) not found in PATH"
        return 1
    fi
    # Additional validation: check for epmd required for distributed Erlang
    if ! command -v epmd &>/dev/null; then
        log_warn "epmd (Erlang Port Mapper Daemon) not found in PATH, distributed node features may fail"
    fi
    return 0
}

# Process lock management to prevent concurrent script execution
acquire_script_lock() {
    # Create lock file parent directory if it doesn't exist
    mkdir -p -- "$(dirname "$SCRIPT_LOCK_FILE")"
    exec 200>"$SCRIPT_LOCK_FILE"
    if ! flock -n 200; then
        log_error "Another instance of this script is already running. Lock file: $SCRIPT_LOCK_FILE"
        exit 1
    fi
    # Write current PID to lock file for debugging
    echo $$ >&200
}

# Reusable PID validation function with process name verification
is_pid_alive() {
    local pid="$1"
    # Basic PID format validation
    if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
        return 1
    fi
    # Check if process exists and is an Erlang beam process to avoid false positives
    if kill -0 "$pid" 2>/dev/null; then
        # Additional verification that the process is actually our Erlang node
        if command -v ps &>/dev/null; then
            if ps -p "$pid" -o comm= 2>/dev/null | grep -q "beam"; then
                return 0
            fi
        fi
        return 0 # Fallback to basic check if ps isn't available
    fi
    return 1
}

# Check if Erlang node is running with improved reliability and cross-platform support
is_node_running() {
    # First check if we have a recorded PID file that's still active
    if [[ -f "$NODE_PID_FILE" ]]; then
        local saved_pid
        read -r saved_pid <"$NODE_PID_FILE"
        # Validate PID is an integer before sending signals
        if is_pid_alive "$saved_pid"; then
            return 0
        else
            # Clean up stale PID file
            rm -f -- "$NODE_PID_FILE"
            log_debug "Removed stale PID file $NODE_PID_FILE"
        fi
    fi

    # Fallback to epmd check with proper parsing
    if command -v epmd >/dev/null 2>&1; then
        if epmd -names 2>/dev/null | awk '{print $2}' | grep -qx -- "$NODE_SHORTNAME"; then
            return 0
        fi
    fi

    # Cross-platform PID detection (supports Linux, macOS, BSD)
    if command -v pgrep &>/dev/null; then
        if pgrep -f -- "beam.*$NODE_SHORTNAME" &>/dev/null; then
            return 0
        fi
    elif command -v ps &>/dev/null; then
        if ps ax | grep -v grep | grep -q -- "beam.*$NODE_SHORTNAME"; then
            return 0
        fi
    fi

    return 1
}

# Get PID of running node with multiple detection methods and validation
get_node_pid() {
    # First check PID file
    if [[ -f "$NODE_PID_FILE" ]]; then
        local saved_pid
        read -r saved_pid <"$NODE_PID_FILE"
        if is_pid_alive "$saved_pid"; then
            echo "$saved_pid"
            return 0
        fi
        rm -f -- "$NODE_PID_FILE"
    fi

    # Cross-platform PID lookup with proper node name parsing
    local node_pid
    if command -v pgrep &>/dev/null; then
        node_pid=$(pgrep -f -- "beam.*$NODE_SHORTNAME" | head -n1)
    elif command -v ps &>/dev/null; then
        node_pid=$(ps ax | grep -v grep | grep -- "beam.*$NODE_SHORTNAME" | awk '{print $1}' | head -n1)
    fi

    if [[ -n "$node_pid" ]] && is_pid_alive "$node_pid"; then
        # Cache PID to file for future checks
        echo "$node_pid" >"$NODE_PID_FILE"
        echo "$node_pid"
        return 0
    fi

    log_error "Could not find running node process for $NODE_NAME"
    return 1
}

# Update derived paths after configuration changes
update_derived_paths() {
    NODE_PID_FILE="$PID_DIR/helpy_plan.pid"
    SCRIPT_LOCK_FILE="$PID_DIR/helpy_plan_script.lock"
}

# Load environment config with error handling and variable validation
load_config() {
    local env_file="${ENV_FILE:-$PROJECT_ROOT/config/erlang_env.sh}"
    if [[ -f "$env_file" ]]; then
        log_info "Loading configuration from $env_file"
        # Source environment file in current shell instead of subshell to properly capture variables
        if source "$env_file"; then
            log_info "Successfully loaded environment configuration"
            # Override our variables only if they're set in the environment file
            if [ -n "${ERLANG_DIR:-}" ]; then
                ERLANG_DIR="$(resolve_path "$ERLANG_DIR" "Invalid ERLANG_DIR path in environment file")"
            fi
            if [ -n "${LOG_DIR:-}" ]; then
                LOG_DIR="$(resolve_path "$LOG_DIR" "Invalid LOG_DIR path in environment file")"
            fi
            if [ -n "${NODE_NAME:-}" ]; then
                # Validate node name format
                if [[ ! "$NODE_NAME" =~ ^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$ ]]; then
                    log_error "Invalid NODE_NAME format in environment file: $NODE_NAME. Must be name@host"
                    return 1
                fi
                NODE_SHORTNAME=${NODE_NAME%@*}
            fi
            if [ -n "${COOKIE:-}" ]; then
                COOKIE="$COOKIE"
            fi
            if [ -n "${PID_DIR:-}" ]; then
                PID_DIR="$(resolve_path "$PID_DIR" "Invalid PID_DIR path in environment file")"
            fi
            # Update derived variables after config load
            update_derived_paths
            # Recreate directories if paths changed
            ensure_dirs
            return 0
        else
            log_error "Failed to load configuration from $env_file"
            return 1
        fi
    else
        log_warn "Environment file $env_file not found, using default values"
        return 0
    fi
}

# Graceful shutdown handler for script termination
cleanup() {
    local exit_code=$?
    # Remove lock file on exit
    if [ -f "$SCRIPT_LOCK_FILE" ]; then
        rm -f -- "$SCRIPT_LOCK_FILE"
        log_debug "Cleaned up script lock file"
    fi
    exit $exit_code
}

# Register cleanup handlers for proper resource management
trap cleanup EXIT INT TERM HUP

# Safely evaluate DEBUG variable to prevent errors if it's malformed
if ! [[ "${DEBUG:-0}" =~ ^[01]$ ]]; then
    DEBUG=0
fi

# Initialize required system directories and configuration
acquire_script_lock
ensure_dirs
load_config || exit 1
validate_paths || exit 1

# Start epmd if it's not running (required for distributed Erlang)
if command -v epmd &>/dev/null && ! pgrep -x epmd &>/dev/null; then
    log_info "Starting epmd (Erlang Port Mapper Daemon)"
    epmd -daemon
fi

log_debug "Common utilities initialized successfully"

