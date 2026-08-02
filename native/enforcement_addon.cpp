#include <napi.h>
#include <string>
#include <vector>
#include <unordered_set>
#include <algorithm>
#include <chrono>
#include <thread>
#include <mutex>
#include <atomic>
#include <memory>

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

// ===== Global State =====
std::mutex g_mutex;
std::vector<std::string> g_blocked_processes;       // Already lowercased
std::vector<std::string> g_blocked_window_titles;   // Already lowercased
std::atomic<bool> g_hard_mode_active(false);
std::atomic<int64_t> g_hard_mode_unlock_time(0);    // Epoch ms
std::string g_hard_mode_password;                   // Protected by g_mutex
std::atomic<bool> g_monitoring_active(false);
std::thread g_monitor_thread;

// ===== Utility Functions =====

// Proper UTF-16 -> UTF-8 conversion (Windows). Falls back to ASCII on failure.
std::string WideToUtf8(const std::wstring& w) {
#ifdef _WIN32
    if (w.empty()) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, w.c_str(),
                                  static_cast<int>(w.size()),
                                  nullptr, 0, nullptr, nullptr);
    if (len <= 0) {
        return std::string(w.begin(), w.end()); // ASCII fallback
    }
    std::string out(len, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(),
                        static_cast<int>(w.size()),
                        out.data(), len, nullptr, nullptr);
    return out;
#else
    return std::string(w.begin(), w.end());
#endif
}

std::string ToLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return s;
}

int64_t NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// Snapshot the current blocked lists without holding the lock during enforcement.
struct BlockedSnapshot {
    std::vector<std::string> processes;
    std::vector<std::string> window_titles;
};

BlockedSnapshot SnapshotBlocked() {
    std::lock_guard<std::mutex> lock(g_mutex);
    return { g_blocked_processes, g_blocked_window_titles };
}

// ===== OS-Level Enforcement =====

#ifdef _WIN32
void TerminateMatchingProcesses(const std::vector<std::string>& blocked) {
    if (blocked.empty()) return;

    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap == INVALID_HANDLE_VALUE) return;

    // RAII handle wrapper
    auto snapCloser = [](HANDLE* h) { if (*h != INVALID_HANDLE_VALUE) CloseHandle(*h); };
    std::unique_ptr<HANDLE, decltype(snapCloser)> snapGuard(&hSnap, snapCloser);

    PROCESSENTRY32W pe32{};
    pe32.dwSize = sizeof(pe32);

    if (!Process32FirstW(hSnap, &pe32)) return;

    do {
        const std::string exeLower = ToLower(WideToUtf8(pe32.szExeFile));
        if (exeLower.empty()) continue;

        for (const auto& blocked_name : blocked) {
            if (blocked_name.empty()) continue;
            if (exeLower.find(blocked_name) != std::string::npos) {
                HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, pe32.th32ProcessID);
                if (hProc) {
                    TerminateProcess(hProc, 1);
                    CloseHandle(hProc);
                }
                break; // Don't try to terminate the same process twice
            }
        }
    } while (Process32NextW(hSnap, &pe32));
}
#else
void TerminateMatchingProcesses(const std::vector<std::string>&) {
    // Non-Windows: no-op (could be extended with /proc scanning + kill)
}
#endif

void PerformEnforcement() {
    const auto snapshot = SnapshotBlocked();
    TerminateMatchingProcesses(snapshot.processes);
    // Window-title enforcement could be added here.
}

// ===== Monitor Thread =====

void MonitorLoop() {
    while (g_monitoring_active.load(std::memory_order_relaxed)) {
        PerformEnforcement();
        std::this_thread::sleep_for(
            std::chrono::milliseconds(kMonitorIntervalMs));
    }
}

void EnsureMonitorRunning() {
    bool expected = false;
    if (!g_monitoring_active.compare_exchange_strong(expected, true)) {
        return; // Already running
    }
    if (g_monitor_thread.joinable()) {
        g_monitor_thread.join();
    }
    g_monitor_thread = std::thread(MonitorLoop);
}

void StopMonitor() {
    g_monitoring_active.store(false, std::memory_order_relaxed);
    if (g_monitor_thread.joinable()) {
        g_monitor_thread.join();
    }
}

