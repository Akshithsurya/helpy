#!/bin/bash

# Check status of Helpy Plan Erlang service
set -euo pipefail

# Resolve script directory with robust error handling
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || { echo "ERROR: Failed to resolve script directory"; exit 1; }
# shellcheck source=common.sh
COMMON_SH="$SCRIPT_DIR/common.sh"
if [ -f "$COMMON_SH" ]; then
    # shellcheck source=/dev/null
    source "$COMMON_SH"
else
    echo "ERROR: common.sh not found at $COMMON_SH"
    exit 1
fi

# Validate required logging variables from common.sh
if [ -z "${LOG_DIR:-}" ] || [ -z "${PID_DIR:-}" ]; then
    log_error "ERROR: LOG_DIR or PID_DIR not defined in common.sh"
    exit 1
fi

# Standardize file paths
PID_FILE="$PID_DIR/helpy_plan.pid"
LOG_FILE="$LOG_DIR/helpy_plan.log"
# Add configuration for service node name to centralize configuration
NODE_NAME="helpy_plan@localhost"
# Configuration for log display limits
MAIN_LOG_LINES=15
ARCHIVED_LOG_LINES=10

# Global warning/error collectors for JSON output
WARNINGS=()
ERRORS=()

# Override common logging functions to capture warnings/errors
log_info() {
    command log_info "$@"
}
log_warn() {
    WARNINGS+=("$*")
    command log_warn "$@"
}
log_error() {
    ERRORS+=("$*")
    command log_error "$@"
}

# Function to check if the Erlang node is alive via ping
check_erlang_node() {
    ping_erlang_node "$NODE_NAME" >/dev/null 2>&1
}

