#!/bin/bash
set -euo pipefail
# Deployment script for Helpy Plan Erlang service
# Resolve absolute path of script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# shellcheck source=common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
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
done
log_info "Port $SERVICE_PORT successfully released"

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

# Final success message
SERVICE_PIDS=$(get_service_pids)
log_info "=== ✅ Deployment completed in $(( $(date +%s) - DEPLOYMENT_START_TIMESTAMP ))s! Service running with PID(s): $(echo "$SERVICE_PIDS" | tr '\n' ',' | sed 's/,$//') ==="
exit 0