// ===== Argument Validation Helpers =====

std::string RequiredString(const Napi::CallbackInfo& info, size_t idx,
                           const char* what) {
    if (info.Length() <= idx || !info[idx].IsString()) {
        throw std::invalid_argument(std::string(what) + " expected");
    }
    return info[idx].As<Napi::String>().Utf8Value();
}

int ClampedInt(const Napi::CallbackInfo& info, size_t idx,
               int default_val, int lo, int hi) {
    if (info.Length() <= idx || !info[idx].IsNumber()) return default_val;
    int v = info[idx].As<Napi::Number>().Int32Value();
    return std::clamp(v, lo, hi);
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

    Napi::Array arr = info[0].As<Napi::Array>();
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
        std::lock_guard<std::mutex> lock(g_mutex);
        g_blocked_processes = std::move(procs);
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
        std::lock_guard<std::mutex> lock(g_mutex);
        g_hard_mode_password = password;
    }
    g_hard_mode_unlock_time.store(unlockAt, std::memory_order_relaxed);
    g_hard_mode_active.store(true, std::memory_order_relaxed);

    Napi::Object res = Napi::Object::New(env);
    res.Set("success", Napi::Boolean::New(env, true));
    res.Set("unlockTimeMs", Napi::Number::New(env, static_cast<double>(unlockAt)));
    res.Set("delaySeconds", Napi::Number::New(env, delaySeconds));
    return res;
}

Napi::Value RequestUnlockHardMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string passInput;
    if (info.Length() >= 1 && info[0].IsString()) {
        passInput = info[0].As<Napi::String>().Utf8Value();
    }

    const int64_t now = NowMs();
    const int64_t unlockAt = g_hard_mode_unlock_time.load(std::memory_order_relaxed);

    std::string storedPassword;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        storedPassword = g_hard_mode_password;
    }

    const bool passwordMatch = !storedPassword.empty() && passInput == storedPassword;
    const bool countdownExpired = now >= unlockAt;

    Napi::Object res = Napi::Object::New(env);
    if (passwordMatch || countdownExpired) {
        g_hard_mode_active.store(false, std::memory_order_relaxed);
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            g_hard_mode_password.clear();
        }
        res.Set("unlocked", Napi::Boolean::New(env, true));
        res.Set("reason", Napi::String::New(env,
            passwordMatch ? "password_verified" : "countdown_expired"));
    } else {
        const int64_t remainingMs = unlockAt - now;
        res.Set("unlocked", Napi::Boolean::New(env, false));
        res.Set("remainingSeconds",
                Napi::Number::New(env, remainingMs > 0 ? remainingMs / 1000.0 : 0));
        res.Set("reason", Napi::String::New(env, "locked"));
    }
    return res;
}

Napi::Value GetHardModeStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const int64_t now = NowMs();
    const int64_t unlockAt = g_hard_mode_unlock_time.load(std::memory_order_relaxed);
    const int64_t remainingMs = (unlockAt > now) ? (unlockAt - now) : 0;

    bool hasPassword;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        hasPassword = !g_hard_mode_password.empty();
    }

    Napi::Object res = Napi::Object::New(env);
    res.Set("active", Napi::Boolean::New(env, g_hard_mode_active.load(std::memory_order_relaxed)));
    res.Set("remainingSeconds", Napi::Number::New(env, remainingMs / 1000.0));
    res.Set("hasPassword", Napi::Boolean::New(env, hasPassword));
    return res;
}

Napi::Value StopEnforcement(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_hard_mode_active.load(std::memory_order_relaxed)) {
        const int64_t now = NowMs();
        if (now < g_hard_mode_unlock_time.load(std::memory_order_relaxed)) {
            Napi::Error::New(env, "Cannot stop enforcement while Hard Mode countdown is active")
                .ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    StopMonitor();

    {
        std::lock_guard<std::mutex> lock(g_mutex);
        g_blocked_processes.clear();
        g_blocked_window_titles.clear();
    }

    return Napi::Boolean::New(env, true);
}

// ===== Module Init =====

Napi::Object Init(Napi::Env env, Napi::Object exports) {
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