#!/bin/bash
set -euo pipefail

# Log rotation script for Helpy Plan Erlang service

# Resolve absolute path of the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

# Configuration with environment variable overrides for flexibility
LOG_FILE="${LOG_DIR}/helpy_plan.log"
DEFAULT_MAX_LOG_SIZE=$((50 * 1024 * 1024))  # 50MB default
DEFAULT_MAX_LOG_FILES=10                     # 10 rotated logs default
DEFAULT_COMPRESS_OLD_LOGS=true               # Enable compression by default
DEFAULT_COMPRESS_LEVEL=6                     # Balanced compression level
MAX_LOG_SIZE="${MAX_LOG_SIZE:-$DEFAULT_MAX_LOG_SIZE}"
MAX_LOG_FILES="${MAX_LOG_FILES:-$DEFAULT_MAX_LOG_FILES}"
COMPRESS_OLD_LOGS="${COMPRESS_OLD_LOGS:-$DEFAULT_COMPRESS_OLD_LOGS}"
COMPRESS_LEVEL="${COMPRESS_LEVEL:-$DEFAULT_COMPRESS_LEVEL}"

# Cleanup function to automatically release resources on exit
cleanup() {
    # Release lock and remove file if it exists
    if [ -n "${LOCK_FD:-}" ] && [ -n "${LOCK_FILE:-}" ]; then
        flock -u "$LOCK_FD" 2>/dev/null || true
        rm -f "$LOCK_FILE" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# Helper function to convert bytes to human-readable format with binary units
human_readable() {
    local bytes=$1
    if (( bytes < 1024 )); then
        echo "${bytes}B"
    elif (( bytes < 1048576 )); then
        echo "$((bytes/1024))KB"
    elif (( bytes < 1073741824 )); then
        echo "$((bytes/1048576))MB"
    else
        echo "$((bytes/1073741824))GB"
    fi
}

# Validate required core variables and input parameters
if [ -z "${LOG_DIR:-}" ]; then
    log_error "LOG_DIR is not set. Check common.sh configuration or set it as an environment variable."
    exit 1
fi
if ! [[ "$MAX_LOG_SIZE" =~ ^[0-9]+$ ]] || [ "$MAX_LOG_SIZE" -lt 1024 ]; then
    log_error "Invalid MAX_LOG_SIZE: must be a positive integer larger than 1KB"
    exit 1
fi
if ! [[ "$MAX_LOG_FILES" =~ ^[0-9]+$ ]] || [ "$MAX_LOG_FILES" -lt 2 ]; then
    log_error "Invalid MAX_LOG_FILES: must be an integer of at least 2 to maintain rotation history"
    exit 1
fi
if ! [[ "$COMPRESS_LEVEL" =~ ^[1-9]$ ]]; then
    log_error "Invalid COMPRESS_LEVEL: must be an integer between 1 and 9"
    exit 1
fi

# Validate log file path is writable before proceeding
LOG_DIR_NAME=$(dirname "$LOG_FILE")
if [ ! -d "$LOG_DIR_NAME" ]; then
    log_error "Log directory $LOG_DIR_NAME does not exist"
    exit 1
fi
if [ ! -w "$LOG_DIR_NAME" ]; then
    log_error "Log directory $LOG_DIR_NAME is not writable"
    exit 1
fi

log_info "Starting log rotation for Helpy Plan service..."

# Check if log file exists and has correct permissions
if [ ! -f "$LOG_FILE" ]; then
    log_info "Log file $LOG_FILE does not exist, nothing to rotate"
    exit 0
fi
if [ ! -r "$LOG_FILE" ]; then
    log_error "Log file $LOG_FILE is not readable"
    exit 1
fi
if [ ! -w "$LOG_FILE" ]; then
    log_warn "Log file $LOG_FILE is not writable, but attempting rotation anyway"
fi

# Cross-platform function to get numeric stat values (works on Linux and macOS)
get_stat_value() {
    local file="$1"
    local format_linux="$2"
    local format_macos="$3"
    stat -c"$format_linux" "$file" 2>/dev/null || stat -f"$format_macos" "$file" 2>/dev/null
}

# Retrieve and validate log file size
LOG_SIZE=$(get_stat_value "$LOG_FILE" "%s" "%z")
if [ -z "$LOG_SIZE" ] || ! [[ "$LOG_SIZE" =~ ^[0-9]+$ ]]; then
    log_error "Failed to retrieve valid log file size for $LOG_FILE"
    exit 1
fi

# Check if rotation threshold is met
if [ "$LOG_SIZE" -lt "$MAX_LOG_SIZE" ]; then
    log_info "Log size ($(human_readable "$LOG_SIZE")) is below rotation threshold ($(human_readable "$MAX_LOG_SIZE")). No rotation needed."
    exit 0
fi

log_info "Initiating log rotation (current log size: $(human_readable "$LOG_SIZE"), max allowed: $(human_readable "$MAX_LOG_SIZE"))"

# Lock file to prevent concurrent rotation runs (use process-specific lock in /run for modern systems)
LOCK_DIR="/run/helpy_plan"
mkdir -p "$LOCK_DIR"
LOCK_FILE="${LOCK_DIR}/log_rotation.lock"
LOCK_FD=200
if ! exec {LOCK_FD}>"$LOCK_FILE"; then
    log_error "Failed to create lock file $LOCK_FILE"
    exit 1
fi
if ! flock -n "$LOCK_FD"; then
    log_error "Another log rotation process is already running. Exiting to avoid conflicts."
    exit 1
fi

# Write current PID to lock file for debugging
echo $$ > "$LOCK_FILE"

# Rotate existing log files with proper error handling
rotation_failed=0
# Avoid seq subshell by using C-style for loop (bash-specific, compatible with all modern bash versions)
for ((i = MAX_LOG_FILES - 1; i >= 1; i--)); do
    # Handle both uncompressed (.i) and compressed (.i.gz) logs
    for ext in "" ".gz"; do
        old_log="${LOG_FILE}.${i}${ext}"
        if [ -f "$old_log" ]; then
            if [ "$i" -eq $((MAX_LOG_FILES - 1)) ]; then
                # Remove oldest log when max file count is reached
                log_info "Removing oldest rotated log: $old_log"
                if ! rm -f "$old_log"; then
                    log_error "Failed to remove oldest log $old_log"
                    rotation_failed=1
                fi
            else
                # Shift older logs forward by one sequence number
                new_log="${LOG_FILE}.$((i + 1))${ext}"
                log_info "Rotating $old_log to $new_log"
                if ! mv -f "$old_log" "$new_log"; then
                    log_error "Failed to rotate $old_log to $new_log"
                    rotation_failed=1
                fi
            fi
        fi
    done
done

# Exit early if rotation of old logs failed to prevent data loss
if [ "$rotation_failed" -ne 0 ]; then
    log_error "Aborting rotation due to previous errors. Log file remains unchanged."
    exit 1
fi

# Move current active log to first rotated position
current_log_backup="${LOG_FILE}.1"
log_info "Moving active log to $current_log_backup"
if ! mv -f "$LOG_FILE" "$current_log_backup"; then
    log_error "Failed to move active log to $current_log_backup. Rotation aborted."
    exit 1
fi

# Create new empty log file preserving original ownership and permissions
original_mode=$(get_stat_value "$current_log_backup" "%a" "%a")
original_uid=$(get_stat_value "$current_log_backup" "%u" "%u")
original_gid=$(get_stat_value "$current_log_backup" "%g" "%g")

if [ -n "$original_mode" ] && [ -n "$original_uid" ] && [ -n "$original_gid" ]; then
    if ! touch "$LOG_FILE"; then
        log_error "Failed to create new log file $LOG_FILE"
        exit 1
    fi
    if ! chmod "$original_mode" "$LOG_FILE"; then
        log_warn "Failed to set permissions on new log file $LOG_FILE"
    fi
    if ! chown "$original_uid:$original_gid" "$LOG_FILE"; then
        log_warn "Failed to set ownership on new log file $LOG_FILE (requires root privileges?)"
    fi
    log_info "Created new log file $LOG_FILE with permissions 0$original_mode and UID:GID $original_uid:$original_gid"
else
    if ! touch "$LOG_FILE"; then
        log_error "Failed to create new log file $LOG_FILE"
        exit 1
    fi
    log_warn "Could not retrieve original log metadata, created $LOG_FILE with default umask and ownership"
fi

# Send SIGHUP to Erlang service to reopen log files if PID file is configured
if [ -n "${PID_DIR:-}" ]; then
    SERVICE_PID_FILE="${PID_DIR}/helpy_plan.pid"
    if [ -f "$SERVICE_PID_FILE" ]; then
        # Safely read PID from file, trim all whitespace
        SERVICE_PID=$(<"$SERVICE_PID_FILE" tr -d '[:space:]')
        if [[ "$SERVICE_PID" =~ ^[0-9]+$ ]]; then
            # Cross-platform process verification: use ps if /proc is unavailable (macOS)
            local is_helpy_process=false
            if [ -d "/proc" ]; then
                # Linux-specific process check
                if proc_path=$(readlink -f "/proc/$SERVICE_PID/exe" 2>/dev/null) && [[ "$proc_path" == *helpy_plan* ]]; then
                    is_helpy_process=true
                fi
            else
                # macOS/BSD compatible process check
                if proc_name=$(ps -p "$SERVICE_PID" -o comm= 2>/dev/null) && [[ "$proc_name" == *helpy_plan* ]]; then
                    is_helpy_process=true
                fi
            fi

            if $is_helpy_process; then
                if kill -HUP "$SERVICE_PID" 2>/dev/null; then
                    log_info "Successfully sent SIGHUP to service process $SERVICE_PID to reopen log files"
                else
                    log_warn "Failed to send SIGHUP to service process $SERVICE_PID. Service may not log to new file correctly."
                fi
            else
                log_warn "Service process $SERVICE_PID from PID file $SERVICE_PID_FILE does not exist or is not a Helpy Plan process. Could not reopen logs."
            fi
        else
            log_error "Invalid PID in service PID file $SERVICE_PID_FILE: '$SERVICE_PID'"
            exit 1
        fi
    else
        log_warn "Service PID file $SERVICE_PID_FILE not found. Could not signal service to reopen logs."
    fi
else
    log_info "PID_DIR not set, skipping service log reopening signal"
fi

# Compress rotated logs to save disk space if enabled
if [ "$COMPRESS_OLD_LOGS" = true ] && [ -f "$current_log_backup" ]; then
    log_info "Compressing rotated log $current_log_backup with level $COMPRESS_LEVEL"
    if gzip -"$COMPRESS_LEVEL" -f "$current_log_backup" 2>/dev/null; then
        log_info "Successfully compressed $current_log_backup to ${current_log_backup}.gz"
    else
        log_warn "Failed to compress rotated log $current_log_backup"
    fi
fi

# Final log size verification to ensure rotation completed successfully
NEW_LOG_SIZE=$(get_stat_value "$LOG_FILE" "%s" "%z")
log_info "Log rotation completed successfully. New active log size: $(human_readable "$NEW_LOG_SIZE")"

