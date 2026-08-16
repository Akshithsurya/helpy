#!/bin/bash
set -euo pipefail

# Health check script for Helpy Plan Erlang service

# Configuration Constants (centralized for easy maintenance)
# Allow environment variable overrides for runtime configuration
readonly METRICS_TIMEOUT=${METRICS_TIMEOUT:-5}
readonly ERROR_WINDOW_LINES=${ERROR_WINDOW_LINES:-100}
readonly ERROR_CRITICAL_THRESHOLD=${ERROR_CRITICAL_THRESHOLD:-10}
readonly REQUIRED_FUNCS=("log_info" "log_error" "log_warn" "is_node_running")
readonly SCRIPT_NAME=$(basename "$0")
readonly REQUIRED_TOOLS=("curl" "tail" "grep" "jq")
readonly METRICS_ENDPOINT=${METRICS_ENDPOINT:-"/metrics"}
readonly LOG_FILE_PATH=${LOG_FILE_PATH:-"helpy_plan.log"}
readonly JSON_OUTPUT=${JSON_OUTPUT:-"${GENERATE_JSON:-false}"}

# Resolve script directory and load common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
COMMON_FILE="$SCRIPT_DIR/common.sh"

# Global health state tracker - encapsulated to avoid global state pollution
declare -Ag HEALTH_STATE=(
    ["healthy"]="true"
    ["pass"]="0"
    ["warn"]="0"
    ["error"]="0"
)

# Add structured error codes for monitoring integration
declare -Ar ERROR_CODES=(
    ["MISSING_TOOL"]=1
    ["MISSING_COMMON"]=2
    ["MISSING_FUNCTION"]=3
    ["INVALID_CONFIG"]=4
    ["SERVICE_UNHEALTHY"]=5
)

# Show usage instructions for the script
show_usage() {
    cat <<EOF
Usage: $SCRIPT_NAME [OPTIONS]

Health check script for Helpy Plan Erlang service.

Options:
    -h, --help          Show this help message and exit
    -j, --json          Output machine-readable JSON report
    -v, --verbose       Enable verbose logging
    -q, --quiet         Suppress all non-essential output
    --metrics-timeout N Override metrics endpoint timeout (default: $METRICS_TIMEOUT)
    --error-window N    Override log analysis line window (default: $ERROR_WINDOW_LINES)
    --error-threshold N Override critical error threshold (default: $ERROR_CRITICAL_THRESHOLD)
EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                exit 0
                ;;
            -j|--json)
                JSON_OUTPUT="true"
                shift
                ;;
            -v|--verbose)
                export LOG_LEVEL="debug"
                shift
                ;;
            -q|--quiet)
                export LOG_LEVEL="error"
                shift
                ;;
            --metrics-timeout)
                METRICS_TIMEOUT="$2"
                shift 2
                ;;
            --error-window)
                ERROR_WINDOW_LINES="$2"
                shift 2
                ;;
            --error-threshold)
                ERROR_CRITICAL_THRESHOLD="$2"
                shift 2
                ;;
            *)
                echo "ERROR: Unknown argument: $1" >&2
                show_usage >&2
                exit "${ERROR_CODES["MISSING_TOOL"]}"
                ;;
        esac
    done
}

# Validate core system utilities are available before proceeding
check_required_tools() {
    local missing=0
    for tool in "${REQUIRED_TOOLS[@]}"; do
        if ! command -v "$tool" &>/dev/null; then
            echo "ERROR: Required system utility '$tool' not found in PATH" >&2
            missing=1
        fi
    done
    if [[ "$missing" -eq 1 ]]; then
        exit "${ERROR_CODES["MISSING_TOOL"]}"
    fi
}

