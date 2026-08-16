#!/bin/bash
set -euo pipefail

# Restart the Helpy Plan Erlang service

# Resolve script directory with robust error handling
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
if [[ ! -d "$SCRIPT_DIR" ]]; then
    echo "Critical error: Failed to resolve script directory" >&2
    exit 1
fi

# Load common functions if available, otherwise define basic logging
COMMON_SH="${SCRIPT_DIR}/common.sh"
if [[ -f "${COMMON_SH}" ]]; then
    # shellcheck source=common.sh
    source "${COMMON_SH}"
else
    # Fallback logging functions if common.sh is missing
    log_info() { echo "[INFO] $*" >&1; }
    log_warning() { echo "[WARNING] $*" >&2; }
    log_error() { echo "[ERROR] $*" >&2; }
fi

# Configuration - centralized for easy maintenance
SERVICE_NAME="helpy_plan"
BEAM_PROCESS_PATTERN="beam.smp.*${SERVICE_NAME}"
STOP_SCRIPT="${SCRIPT_DIR}/stop.sh"
START_SCRIPT="${SCRIPT_DIR}/start.sh"
SHUTDOWN_WAIT=5
STARTUP_VERIFICATION_DELAY=2
FORCE_KILL_WAIT=10
LOCK_FILE="/var/run/${SERVICE_NAME}_restart.lock"
STARTUP_RETRIES=3

# Validate helper scripts exist and are executable before proceeding
validate_helper_scripts() {
    local missing=0
    for script in "${STOP_SCRIPT}" "${START_SCRIPT}"; do
        if [[ ! -x "${script}" ]]; then
            log_error "Required script missing or not executable: ${script}"
            missing=1
        fi
    done
    if [[ "${missing}" -eq 1 ]]; then
        log_error "Prerequisite checks failed, cannot proceed with restart"
        exit 1
    fi
}

# Prevent concurrent restart execution with lock file
acquire_lock() {
    # Create lock file directory if it doesn't exist
    mkdir -p "$(dirname "${LOCK_FILE}")"
    exec 200>"${LOCK_FILE}"
    if ! flock -n 200; then
        log_error "Another restart process is already running. Lock file held at ${LOCK_FILE}"
        exit 1
    fi
    # Write current PID to lock file for better debugging
    echo $$ > "${LOCK_FILE}"
}

# Robust process detection to avoid false positives with full ps output filtering
get_service_pids() {
    local pids
    # Use ps to get full command line to avoid pgrep partial matching issues
    pids=$(ps aux | grep -E "${BEAM_PROCESS_PATTERN}" | grep -v grep | awk '{print $2}' | tr '\n' ' ' | xargs)
    echo "${pids}"
}

# Improved stale process handling with force kill option
cleanup_stale_processes() {
    local pids
    pids=$(get_service_pids)
    if [[ -z "${pids}" ]]; then
        return 0
    fi

    log_warning "Detected stale ${SERVICE_NAME} processes (PIDs: ${pids}), attempting graceful termination..."
    
    # Send SIGTERM first for graceful cleanup
    kill -TERM ${pids} 2>/dev/null || true
    
    # Wait for processes to exit
    local waited=0
    while [[ ${waited} -lt ${FORCE_KILL_WAIT} ]]; do
        pids=$(get_service_pids)
        [[ -z "${pids}" ]] && break
        sleep 1
        waited=$((waited + 1))
    done

    # Force kill if still running
    pids=$(get_service_pids)
    if [[ -n "${pids}" ]]; then
        log_warning "Force killing remaining stale processes (PIDs: ${pids}) with SIGKILL..."
        kill -KILL ${pids} 2>/dev/null || true
        sleep 2
    fi

    # Final verification
    pids=$(get_service_pids)
    if [[ -n "${pids}" ]]; then
        log_error "Failed to terminate all stale processes (PIDs: ${pids}), cannot start new instance"
        exit 1
    fi
    log_info "Successfully cleaned up all stale processes"
}

# Gracefully handle shutdown with process verification
execute_service_stop() {
    log_info "Executing service stop sequence..."
    local existing_pids
    existing_pids=$(get_service_pids)
    if [[ -n "${existing_pids}" ]]; then
        if ! "${STOP_SCRIPT}"; then
            log_warning "Stop script encountered non-fatal errors, proceeding with shutdown verification"
        fi

        # Wait for clean shutdown with timeout
        log_info "Waiting ${SHUTDOWN_WAIT} seconds for service to shut down completely..."
        sleep "${SHUTDOWN_WAIT}"
    else
        log_info "No running ${SERVICE_NAME} processes detected, skipping stop sequence"
    fi

    # Clean up any remaining processes
    cleanup_stale_processes
}

# Execute service start with success verification
execute_service_start() {
    log_info "Starting ${SERVICE_NAME} service..."
    if ! "${START_SCRIPT}"; then
        log_error "Failed to start ${SERVICE_NAME} service - restart aborted"
        exit 1
    fi

    # Verify service started successfully with extended checks
    local started=0
    for ((i=0; i<STARTUP_RETRIES; i++)); do
        sleep "${STARTUP_VERIFICATION_DELAY}"
        local pids
        pids=$(get_service_pids)
        if [[ -n "${pids}" ]]; then
            started=1
            log_info "Service started successfully, new process ID(s): ${pids}"
            break
        fi
        log_warning "Service not yet running, retry $((i+1))/${STARTUP_RETRIES}..."
    done

    if [[ "${started}" -ne 1 ]]; then
        log_error "Service start reported success, but no running process detected after ${STARTUP_RETRIES} retries - restart failed"
        exit 1
    fi
}

# Add signal handling for script interruption with proper cleanup
cleanup_on_interrupt() {
    local exit_code=$?
    # Clean up lock file regardless of exit reason
    if [[ -f "${LOCK_FILE}" ]]; then
        rm -f "${LOCK_FILE}"
        log_info "Lock file removed during cleanup"
    fi
    if [[ ${exit_code} -ne 0 ]]; then
        log_warning "Restart process did not complete successfully (exit code: ${exit_code})"
    fi
    exit ${exit_code}
}
trap cleanup_on_interrupt SIGINT SIGTERM EXIT

# Main workflow orchestration
main() {
    # Add command line argument parsing for force/quiet options
    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--force)
                FORCE_RESTART=1
                shift
                ;;
            -q|--quiet)
                # Suppress non-error log messages
                log_info() { :; }
                shift
                ;;
            -h|--help)
                echo "Usage: $0 [-f|--force] [-q|--quiet] [-h|--help]"
                echo "  -f, --force    Force restart even if no running process is detected"
                echo "  -q, --quiet    Suppress non-error log messages"
                echo "  -h, --help     Show this help message"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    log_info "Initiating ${SERVICE_NAME} service restart..."
    acquire_lock
    validate_helper_scripts
    execute_service_stop
    execute_service_start
    log_info "${SERVICE_NAME} service restart completed successfully"
    exit 0
}

# Execute main function
main "$@"
