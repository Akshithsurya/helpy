#!/bin/bash
set -euo pipefail
# Deployment script for Helpy Plan Erlang service
# Resolve absolute path of script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# shellcheck source=common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

# Trap to clean up lock file and handle errors
cleanup() {
    local exit_code=$?
    rm -rf "$LOCK_FILE"
    if [[ $exit_code -ne 0 && $ROLLBACK_ON_FAILURE == true && $ROLLBACK_TRIGGERED == false ]]; then
        log_warn "Deployment failed, initiating rollback..."
        trigger_rollback
    fi
    exit $exit_code
}
trap cleanup EXIT INT TERM

##############################
# Configuration - Environment Overridable
##############################
# File system and locking
LOCK_FILE="${LOCK_FILE:-/tmp/helpy_plan_deployment.lock}"
LAST_COMMIT_FILE="${SCRIPT_DIR}/.last_deployed_commit"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/helpy_plan}"
LOG_FILE="${LOG_FILE:-/var/log/helpy_plan_deployment.log}"
# Git configuration
GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-main}"
# Service configuration
SERVICE_NAME="${SERVICE_NAME:-helpy_plan}"
SERVICE_PORT="${SERVICE_PORT:-8080}"
ERLANG_DIR="${ERLANG_DIR:-${SCRIPT_DIR}/../erlang}"
# Health check configuration
HEALTH_CHECK_ENDPOINT="${HEALTH_CHECK_ENDPOINT:-/health}"
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-5}"
CURL_TIMEOUT="${CURL_TIMEOUT:-5}"
PORT_CHECK_TIMEOUT="${PORT_CHECK_TIMEOUT:-30}"
START_WAIT_DELAY="${START_WAIT_DELAY:-1}"
# Retry and timing configuration
STOP_MAX_RETRIES="${STOP_MAX_RETRIES:-5}"
STOP_RETRY_DELAY="${STOP_RETRY_DELAY:-2}"
FORCE_KILL_DELAY="${FORCE_KILL_DELAY:-3}"
ROLLBACK_MAX_RETRIES="${ROLLBACK_MAX_RETRIES:-3}"
ROLLBACK_RETRY_DELAY="${ROLLBACK_RETRY_DELAY:-2}"
# Feature flags
ROLLBACK_ON_FAILURE="${ROLLBACK_ON_FAILURE:-true}"
MAX_BACKUP_COUNT="${MAX_BACKUP_COUNT:-5}"
# Zero-downtime deployment configuration
BLUE_GREEN_ENABLED="${BLUE_GREEN_ENABLED:-false}"
OLD_INSTANCE_GRACE_PERIOD="${OLD_INSTANCE_GRACE_PERIOD:-10}"
##############################
# Global State
##############################
PREVIOUS_COMMIT=""
DEPLOYMENT_START_TIMESTAMP=$(date +%s)
DEPLOYMENT_PID="$$"
ROLLBACK_TRIGGERED=false
CURRENT_DEPLOY_COMMIT=""
BACKUP_PATH=""
# Load previous deployment state
if [[ -f "$LAST_COMMIT_FILE" ]]; then
    PREVIOUS_COMMIT=$(<"$LAST_COMMIT_FILE")
fi
##############################
# Logging Setup
##############################
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
log_info "=== Deployment started at $(date -Iseconds) ==="
##############################
# Directory Preparation
##############################
mkdir -p "$BACKUP_DIR"
# Clean up old backups
find "$BACKUP_DIR" -maxdepth 1 -type d -mtime +30 -name "backup_*" | sort | head -n -$MAX_BACKUP_COUNT | xargs -r rm -rf
##############################
# Core Helper Functions
##############################
# Check if service health endpoint is responsive
is_service_healthy() {
    curl -fsS --connect-timeout "$CURL_TIMEOUT" "http://localhost:${SERVICE_PORT}${HEALTH_CHECK_ENDPOINT}" &>/dev/null
}

# Get all running service PIDs
get_service_pids() {
    pgrep -f "$SERVICE_NAME" || true
}