# Load common utilities with enhanced error handling
load_common_library() {
    if [[ ! -f "$COMMON_FILE" ]]; then
        echo "ERROR: Missing required common.sh at $COMMON_FILE" >&2
        exit "${ERROR_CODES["MISSING_COMMON"]}"
    fi
    # shellcheck source=common.sh
    # Disable unbound variable check temporarily for common.sh to handle its own variables
    set +u
    # shellcheck disable=SC1090
    source "$COMMON_FILE"
    set -u

    # Verify required common functions exist
    for func in "${REQUIRED_FUNCS[@]}"; do
        if ! declare -F "$func" &>/dev/null; then
            echo "ERROR: common.sh missing required function: $func" >&2
            exit "${ERROR_CODES["MISSING_FUNCTION"]}"
        fi
    done

    # Verify required configuration variables are set
    if [[ -z "${LOG_DIR:-}" ]]; then
        echo "ERROR: LOG_DIR variable not defined in common.sh" >&2
        exit "${ERROR_CODES["INVALID_CONFIG"]}"
    fi

    # Verify config getter function exists (fixed typo in original error message)
    if ! declare -F "helpy_plan_config:get" &>/dev/null; then
        echo "ERROR: helpy_plan_config:get function not available" >&2
        exit "${ERROR_CODES["INVALID_CONFIG"]}"
    fi
}

# Generate structured JSON output for monitoring systems integration
# Escape JSON special characters in string values to prevent invalid output
json_escape() {
    local s="$1"
    jq -R . <<<"$s"
}

generate_json_report() {
    local status="healthy"
    if [[ "${HEALTH_STATE["healthy"]}" != "true" ]]; then
        status="unhealthy"
    fi
    # Use jq to construct valid JSON automatically, eliminating escape bugs
    jq -n \
        --arg script "$SCRIPT_NAME" \
        --arg status "$status" \
        --argjson timestamp "$(date +%s)" \
        --argjson passed "${HEALTH_STATE["pass"]}" \
        --argjson warnings "${HEALTH_STATE["warn"]}" \
        --argjson errors "${HEALTH_STATE["error"]}" \
        '{
            script: $script,
            timestamp: $timestamp,
            status: $status,
            checks: {
                passed: $passed,
                warnings: $warnings,
                errors: $errors
            }
        }'
}

# Helper function to safely update health state and counters
record_check_result() {
    local check_name="$1"
    local status="$2"
    local message="$3"
    
    case "$status" in
        pass)
            log_info "$check_name: $message"
            ((HEALTH_STATE["pass"]++))
            ;;
        warn)
            log_warn "$check_name: $message"
            ((HEALTH_STATE["warn"]++))
            ;;
        error)
            log_error "$check_name: $message"
            HEALTH_STATE["healthy"]="false"
            ((HEALTH_STATE["error"]++))
            ;;
    esac
}

# Add new check to the list of health checks
add_health_check() {
    CHECKS+=("$1")
}

