#!/bin/bash
set -euo pipefail

# Start the Helpy Plan Erlang service

# Resolve script directory and load common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# shellcheck source=common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

# Configuration Constants
readonly STARTUP_TIMEOUT=15
readonly WAIT_INTERVAL=1
readonly PID_FILE="${LOG_DIR}/helpy_plan.pid"
readonly LOG_FILE="${LOG_DIR}/helpy_plan.log"
readonly REQUIRED_VARS=("NODE_NAME" "COOKIE" "ERLANG_DIR" "LOG_DIR")
readonly MAX_LOG_SIZE=$((100 * 1024 * 1024)) # 100MB in bytes

# Cleanup function to remove stale resources on exit
cleanup_resources() {
    if [[ -f "${PID_FILE:-}" ]]; then
        log_info "Cleaning up process ID file"
        rm -f "${PID_FILE}"
    fi
}

# Global trap for unexpected exits
cleanup_on_exit() {
    local exit_code=$?
    if [[ ${exit_code} -ne 0 ]]; then
        log_error "Unexpected error detected, cleaning up stale resources"
        cleanup_resources
    fi
    exit "${exit_code}"
}
trap cleanup_on_exit EXIT INT TERM HUP

# Validate required environment variables from common.sh
for VAR in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!VAR:-}" ]]; then
        log_error "Required variable $VAR is not set in common.sh"
        exit 1
    fi
done

# Create log directory if it doesn't exist with proper permissions
mkdir -p -m 755 "${LOG_DIR}"

# Enter Erlang project directory
cd "${ERLANG_DIR}" || {
    log_error "Failed to enter Erlang directory: ${ERLANG_DIR}"
    exit 1
}

# Check if already running
if is_node_running; then
    log_warn "Node $NODE_NAME is already running"
    if [[ -f "${PID_FILE}" ]]; then
        CURRENT_PID=$(<"${PID_FILE}")
        log_info "Current running PID: ${CURRENT_PID}"
    fi
    exit 0
fi

log_info "Starting Helpy Plan service..."

# Check if rebar3 is available
if ! command -v rebar3 &>/dev/null; then
    log_error "rebar3 not found. Please install rebar3 first."
    exit 1
fi

# Compile if needed with verbose output capture
log_info "Compiling application..."
REBAR_OUTPUT=$(mktemp)
# Ensure temp file is cleaned up even if compilation fails
# shellcheck disable=SC2064
trap "rm -f '${REBAR_OUTPUT}'" EXIT
if ! rebar3 compile 2>&1 | tee "${REBAR_OUTPUT}"; then
    log_error "Failed to compile application. Build output:"
    while IFS= read -r line || [[ -n "$line" ]]; do log_error "  $line"; done < "${REBAR_OUTPUT}"
    exit 1
fi
rm -f "${REBAR_OUTPUT}"
# Remove the temp file trap since we've cleaned it up
trap - EXIT
# Reinstall the original exit trap
trap cleanup_on_exit EXIT INT TERM HUP

log_info "Starting Erlang node $NODE_NAME..."

# Validate no stale pidfile exists
if [[ -f "${PID_FILE}" ]]; then
    STALE_PID=$(<"${PID_FILE}")
    if [[ "${STALE_PID}" =~ ^[0-9]+$ ]] && kill -0 "${STALE_PID}" 2>/dev/null; then
        log_error "Found running process with stale PID: ${STALE_PID}. Manual intervention required."
        exit 1
    fi
    log_warn "Found stale pidfile, removing: ${PID_FILE}"
    rm -f "${PID_FILE}"
fi

# Ensure log file exists and set proper permissions
touch "${LOG_FILE}"
chmod 644 "${LOG_FILE}"

# Rotate log if it's too large (>100MB) to prevent disk bloat
if [[ -f "${LOG_FILE}" ]]; then
    # Get log size with cross-platform compatibility
    if LOG_SIZE=$(stat -c%s "${LOG_FILE}" 2>/dev/null) || LOG_SIZE=$(stat -f%z "${LOG_FILE}" 2>/dev/null); then
        if (( LOG_SIZE > MAX_LOG_SIZE )); then
            log_info "Rotating large log file (${LOG_SIZE} bytes)"
            # Create rotated log with timestamp to avoid overwrites
            mv -f "${LOG_FILE}" "${LOG_FILE}.$(date -u +"%Y%m%d%H%M%S").old"
            touch "${LOG_FILE}"
            chmod 644 "${LOG_FILE}"
            # Delete old logs older than 30 days to prevent disk bloat
            find "${LOG_DIR}" -name "helpy_plan.log.*.old" -mtime +30 -delete 2>/dev/null || log_warn "Failed to clean up old logs"
        fi
    else
        log_warn "Could not retrieve log file size, skipping rotation"
    fi
fi

# Write startup timestamp to log
echo -e "\n=== $(date -u +"%Y-%m-%dT%H:%M:%SZ") Starting Helpy Plan service ===" >> "${LOG_FILE}"

# Start daemon and capture logs
if ! rebar3 shell --name "${NODE_NAME}" --setcookie "${COOKIE}" --daemon --pidfile "${PID_FILE}" &>>"${LOG_FILE}"; then
    log_error "Failed to execute rebar3 start command"
    exit 1
fi

# Wait for service to start (with timeout check)
ELAPSED=0
while [[ ${ELAPSED} -lt ${STARTUP_TIMEOUT} ]]; do
    if is_node_running; then
        break
    fi
    sleep "${WAIT_INTERVAL}"
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))
    log_info "Waiting for service startup... (${ELAPSED}s/${STARTUP_TIMEOUT}s)"
done

# Verify service health and pidfile validity
if is_node_running && [[ -f "${PID_FILE}" ]]; then
    PID=$(<"${PID_FILE}")
    if [[ "${PID}" =~ ^[0-9]+$ ]] && kill -0 "${PID}" 2>/dev/null; then
        log_info "Service started successfully! PID: ${PID}"
        # Log successful startup to service log
        echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") Service started successfully with PID ${PID}" >> "${LOG_FILE}"
        # Remove failure trap since we succeeded - keep pidfile
        trap - EXIT INT TERM HUP
        exit 0
    else
        log_error "Invalid PID in pidfile after startup"
        cleanup_resources
        exit 1
    fi
else
    log_error "Failed to start service after ${STARTUP_TIMEOUT}s. Check logs at ${LOG_FILE}"
    # Collect and log last 20 lines of logs for immediate debugging
    log_error "Last 20 log entries:"
    tail -n 20 "${LOG_FILE}" | while IFS= read -r line || [[ -n "$line" ]]; do log_error "  $line"; done
    cleanup_resources
    exit 1
fi