# Gracefully stop existing service
stop_service() {
    local pids
    pids=$(get_service_pids)
    if [[ -z "$pids" ]]; then
        log_info "No running service instances found"
        return 0
    fi
    
    log_info "Attempting to stop service with PIDs: $pids"
    for attempt in $(seq 1 "$STOP_MAX_RETRIES"); do
        # Check if any processes are still running
        local running=0
        for pid in $pids; do
            if kill -0 "$pid" 2>/dev/null; then
                running=1
                break
            fi
        done
        
        if [[ $running -eq 0 ]]; then
            log_info "All service processes stopped successfully"
            return 0
        fi
        
        # Send SIGTERM first
        kill $pids 2>/dev/null || true
        sleep "$STOP_RETRY_DELAY"
    done
    
    # Force kill if still running
    log_warn "Service did not stop gracefully, force killing..."
    kill -9 $pids 2>/dev/null || true
    sleep "$FORCE_KILL_DELAY"
    
    # Verify port is released
    for i in $(seq 1 "$PORT_CHECK_TIMEOUT"); do
        if ! nc -z localhost "$SERVICE_PORT" 2>/dev/null; then
            break
        fi
        if [[ $i -eq $PORT_CHECK_TIMEOUT ]]; then
            log_error "Failed to release port $SERVICE_PORT after force kill"
            return 1
        fi
        sleep 1
    done
    log_info "Port $SERVICE_PORT successfully released"
}

# Create backup of current deployment
create_backup() {
    BACKUP_PATH="${BACKUP_DIR}/backup_$(date +%Y%m%d_%H%M%S)_${PREVIOUS_COMMIT:0:8}"
    log_info "Creating backup of current deployment at $BACKUP_PATH"
    mkdir -p "$BACKUP_PATH"
    if [[ -d "$ERLANG_DIR" ]]; then
        cp -a "$ERLANG_DIR" "$BACKUP_PATH/" || {
            log_error "Failed to copy current deployment to backup"
            return 1
        }
    fi
    if [[ -f "$LAST_COMMIT_FILE" ]]; then
        cp "$LAST_COMMIT_FILE" "$BACKUP_PATH/" || log_warn "Failed to copy last commit file to backup"
    fi
    log_info "Backup completed successfully"
}

# Rollback to previous deployment
trigger_rollback() {
    ROLLBACK_TRIGGERED=true
    if [[ -z "$BACKUP_PATH" || ! -d "$BACKUP_PATH" ]]; then
        log_error "No valid backup found to rollback to"
        exit 1
    fi

    log_warn "=== Starting rollback process ==="
    stop_service || true
    
    for attempt in $(seq 1 "$ROLLBACK_MAX_RETRIES"); do
        log_info "Rollback attempt $attempt/$ROLLBACK_MAX_RETRIES"
        if cp -a "${BACKUP_PATH}/$(basename "$ERLANG_DIR")" "$(dirname "$ERLANG_DIR")/" && \
           cp "${BACKUP_PATH}/.last_deployed_commit" "$LAST_COMMIT_FILE" && \
           "${SCRIPT_DIR}/start.sh"; then
            log_info "Rollback completed successfully, service is running from backup"
            exit 1
        fi
        sleep "$ROLLBACK_RETRY_DELAY"
    done
    
    log_error "All rollback attempts failed, manual intervention required"
    exit 1
}

# Check for required dependencies
check_dependencies() {
    local deps=("nc" "curl" "rebar3" "git" "pgrep")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &>/dev/null; then
            log_error "Required dependency not found: $dep"
            exit 1
        fi
    done
}

##############################
# Exclusive Locking (Prevent Concurrent Deployments)
##############################
acquire_lock() {
    if ! mkdir "$LOCK_FILE" 2>/dev/null; then
        local LOCK_PID
        LOCK_PID=$(cat "${LOCK_FILE}/.pid" 2>/dev/null || echo "")
        if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
            log_error "Another deployment is active (PID: $LOCK_PID). Lock file: $LOCK_FILE"
            exit 1
        fi
        log_warn "Found stale lock file, recovering..."
        rm -rf "$LOCK_FILE"
        mkdir "$LOCK_FILE" || {
            log_error "Failed to recreate lock file"
            exit 1
        }
    fi
    echo "$DEPLOYMENT_PID" > "${LOCK_FILE}/.pid"
    log_info "Successfully acquired deployment lock"
}