# Helper function to safely read PID from file with error handling
read_pid_from_file() {
    local pid_file="$1"
    local stored_pid=""
    if [ -f "$pid_file" ] && read -r stored_pid < "$pid_file"; then
        stored_pid=${stored_pid//[[:space:]]/}
        echo "$stored_pid"
        return 0
    fi
    echo ""
    return 1
}

# Helper function to check if a process is currently running
is_process_alive() {
    local pid="$1"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Validate all required common.sh functions exist
validate_common_functions() {
    local required_funcs=("log_info" "log_warn" "log_error" "is_node_running" "get_node_pid" "ping_erlang_node")
    local missing_funcs=()
    for func in "${required_funcs[@]}"; do
        if ! declare -F "$func" >/dev/null; then
            missing_funcs+=("$func")
        fi
    done
    if [ ${#missing_funcs[@]} -gt 0 ]; then
        echo "ERROR: Missing required functions from common.sh: ${missing_funcs[*]}"
        exit 1
    fi
}

# Run common.sh validation before main logic
validate_common_functions

# New function to output JSON status for machine consumption when --json flag is passed
output_json_status() {
    local is_running="$1"
    local pid="${2:-}"
    local erlang_responsive="${3:-false}"
    local json_output

    if [ "$is_running" = "true" ]; then
        json_output=$(jq -n \
            --arg service "helpy_plan" \
            --argjson running true \
            --arg pid "$pid" \
            --argjson erlang_responsive "$erlang_responsive" \
            --argjson warnings "$(printf '%s\n' "${WARNINGS[@]}" | jq -R . | jq -s 'map(select(length>0))')" \
            --argjson errors "$(printf '%s\n' "${ERRORS[@]}" | jq -R . | jq -s 'map(select(length>0))')" \
            '{service: $service, running: $running, pid: $pid, erlang_responsive: $erlang_responsive, warnings: $warnings, errors: $errors}')
    else
        json_output=$(jq -n \
            --arg service "helpy_plan" \
            --argjson running false \
            --argjson warnings "$(printf '%s\n' "${WARNINGS[@]}" | jq -R . | jq -s 'map(select(length>0))')" \
            --argjson errors "$(printf '%s\n' "${ERRORS[@]}" | jq -R . | jq -s 'map(select(length>0))')" \
            '{service: $service, running: $running, warnings: $warnings, errors: $errors}')
    fi
    echo "$json_output"
}

# Parse command line arguments
JSON_OUTPUT=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Check status of Helpy Plan Erlang service"
            echo "Options:"
            echo "  --json    Output status in JSON format for machine consumption"
            echo "  --help    Show this help message"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option $1"
            exit 1
            ;;
    esac
done

# Only print human-readable header if not in JSON mode
if [ "$JSON_OUTPUT" = "false" ]; then
    echo "=== Helpy Plan Service Status ==="
    echo ""
fi

# Initialize PID variable to prevent unbound variable errors
PID=""
ERLANG_RESPONSIVE=false
RUNNING=false
# Check if service is running with additional validation
if is_node_running; then
    RUNNING=true
    log_info "Service is RUNNING"
    
    # Get and validate PID
    PID=$(get_node_pid)
    if is_process_alive "$PID"; then
        log_info "Process ID: $PID"
    else
        log_warn "Failed to retrieve valid process ID"
        PID=""
    fi
    
    # Check PID file and verify consistency
    STORED_PID=$(read_pid_from_file "$PID_FILE")
    if [ -n "$STORED_PID" ]; then
        log_info "PID file found: $PID_FILE"
        if [ "$STORED_PID" = "$PID" ]; then
            log_info "PID file matches running process ID"
        else
            log_warn "PID file inconsistency: stored ($STORED_PID) != running ($PID)"
        fi
    else
        log_warn "PID file not found or unreadable at expected location: $PID_FILE"
    fi
    
    # Check log file and display recent entries
    if [ -f "$LOG_FILE" ]; then
        log_info "Log file found: $LOG_FILE"
        LOG_SIZE=$(du -h "$LOG_FILE" | cut -f1)
        log_info "Current log size: $LOG_SIZE"
        if [ "$JSON_OUTPUT" = "false" ]; then
            echo -e "\nLast $MAIN_LOG_LINES log entries:"
            if tail -n "$MAIN_LOG_LINES" "$LOG_FILE" | sed 's/^/  /'; then
                :
            else
                log_warn "Failed to read log file"
            fi
            echo ""
        fi
    else
        log_warn "Log file not found at expected location: $LOG_FILE"
    fi
    
    # Add Erlang-specific node health check
    if check_erlang_node; then
        log_info "Erlang node is responsive (pong received)"
        ERLANG_RESPONSIVE=true
    else
        log_warn "Erlang node is unresponsive (ping failed)"
    fi
    
    # Optional: Add resource usage check with expanded metrics
    if command -v ps >/dev/null 2>&1 && [ -n "$PID" ]; then
        if ps_output=$(ps -p "$PID" -o %cpu,%mem,etime,rss 2>/dev/null | tail -n1); then
            if grep -q "[0-9]" <<<"$ps_output"; then
                log_info "Process resource usage:"
                ps -p "$PID" -o %cpu=,%mem=,etime=,rss= | awk '{printf "  CPU: %s%% | Memory: %s%% | Uptime: %s | RSS: %dMB\n", $1, $2, $3, $4/1024}'
            fi
        fi
    fi
    
    # Check for open ports (Erlang distribution typically uses 4369 or dynamic ports)
    if command -v lsof >/dev/null 2>&1 && [ -n "$PID" ]; then
        if lsof_output=$(lsof -Pn -p "$PID" 2>/dev/null); then
            PORT_COUNT=$(grep -c "LISTEN" <<<"$lsof_output" || true)
            log_info "Number of open listening ports: $PORT_COUNT"
            # Display actual listening ports for better debugging
            if [ "$PORT_COUNT" -gt 0 ] && [ "$JSON_OUTPUT" = "false" ]; then
                echo "  Active listening ports:"
                grep "LISTEN" <<<"$lsof_output" | awk '{print "  "$9}' | sed 's/.*://'
            fi
        fi
    fi
    
    if [ "$JSON_OUTPUT" = "true" ]; then
        if command -v jq >/dev/null 2>&1; then
            output_json_status "$RUNNING" "$PID" "$ERLANG_RESPONSIVE"
        else
            echo "ERROR: jq is required for JSON output"
            exit 1
        fi
    fi
    exit 0
else
    log_warn "Service is NOT running"
    
    # Clean up stale PID file if it exists
    if [ -f "$PID_FILE" ]; then
        STORED_PID=$(read_pid_from_file "$PID_FILE")
        if [ -n "$STORED_PID" ] && ! is_process_alive "$STORED_PID"; then
            log_warn "Found stale PID file at $PID_FILE (PID $STORED_PID no longer exists) - cleaning up"
            if rm -f "$PID_FILE"; then
                log_info "Successfully removed stale PID file"
            else
                log_error "Failed to remove stale PID file"
            fi
        fi
    fi
    
    # Locate all archived log files reliably with find instead of glob
    mapfile -t log_files < <(find "$LOG_DIR" -maxdepth 1 -type f -name 'helpy_plan*.log.*' -printf "%T@ %p\n" 2>/dev/null | sort -nr | cut -d' ' -f2-)
    if [ ${#log_files[@]} -gt 0 ] && [ "$JSON_OUTPUT" = "false" ]; then
        # Get most recent log file from sorted list
        LATEST_CRASH=${log_files[0]}
        log_info "Found most recent archived log file: $LATEST_CRASH"
        if [ -f "$LATEST_CRASH" ]; then
            if LAST_LINES=$(tail -n "$ARCHIVED_LOG_LINES" "$LATEST_CRASH" 2>/dev/null); then
                if [ -n "$LAST_LINES" ]; then
                    echo -e "\nLast $ARCHIVED_LOG_LINES lines from most recent archived log (potential shutdown context):"
                    sed 's/^/  /' <<<"$LAST_LINES"
                fi
            fi
        fi
    fi
    
    # Check for core dumps in common locations with improved detection
    while IFS= read -r core_file; do
        if [ -f "$core_file" ]; then
            # Get core file creation time and size for additional context
            core_time=$(date -r "$core_file" "+%Y-%m-%d %H:%M:%S")
            core_size=$(du -h "$core_file" | cut -f1)
            log_warn "Found core dump: $core_file (created: $core_time, size: $core_size)"
        fi
    done < <(find /core /var/lib/apport/core "$SCRIPT_DIR" -name 'core*' -type f -mtime -7 2>/dev/null)
    
    # Add system resource check to explain potential service failure reasons
    if command -v free >/dev/null 2>&1; then
        if mem_available=$(free | awk '/Mem:/ {print $7}'); then
            mem_available_gb=$(awk -v mem="$mem_available" 'BEGIN {printf "%.2f", mem/1024/1024}')
            if (( $(awk -v mem="$mem_available_gb" 'BEGIN {print (mem < 1)}') )); then
                log_warn "Low system memory detected: only ${mem_available_gb}GB available, which may cause service failures"
            fi
        fi
    fi
    
    # Check system load average to identify resource constraints
    load_avg=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}') || load_avg=$(uptime | awk -F'load average:' '{print $2}' | xargs)
    if [ -n "$load_avg" ]; then
        log_info "System load averages: $load_avg"
    fi
    
    # Check disk usage on log and PID directories to prevent future failures
    for dir in "$LOG_DIR" "$PID_DIR"; do
        if [ -d "$dir" ]; then
            disk_usage=$(df -h "$dir" | tail -n1 | awk '{print $5}')
            disk_usage_pct=${disk_usage//%/}
            if [ "$disk_usage_pct" -gt 90 ]; then
                log_warn "Low disk space on $dir: $disk_usage used, which may cause service failures"
            fi
        fi
    done
    
    if [ "$JSON_OUTPUT" = "true" ]; then
        if command -v jq >/dev/null 2>&1; then
            output_json_status "$RUNNING"
        else
            echo "ERROR: jq is required for JSON output"
            exit 1
        fi
    fi
    exit 1
fi
