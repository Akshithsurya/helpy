#include <napi.h>
#include <string>
#include <vector>
#include <algorithm>
#include <chrono>
#include <thread>
#include <mutex>
#include <atomic>
#include <memory>
#include <cctype>

#ifdef _WIN32
#include <windows.h>
#include <tlhelp32.h>
#else
#include <unistd.h>
#include <sys/types.h>
#include <signal.h>
#endif

namespace {

// ===== Constants =====
constexpr int kMonitorIntervalMs = 1000;
constexpr int kMinHardModeDelaySec = 60;
constexpr int kMaxHardModeDelaySec = 120;

// ===== Consolidated State (protected by g_state_mutex) =====
// Grouping related fields into structs guarantees consistent snapshots
// and eliminates the TOCTOU window that existed when they were separate
// atomics / strings guarded independently.

struct HardModeState {
    bool active = false;
    int64_t unlock_time_ms = 0;   // Epoch milliseconds
    std::string password;
};

struct BlockedLists {
    std::vector<std::string> processes;      // Already lowercased
    std::vector<std::string> window_titles;  // Already lowercased (reserved)
};

std::mutex g_state_mutex;            // Protects g_hard_mode + g_blocked
HardModeState g_hard_mode;
BlockedLists g_blocked;

std::mutex g_thread_mutex;           // Protects g_monitor_thread lifecycle
std::atomic<bool> g_monitoring_active{false};
std::thread g_monitor_thread;

// ===== Utility Functions =====

// Proper UTF-16 → UTF-8 conversion.  Returns empty string on failure
// instead of the previous lossy ASCII truncation.
std::string WideToUtf8(const std::wstring& w) {
#ifdef _WIN32
    if (w.empty()) return {};
    const int len = WideCharToMultiByte(
        CP_UTF8, 0, w.c_str(), static_cast<int>(w.size()),
        nullptr, 0, nullptr, nullptr);
    if (len <= 0) return {};
    std::string out(static_cast<size_t>(len), '\0');
    WideCharToMultiByte(
        CP_UTF8, 0, w.c_str(), static_cast<int>(w.size()),
        out.data(), len, nullptr, nullptr);
    return out;
#else
    return {w.begin(), w.end()};
#endif
}

// Locale-independent ASCII lowercasing (avoids unexpected behaviour
// when the global locale is not "C").
char AsciiToLower(unsigned char c) noexcept {
    return static_cast<char>(c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c);
}

std::string ToLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), AsciiToLower);
    return s;
}

int64_t NowMs() noexcept {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

BlockedLists SnapshotBlocked() {
    std::lock_guard<std::mutex> lock(g_state_mutex);
    return g_blocked;  // copy
}

HardModeState SnapshotHardMode() {
    std::lock_guard<std::mutex> lock(g_state_mutex);
    return g_hard_mode;  // copy
}

// ===== OS-Level Enforcement =====

#ifdef _WIN32
void TerminateMatchingProcesses(const std::vector<std::string>& blocked) {
    if (blocked.empty()) return;

    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap == INVALID_HANDLE_VALUE) return;

    // RAII guard ensures the snapshot handle is always closed.
    auto snap_closer = [](HANDLE* h) {
        if (*h != INVALID_HANDLE_VALUE) CloseHandle(*h);
    };
    std::unique_ptr<HANDLE, decltype(snap_closer)> snap_guard(&hSnap, snap_closer);

    PROCESSENTRY32W pe32{};
    pe32.dwSize = sizeof(pe32);
    if (!Process32FirstW(hSnap, &pe32)) return;

    do {
        const std::string exeLower = ToLower(WideToUtf8(pe32.szExeFile));
        if (exeLower.empty()) continue;

        for (const auto& name : blocked) {
            if (name.empty()) continue;
            if (exeLower.find(name) != std::string::npos) {
                if (HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE,
                                               pe32.th32ProcessID)) {
                    TerminateProcess(hProc, 1);
                    CloseHandle(hProc);
                }
                break;  // match found — don't check remaining patterns
            }
        }
    } while (Process32NextW(hSnap, &pe32));
}
#else
void TerminateMatchingProcesses(const std::vector<std::string>&) {
    // Non-Windows: no-op.  Could be extended with /proc scanning + kill(2).
}
#endif

void PerformEnforcement() {
    const auto snapshot = SnapshotBlocked();
    TerminateMatchingProcesses(snapshot.processes);
    // Window-title enforcement could be added here.
}

// ===== Monitor Thread =====

void MonitorLoop() noexcept {
    while (g_monitoring_active.load(std::memory_order_relaxed)) {
        try {
            PerformEnforcement();
        } catch (...) {
            // Swallow exceptions so the monitor stays alive.
            // A stray error in one iteration must not kill the thread.
        }
        std::this_thread::sleep_for(
            std::chrono::milliseconds(kMonitorIntervalMs));
    }
}

// All access to g_monitor_thread is serialised through g_thread_mutex,
// eliminating the race between concurrent Ensure/Stop calls.
void EnsureMonitorRunning() {
    std::lock_guard<std::mutex> lock(g_thread_mutex);
    if (g_monitoring_active.load(std::memory_order_relaxed)) return;
    if (g_monitor_thread.joinable()) g_monitor_thread.join();
    g_monitoring_active.store(true, std::memory_order_relaxed);
    g_monitor_thread = std::thread(MonitorLoop);
}

void StopMonitor() {
    std::lock_guard<std::mutex> lock(g_thread_mutex);
    g_monitoring_active.store(false, std::memory_order_relaxed);
    if (g_monitor_thread.joinable()) g_monitor_thread.join();
}

