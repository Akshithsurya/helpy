#!/bin/bash
# Common utilities for Helpy Plan Erlang service scripts
set -euo pipefail

# --------------------------
# Global State & Dependencies
# --------------------------
# Declare all global variables (prevents unbound variable errors with strict mode)
declare -g SCRIPT_DIR PROJECT_ROOT ERLANG_DIR LOG_DIR NODE_NAME COOKIE PID_DIR DEBUG
declare -g NODE_PID_FILE SCRIPT_LOCK_FILE NODE_SHORTNAME
declare -g RED GREEN YELLOW NC

# Ensure helper functions exist before any operations that depend on them
# Initialize color output for terminal logging
init_colors() {
    # Only enable colors if output is a terminal
    if [ -t 1 ]; then
        RED=$'\033[0;31m'
        GREEN=$'\033[0;32m'
        YELLOW=$'\033[1;33m'
        NC=$'\033[0m' # No Color
    else
        RED=""
        GREEN=""
        YELLOW=""
        NC=""
    fi
}

# Logging utilities (defined early for use in all other functions)
log_info() { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_debug() { if [ "${DEBUG:-0}" -eq 1 ]; then echo -e "[DEBUG] $*" >&2; fi; }

# --------------------------
# Core Path & Configuration Helpers
# --------------------------
# Resolve absolute path with realpath fallback for cross-system reliability
resolve_path() {
    local target_path="$1"
    local error_msg="$2"
    local resolved_path

    # Use realpath if available for robust path resolution
    if command -v realpath &>/dev/null; then
        if ! resolved_path=$(realpath -- "$target_path" 2>/dev/null); then
            log_error "$error_msg"
            exit 1
        fi
    else
        # Fallback for systems without realpath
        local dir
        dir=$(dirname -- "$target_path")
        if ! cd "$dir" 2>/dev/null; then
            log_error "$error_msg"
            exit 1
        fi
        resolved_path="$(pwd)/$(basename -- "$target_path")"
    fi

    echo "$resolved_path"
}

# Derive node shortname from full node name (required for Erlang process detection)
update_node_shortname() {
    NODE_SHORTNAME="${NODE_NAME%%@*}"
    log_debug "Updated node shortname to: $NODE_SHORTNAME"
}

# Update all derived file paths after configuration changes
update_derived_paths() {
    NODE_PID_FILE="${PID_DIR}/${NODE_SHORTNAME}.pid"
    SCRIPT_LOCK_FILE="${PID_DIR}/${NODE_SHORTNAME}.lock"
    log_debug "Updated derived paths: PID file=$NODE_PID_FILE, Lock file=$SCRIPT_LOCK_FILE"
}

# Validate all required base paths exist and are accessible
validate_paths() {
    local required_paths=("$ERLANG_DIR" "$PROJECT_ROOT")
    for path in "${required_paths[@]}"; do
        if [ ! -d "$path" ]; then
            log_error "Required directory missing: $path"
            return 1
        fi
        if [ ! -r "$path" ]; then
            log_error "No read permissions for directory: $path"
            return 1
        fi
    done
    log_debug "All core paths validated successfully"
    return 0
}

# Create required runtime directories with proper permissions
ensure_dirs() {
    local required_dirs=("$LOG_DIR" "$PID_DIR")
    for dir in "${required_dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            log_debug "Creating missing directory: $dir"
            mkdir -p -- "$dir" || { log_error "Failed to create $dir"; exit 1; }
            chmod 750 -- "$dir" # Restrict access to owner/group only
        fi
    done
}

# Prevent multiple script instances from running with file locking
acquire_script_lock() {
    # Create lock file and acquire exclusive lock
    exec 200>"$SCRIPT_LOCK_FILE"
    if ! flock -n -e 200; then
        log_error "Another instance of this script is already running (lock file: $SCRIPT_LOCK_FILE)"
        exit 1
    fi
    log_debug "Successfully acquired script lock"
}

# Check if a given PID is still running and active
is_pid_alive() {
    local pid="$1"
    # Validate PID is a positive integer first
    if ! [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
        log_debug "Invalid PID format: $pid"
        return 1
    fi
    # Use kill -0 to check process existence (doesn't send any signal)
    if kill -0 "$pid" 2>/dev/null; then
        # Additional check to verify it's not a stale PID reused by another process
        if ps -p "$pid" -o comm= 2>/dev/null | grep -q beam; then
            return 0
        fi
    fi
    return 1
}

# --------------------------
# Node Status & Process Management
# --------------------------
# Check if Erlang node is currently running
is_node_running() {
    # First check PID file for existing, valid PID
    if [[ -f "$NODE_PID_FILE" ]]; then
        local saved_pid
        read -r saved_pid <"$NODE_PID_FILE"
        if is_pid_alive "$saved_pid"; then
            log_debug "Node $NODE_NAME is running (PID $saved_pid, from PID file)"
            return 0
        else
            # Clean up stale PID file
            rm -f -- "$NODE_PID_FILE"
            log_debug "Removed stale PID file $NODE_PID_FILE"
        fi
    fi

    # Fallback to epmd check for distributed node detection
    if command -v epmd >/dev/null 2>&1; then
        if epmd -names 2>/dev/null | awk '{print $2}' | grep -qx -- "$NODE_SHORTNAME"; then
            log_debug "Node $NODE_NAME detected running via epmd"
            return 0
        fi
    fi

    # Cross-platform process scanning (Linux/macOS/BSD)
    if command -v pgrep &>/dev/null; then
        if pgrep -f -- "beam.*$NODE_SHORTNAME" &>/dev/null; then
            log_debug "Node $NODE_NAME detected running via pgrep"
            return 0
        fi
    elif command -v ps &>/dev/null; then
        if ps ax | grep -v grep | grep -q -- "beam.*$NODE_SHORTNAME"; then
            log_debug "Node $NODE_NAME detected running via ps"
            return 0
        fi
    fi

    log_debug "Node $NODE_NAME is not running"
    return 1
}

# Get PID of running node with caching to PID file
get_node_pid() {
    # First check cached PID file
    if [[ -f "$NODE_PID_FILE" ]]; then
        local saved_pid
        read -r saved_pid <"$NODE_PID_FILE"
        if is_pid_alive "$saved_pid"; then
            echo "$saved_pid"
            return 0
        fi
        rm -f -- "$NODE_PID_FILE"
    fi

    # Scan for node process if PID cache is stale
    local node_pid
    if command -v pgrep &>/dev/null; then
        node_pid=$(pgrep -f -- "beam.*$NODE_SHORTNAME" | head -n1)
    elif command -v ps &>/dev/null; then
        node_pid=$(ps ax | grep -v grep | grep -- "beam.*$NODE_SHORTNAME" | awk '{print $1}' | head -n1)
    fi

    # Validate found PID and cache it for future calls
    if [[ -n "$node_pid" ]] && is_pid_alive "$node_pid"; then
        echo "$node_pid" >"$NODE_PID_FILE"
        echo "$node_pid"
        log_debug "Found running node PID $node_pid, cached to $NODE_PID_FILE"
        return 0
    fi

    log_error "Could not find running node process for $NODE_NAME"
    return 1
}

# --------------------------
# Configuration Loading
# --------------------------
# Load environment configuration from external file with validation
load_config() {
    local env_file="${ENV_FILE:-$PROJECT_ROOT/config/erlang_env.sh}"
    if [[ -f "$env_file" ]]; then
        log_info "Loading configuration from $env_file"
        # Source environment file in current shell to capture variables
        if source "$env_file"; then
            log_info "Successfully loaded environment configuration"
            
            # Override core variables if they're set in the environment file
            if [ -n "${ERLANG_DIR:-}" ]; then
                ERLANG_DIR="$(resolve_path "$ERLANG_DIR" "Invalid ERLANG_DIR path in environment file")"
            fi
            if [ -n "${LOG_DIR:-}" ]; then
                LOG_DIR="$(resolve_path "$LOG_DIR" "Invalid LOG_DIR path in environment file")"
            fi
            if [ -n "${NODE_NAME:-}" ]; then
                # Validate Erlang node name format (name@host)
                if [[ ! "$NODE_NAME" =~ ^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$ ]]; then
                    log_error "Invalid NODE_NAME format in environment file: $NODE_NAME. Must be name@host"
                    return 1
                fi
                update_node_shortname
            fi
            if [ -n "${COOKIE:-}" ]; then
                COOKIE="$COOKIE"
            fi
            if [ -n "${PID_DIR:-}" ]; then
                PID_DIR="$(resolve_path "$PID_DIR" "Invalid PID_DIR path in environment file")"
            fi
            if [ -n "${DEBUG:-}" ]; then
                # Sanitize debug value to prevent invalid states
                DEBUG=$([[ "$DEBUG" =~ ^[01]$ ]] && echo "$DEBUG" || echo 0)
            fi

            # Update derived state after configuration changes
            update_derived_paths
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

# --------------------------
# Shutdown & Initialization
# --------------------------
# Graceful cleanup handler for script termination
cleanup() {
    local exit_code=$?
    # Remove lock file to release script lock
    if [ -f "$SCRIPT_LOCK_FILE" ]; then
        rm -f -- "$SCRIPT_LOCK_FILE"
        log_debug "Cleaned up script lock file"
    fi
    exit "$exit_code"
}

# Initialize core state before any operations
init_colors

# Resolve base paths first
SCRIPT_DIR=$(resolve_path "$(dirname -- "${BASH_SOURCE[0]}")" "Failed to resolve script directory")
PROJECT_ROOT="${PROJECT_ROOT:-$(resolve_path "$SCRIPT_DIR/../.." "Failed to resolve project root from $SCRIPT_DIR")}"

# Load default configuration values (can be overridden by environment/config)
ERLANG_DIR="${ERLANG_DIR:-$PROJECT_ROOT/erlang}"
LOG_DIR="${LOG_DIR:-$PROJECT_ROOT/logs}"
NODE_NAME="${NODE_NAME:-helpy_plan@localhost}"
COOKIE="${COOKIE:-helpy_plan_cookie}"
PID_DIR="${PID_DIR:-$PROJECT_ROOT/run}"
DEBUG="${DEBUG:-0}"
# Initialize derived node values
update_node_shortname
update_derived_paths

# Register cleanup handlers for proper resource management
trap cleanup EXIT INT TERM HUP

# Validate and sanitize debug flag
if ! [[ "$DEBUG" =~ ^[01]$ ]]; then
    DEBUG=0
fi

# Run core initialization sequence
acquire_script_lock
ensure_dirs
load_config || exit 1
validate_paths || exit 1

# Start epmd if not running (required for distributed Erlang)
if command -v epmd &>/dev/null && ! pgrep -x epmd &>/dev/null; then
    log_info "Starting epmd (Erlang Port Mapper Daemon)"
    epmd -daemon
fi

log_debug "Common utilities initialized successfully"