##############################
# Main Deployment Flow
##############################
# Initial checks
check_dependencies
acquire_lock

# Step 1: Enter Erlang source directory
cd "$ERLANG_DIR" || {
    log_error "Failed to enter Erlang directory: $ERLANG_DIR"
    exit 1
}

# Step 2: Fetch latest code and validate commit
log_info "Fetching latest code from $GIT_REMOTE/$GIT_BRANCH"
git fetch "$GIT_REMOTE" || { log_error "Failed to fetch from git"; exit 1; }
CURRENT_DEPLOY_COMMIT=$(git rev-parse "$GIT_REMOTE/$GIT_BRANCH")

if [[ "$CURRENT_DEPLOY_COMMIT" == "$PREVIOUS_COMMIT" ]]; then
    log_info "No new commits to deploy. Current commit $CURRENT_DEPLOY_COMMIT is already running."
    exit 0
fi
log_info "Preparing to deploy commit: ${CURRENT_DEPLOY_COMMIT:0:8}"

# Step 3: Create backup before making changes
if [[ -n "$PREVIOUS_COMMIT" ]]; then
    create_backup
fi

# Step 4: Checkout new code
log_info "Checking out new commit: ${CURRENT_DEPLOY_COMMIT:0:8}"
git checkout -f "$CURRENT_DEPLOY_COMMIT" || { log_error "Failed to checkout new commit"; exit 1; }

# Step 5: Stop existing service
stop_service || exit 1

# Step 6: Build production release
if [[ -f "rebar.config" && grep -q "relx" "rebar.config" ]]; then
    log_info "Building production release..."
    rebar3 as prod release || { log_error "Failed to build production release"; exit 1; }
    
    # Validate release structure
    release_name=$(grep -A10 "relx" rebar.config | grep -oP '(?<=\s)[a-z0-9_]+' | head -n1 || echo "$SERVICE_NAME")
    release_path="_build/prod/rel/${release_name}"
    if [[ ! -d "$release_path" || ! -x "${release_path}/bin/${release_name}" ]]; then
        log_error "Release build incomplete - missing required files in $release_path"
        exit 1
    fi
    log_info "Successfully built release at: $release_path"
fi

# Step 7: Start new service and verify health
log_info "Starting new service instance..."
"${SCRIPT_DIR}/start.sh" || { log_error "Failed to start new service"; exit 1; }

# Wait for service to become healthy
log_info "Waiting for service to become healthy on port $SERVICE_PORT..."
service_healthy=false
for i in $(seq 1 "$PORT_CHECK_TIMEOUT"); do
    if nc -z localhost "$SERVICE_PORT" && is_service_healthy; then
        service_healthy=true
        log_info "Service is up and responding to health checks"
        break
    fi
    if [[ $i -eq $PORT_CHECK_TIMEOUT ]]; then
        log_error "Service failed to start within $PORT_CHECK_TIMEOUTs"
        exit 1
    fi
    (( i % 5 == 0 )) && log_info "Still waiting for service to start... ($i/$PORT_CHECK_TIMEOUT)"
    sleep 1
done

# Verify sustained health
for i in $(seq 1 "$HEALTH_CHECK_RETRIES"); do
    is_service_healthy || { log_error "Service health check failed post-startup"; exit 1; }
    sleep 1
done

# Step 8: Update deployment state
echo "$CURRENT_DEPLOY_COMMIT" > "$LAST_COMMIT_FILE"

# Final success message
SERVICE_PIDS=$(get_service_pids)
log_info "=== ✅ Deployment completed in $(( $(date +%s) - DEPLOYMENT_START_TIMESTAMP ))s! Service running with PID(s): $(echo "$SERVICE_PIDS" | tr '\n' ',' | sed 's/,$//') ==="
exit 0