// ===== Argument Validation Helpers =====

int ClampedInt(const Napi::CallbackInfo& info, size_t idx,
               int default_val, int lo, int hi) {
    if (info.Length() <= idx || !info[idx].IsNumber()) return default_val;
    return std::clamp(info[idx].As<Napi::Number>().Int32Value(), lo, hi);
}

} // namespace

// ===== N-API Wrappers =====

Napi::Value SetBlockedProcesses(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Array of process names expected")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    const Napi::Array arr = info[0].As<Napi::Array>();
    std::vector<std::string> procs;
    procs.reserve(arr.Length());

    for (uint32_t i = 0; i < arr.Length(); ++i) {
        Napi::Value val = arr[i];
        if (val.IsString()) {
            std::string name = ToLower(val.As<Napi::String>().Utf8Value());
            if (!name.empty()) procs.push_back(std::move(name));
        }
    }

    {
        std::lock_guard<std::mutex> lock(g_state_mutex);
        g_blocked.processes = std::move(procs);
    }

    EnsureMonitorRunning();
    return Napi::Boolean::New(env, true);
}

Napi::Value StartHardMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    const int delaySeconds = ClampedInt(info, 0, kMinHardModeDelaySec,
                                        kMinHardModeDelaySec,
                                        kMaxHardModeDelaySec);
    std::string password;
    if (info.Length() >= 2 && info[1].IsString()) {
        password = info[1].As<Napi::String>().Utf8Value();
    }

    const int64_t now = NowMs();
    const int64_t unlockAt = now + static_cast<int64_t>(delaySeconds) * 1000;

    {
        std::lock_guard<std::mutex> lock(g_state_mutex);
        g_hard_mode.active         = true;
        g_hard_mode.unlock_time_ms = unlockAt;
        g_hard_mode.password       = std::move(password);
    }

    Napi::Object res = Napi::Object::New(env);
    res.Set("success",        Napi::Boolean::New(env, true));
    res.Set("unlockTimeMs",   Napi::Number::New(env, static_cast<double>(unlockAt)));
    res.Set("delaySeconds",   Napi::Number::New(env, delaySeconds));
    return res;
}

Napi::Value RequestUnlockHardMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string passInput;
    if (info.Length() >= 1 && info[0].IsString()) {
        passInput = info[0].As<Napi::String>().Utf8Value();
    }

    const int64_t now = NowMs();
    const HardModeState state = SnapshotHardMode();

    const bool passwordMatch    = !state.password.empty() && passInput == state.password;
    const bool countdownExpired = now >= state.unlock_time_ms;

    Napi::Object res = Napi::Object::New(env);
    if (passwordMatch || countdownExpired) {
        {
            std::lock_guard<std::mutex> lock(g_state_mutex);
            g_hard_mode.active   = false;
            g_hard_mode.password.clear();
        }
        res.Set("unlocked", Napi::Boolean::New(env, true));
        res.Set("reason", Napi::String::New(env,
            passwordMatch ? "password_verified" : "countdown_expired"));
    } else {
        const int64_t remainingMs = state.unlock_time_ms - now;
        res.Set("unlocked", Napi::Boolean::New(env, false));
        res.Set("remainingSeconds",
                Napi::Number::New(env, remainingMs > 0 ? remainingMs / 1000.0 : 0.0));
        res.Set("reason", Napi::String::New(env, "locked"));
    }
    return res;
}

Napi::Value GetHardModeStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const int64_t now = NowMs();
    const HardModeState state = SnapshotHardMode();
    const int64_t remainingMs = (state.unlock_time_ms > now)
                                    ? (state.unlock_time_ms - now) : 0;

    Napi::Object res = Napi::Object::New(env);
    res.Set("active",           Napi::Boolean::New(env, state.active));
    res.Set("remainingSeconds", Napi::Number::New(env, remainingMs / 1000.0));
    res.Set("hasPassword",      Napi::Boolean::New(env, !state.password.empty()));
    return res;
}

Napi::Value StopEnforcement(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Single consistent snapshot — no TOCTOU gap between reading
    // active and unlock_time_ms.
    {
        const HardModeState state = SnapshotHardMode();
        if (state.active && NowMs() < state.unlock_time_ms) {
            Napi::Error::New(env,
                "Cannot stop enforcement while Hard Mode countdown is active")
                .ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    StopMonitor();

    {
        std::lock_guard<std::mutex> lock(g_state_mutex);
        g_blocked.processes.clear();
        g_blocked.window_titles.clear();
    }

    return Napi::Boolean::New(env, true);
}

// ===== Module Init =====

// Ensures the worker thread is stopped when the JS environment is torn down,
// preventing use-after-free crashes if the addon is unloaded.
void OnEnvCleanup(void* /*hint*/) {
    StopMonitor();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    napi_add_env_cleanup_hook(env, OnEnvCleanup, nullptr);

    exports.Set("setBlockedProcesses",
                Napi::Function::New(env, SetBlockedProcesses));
    exports.Set("startHardMode",
                Napi::Function::New(env, StartHardMode));
    exports.Set("requestUnlockHardMode",
                Napi::Function::New(env, RequestUnlockHardMode));
    exports.Set("getHardModeStatus",
                Napi::Function::New(env, GetHardModeStatus));
    exports.Set("stopEnforcement",
                Napi::Function::New(env, StopEnforcement));
    return exports;
}

NODE_API_MODULE(enforcement_addon, Init)