# Run all registered health checks
run_health_checks() {
    local total_checks=${#CHECKS[@]}
    local current_check=0
    for check in "${CHECKS[@]}"; do
        ((current_check++))
        $check "$current_check" "$total_checks"
    done
}

# Check 1: Erlang node runtime status
check_node_status() {
    local current_check="$1"
    local total_checks="$2"
    if is_node_running; then
        record_check_result "[$current_check/$total_checks] Node status" "pass" "Node is running"
    else
        record_check_result "[$current_check/$total_checks] Node status" "error" "Node is NOT running"
    fi
}

# Check 2: Log file accessibility and permissions
check_log_file() {
    local current_check="$1"
    local total_checks="$2"
    if [[ -f "$LOG_FILE" ]]; then
        if [[ -r "$LOG_FILE" && -w "$LOG_FILE" ]]; then
            record_check_result "[$current_check/$total_checks] Log file check" "pass" "Log file exists and is readable/writable"
        else
            # Add specific permission errors for better debugging
            local permission_issues=()
            [[ ! -r "$LOG_FILE" ]] && permission_issues+=("not readable")
            [[ ! -w "$LOG_FILE" ]] && permission_issues+=("not writable")
            record_check_result "[$current_check/$total_checks] Log file check" "warn" "Log file exists but is $(IFS=,; echo "${permission_issues[*]}")"
        fi
    else
        record_check_result "[$current_check/$total_checks] Log file check" "warn" "Log file does not exist at $LOG_FILE"
    fi
}

# Check 3: HTTP metrics endpoint health
check_http_server() {
    local current_check="$1"
    local total_checks="$2"
    local http_port
    http_port=$(helpy_plan_config:get http_port 8080)
    if command -v curl &>/dev/null; then
        # Capture curl output and exit code separately for better error reporting
        local http_status
        http_status=$(curl -s -m "$METRICS_TIMEOUT" -o /dev/null -w "%{http_code}" "http://localhost:$http_port$METRICS_ENDPOINT" 2>/dev/null || echo "000")
        if [[ "$http_status" =~ ^(200|500)$ ]]; then
            record_check_result "[$current_check/$total_checks] HTTP server check" "pass" "HTTP server is responding on port $http_port (status: $http_status)"
        else
            record_check_result "[$current_check/$total_checks] HTTP server check" "error" "HTTP server is not responding on port $http_port (status: $http_status)"
        fi
    else
        record_check_result "[$current_check/$total_checks] HTTP server check" "warn" "curl not available, skipping HTTP check"
    fi
}

# Check 4: Recent error log analysis (case-insensitive error matching, exclude known benign errors)
check_log_errors() {
    local current_check="$1"
    local total_checks="$2"
    if [[ -f "$LOG_FILE" && -r "$LOG_FILE" ]]; then
        # Exclude common benign error patterns to reduce false positives: debug connection resets, health check timeouts
        local recent_errors
        recent_errors=$(tail -n "$ERROR_WINDOW_LINES" "$LOG_FILE" | grep -v -i "debug\|connection reset by peer\|health check timeout" | grep -c -i "error" || true)
        if [[ "$recent_errors" -eq 0 ]]; then
            record_check_result "[$current_check/$total_checks] Log error analysis" "pass" "No errors found in last $ERROR_WINDOW_LINES log lines"
        elif [[ "$recent_errors" -lt "$ERROR_CRITICAL_THRESHOLD" ]]; then
            record_check_result "[$current_check/$total_checks] Log error analysis" "warn" "Found $recent_errors error(s) in last $ERROR_WINDOW_LINES log lines"
        else
            record_check_result "[$current_check/$total_checks] Log error analysis" "error" "Critical: Found $recent_errors errors in last $ERROR_WINDOW_LINES log lines"
        fi
    else
        record_check_result "[$current_check/$total_checks] Log error analysis" "warn" "Skipping log error check - log file missing or unreadable"
    fi
}

# Main execution flow with argument parsing
main() {
    parse_arguments "$@"

    # Start health check report
    if [[ "${LOG_LEVEL:-info}" != "error" ]]; then
        echo "=== Helpy Plan Service Health Check ==="
        echo "Run time: $(date -Iseconds)"
        echo ""
    fi

    # Pre-flight validation
    check_required_tools
    load_common_library

    # Initialize derived paths
    LOG_FILE="$LOG_DIR/$LOG_FILE_PATH"

    # Register all health checks
    CHECKS=()
    add_health_check check_node_status
    add_health_check check_log_file
    add_health_check check_http_server
    add_health_check check_log_errors

    # Run all health checks
    run_health_checks

    # Final health status report
    if [[ "${LOG_LEVEL:-info}" != "error" ]]; then
        echo ""
        echo "--- Summary ---"
        echo "Passed checks: ${HEALTH_STATE["pass"]}"
        echo "Warnings: ${HEALTH_STATE["warn"]}"
        echo "Critical errors: ${HEALTH_STATE["error"]}"
        echo ""
    fi

    # Output JSON report for monitoring systems
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        [[ "${LOG_LEVEL:-info}" != "error" ]] && echo "--- Machine-readable report ---"
        generate_json_report
        [[ "${LOG_LEVEL:-info}" != "error" ]] && echo ""
    fi

    if [[ "${HEALTH_STATE["healthy"]}" == "true" ]]; then
        log_info "Service is HEALTHY"
        exit 0
    else
        log_error "Service is UNHEALTHY"
        exit "${ERROR_CODES["SERVICE_UNHEALTHY"]}"
    fi
}

# Start main execution only if script is run directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
