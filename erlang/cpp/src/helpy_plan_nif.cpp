#include "helpy_plan_nif.h"
#include "plan_processor.hpp"
#include "plan_template_engine.hpp"
#include "smart_time_planner.hpp"
#include "plan_validator_enhanced.hpp"

#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// Ensure int is wide enough for our INT32_MAX guard.
static_assert(sizeof(int) >= 4, "int must be at least 32 bits");

// ----------------------------------------------------------------------------
// Lifecycle callbacks (forward declarations for ERL_NIF_INIT)
// ----------------------------------------------------------------------------
static int  load(ErlNifEnv*, void**, ERL_NIF_TERM);
static void unload(ErlNifEnv*, void*);
static int  upgrade(ErlNifEnv*, void**, void**, ERL_NIF_TERM);

namespace {

// Provenance tag written into every plan created or applied via the NIF.
constexpr std::string_view kPlanSource = "erlang_nif";

// Upper bound for integer argument validation.
constexpr int kIntMax = INT32_MAX;

// All NIFs involve JSON (de)serialization and computation that may exceed
// the ~1 ms threshold for normal-scheduler execution.  Marking them as
// CPU-bound dirty jobs prevents blocking BEAM scheduler threads.
constexpr unsigned kDirtyCpu = ERL_NIF_DIRTY_JOB_CPU_BOUND;

// ============================================================================
// Atom cache.
//
// Atoms are globally-unique, immutable BEAM identifiers.  Their
// ERL_NIF_TERM representation is stable across environments and scheduler
// threads, so we resolve every name once at load/upgrade time and reuse
// the cached term thereafter.
// ============================================================================

struct AtomCache {
    ERL_NIF_TERM ok{};
    ERL_NIF_TERM error{};
    ERL_NIF_TERM true_atom{};
    ERL_NIF_TERM false_atom{};
    ERL_NIF_TERM undefined{};

    ERL_NIF_TERM internal_error{};
    ERL_NIF_TERM unknown_exception{};
    ERL_NIF_TERM bad_int{};
    ERL_NIF_TERM bad_int_list{};
    ERL_NIF_TERM bad_plan_json{};
    ERL_NIF_TERM bad_plan_list{};
    ERL_NIF_TERM bad_input{};
    ERL_NIF_TERM bad_binary_arg{};
    ERL_NIF_TERM bad_template_id{};

    void init(ErlNifEnv* env) noexcept {
        // Table-driven initialisation eliminates per-field boilerplate.
        struct Entry { std::string_view name; ERL_NIF_TERM* target; };
        const Entry entries[] = {
            {"ok",                &ok},
            {"error",             &error},
            {"true",              &true_atom},
            {"false",             &false_atom},
            {"undefined",         &undefined},
            {"internal_error",    &internal_error},
            {"unknown_exception", &unknown_exception},
            {"bad_int",           &bad_int},
            {"bad_int_list",      &bad_int_list},
            {"bad_plan_json",     &bad_plan_json},
            {"bad_plan_list",     &bad_plan_list},
            {"bad_input",         &bad_input},
            {"bad_binary_arg",    &bad_binary_arg},
            {"bad_template_id",   &bad_template_id},
        };
        for (const auto& [name, target] : entries) {
            *target = enif_make_atom_len(env, name.data(),
                                         static_cast<unsigned>(name.size()));
        }
    }
};

AtomCache g_atoms{};

// ============================================================================
// Term construction helpers
// ============================================================================

[[nodiscard]] inline ERL_NIF_TERM ok_term(ErlNifEnv* env,
                                          ERL_NIF_TERM value) noexcept {
    return enif_make_tuple2(env, g_atoms.ok, value);
}

[[nodiscard]] inline ERL_NIF_TERM error_term(ErlNifEnv* env,
                                             ERL_NIF_TERM reason) noexcept {
    return enif_make_tuple2(env, g_atoms.error, reason);
}

[[nodiscard]] inline ERL_NIF_TERM internal_error(ErlNifEnv* env) noexcept {
    return error_term(env, g_atoms.internal_error);
}

// Allocate a binary term and copy `str` into it.
// Returns false only when the VM cannot satisfy the allocation.
[[nodiscard]] inline bool make_binary(ErlNifEnv* env, std::string_view str,
                                      ERL_NIF_TERM& out) noexcept {
    unsigned char* dst = enif_make_new_binary(env, str.size(), &out);
    if (!dst) [[unlikely]] return false;
    if (!str.empty()) std::memcpy(dst, str.data(), str.size());
    return true;
}

// {error, Binary}.  Falls back to {error, internal_error} only when the
// VM cannot allocate a small binary.
[[nodiscard]] inline ERL_NIF_TERM error_detail(ErlNifEnv* env,
                                               std::string_view detail) noexcept {
    ERL_NIF_TERM bin;
    if (!make_binary(env, detail, bin)) [[unlikely]] return internal_error(env);
    return error_term(env, bin);
}

// Build an Erlang list of binaries from a vector<string>.
// Prepends cells in reverse order, avoiding an intermediate term vector.
[[nodiscard]] bool make_binary_list(ErlNifEnv* env,
                                    const std::vector<std::string>& vec,
                                    ERL_NIF_TERM& out) noexcept {
    ERL_NIF_TERM list = enif_make_list(env, 0);
    for (auto it = vec.rbegin(), end = vec.rend(); it != end; ++it) {
        ERL_NIF_TERM bin;
        if (!make_binary(env, *it, bin)) [[unlikely]] return false;
        list = enif_make_list_cell(env, bin, list);
    }
    out = list;
    return true;
}

// ============================================================================
// Term → C++ conversions
// ============================================================================

// Accepts binary or iolist; flattens into `out`.
[[nodiscard]] bool binary_to_string(ErlNifEnv* env, ERL_NIF_TERM term,
                                    std::string& out) {
    ErlNifBinary bin;
    if (!enif_inspect_iolist_as_binary(env, term, &bin)) return false;
    out.assign(reinterpret_cast<const char*>(bin.data), bin.size);
    return true;
}

// Strict: rejects malformed lists or non-binary elements entirely.
[[nodiscard]] bool list_to_strings(ErlNifEnv* env, ERL_NIF_TERM list,
                                   std::vector<std::string>& out) {
    unsigned length = 0;
    if (!enif_get_list_length(env, list, &length)) return false;
    out.clear();
    out.reserve(length);

    ERL_NIF_TERM head, tail = list;
    std::string buf;  // reused; assign() is safe on a moved-from string
    while (enif_get_list_cell(env, tail, &head, &tail)) {
        if (!binary_to_string(env, head, buf)) return false;
        out.push_back(std::move(buf));
    }
    return true;
}

[[nodiscard]] bool list_to_ints(ErlNifEnv* env, ERL_NIF_TERM list,
                                std::vector<int>& out) {
    unsigned length = 0;
    if (!enif_get_list_length(env, list, &length)) return false;
    out.clear();
    out.reserve(length);

    ERL_NIF_TERM head, tail = list;
    while (enif_get_list_cell(env, tail, &head, &tail)) {
        int v;
        if (!enif_get_int(env, head, &v)) return false;
        out.push_back(v);
    }
    return true;
}

// Read an integer term with optional bounds.
[[nodiscard]] inline bool get_int(ErlNifEnv* env, ERL_NIF_TERM term, int& out,
                                  int min_val = 0,
                                  int max_val = kIntMax) noexcept {
    int v;
    if (!enif_get_int(env, term, &v)) return false;
    if (v < min_val || v > max_val) return false;
    out = v;
    return true;
}

// ============================================================================
// Exception-safe wrappers.
//
// catch_exceptions is the single try/catch boundary; all higher-level
// wrappers delegate to it.
// ============================================================================

template <typename F>
[[nodiscard]] ERL_NIF_TERM catch_exceptions(ErlNifEnv* env, F&& f) {
    try {
        return std::forward<F>(f)();
    } catch (const std::exception& e) {
        return error_detail(env, e.what());
    } catch (...) {
        return error_term(env, g_atoms.unknown_exception);
    }
}

// Run a string-producing function, catch exceptions, return {ok, Binary}.
template <typename F>
[[nodiscard]] ERL_NIF_TERM produce_binary(ErlNifEnv* env, F&& f) {
    return catch_exceptions(env, [&]() -> ERL_NIF_TERM {
        std::string result = f();
        ERL_NIF_TERM bin;
        if (!make_binary(env, result, bin)) [[unlikely]] return internal_error(env);
        return ok_term(env, bin);
    });
}

// Parse a plan JSON term, then invoke f(plan) inside a try block.
// Returns {error, bad_plan_json} if the input is not a binary/iolist.
template <typename F>
[[nodiscard]] ERL_NIF_TERM with_plan(ErlNifEnv* env,
                                     ERL_NIF_TERM plan_term, F&& f) {
    std::string plan_json;
    if (!binary_to_string(env, plan_term, plan_json)) {
        return error_term(env, g_atoms.bad_plan_json);
    }
    return catch_exceptions(env, [&] {
        auto plan = PlanProcessor::plan_from_json(plan_json);
        return f(plan);
    });
}

// Variant where the lambda returns a std::string to be wrapped as
// {ok, Binary}.  Inlined to avoid a double-lambda indirection.
template <typename F>
[[nodiscard]] ERL_NIF_TERM with_plan_to_binary(ErlNifEnv* env,
                                               ERL_NIF_TERM plan_term, F&& f) {
    std::string plan_json;
    if (!binary_to_string(env, plan_term, plan_json)) {
        return error_term(env, g_atoms.bad_plan_json);
    }
    return catch_exceptions(env, [&]() -> ERL_NIF_TERM {
        auto plan = PlanProcessor::plan_from_json(plan_json);
        std::string result = f(plan);
        ERL_NIF_TERM bin;
        if (!make_binary(env, result, bin)) [[unlikely]] return internal_error(env);
        return ok_term(env, bin);
    });
}

} // namespace

// ============================================================================
// PlanProcessor NIFs
// ============================================================================

static ERL_NIF_TERM nif_create_plan(ErlNifEnv* env, int argc,
                                    const ERL_NIF_TERM argv[]) {
    if (argc != 1) return enif_make_badarg(env);

    std::string input;
    if (!binary_to_string(env, argv[0], input)) {
        return error_term(env, g_atoms.bad_input);
    }

    return produce_binary(env, [&] {
        auto plan = PlanProcessor::create_plan(input, std::string(kPlanSource));
        return PlanProcessor::plan_to_json(plan);
    });
}

static ERL_NIF_TERM nif_validate_plan(ErlNifEnv* env, int argc,
                                      const ERL_NIF_TERM argv[]) {
    if (argc != 3) return enif_make_badarg(env);

    int duration = 0, chunk_size = 0, break_minutes = 0;
    if (!get_int(env, argv[0], duration) ||
        !get_int(env, argv[1], chunk_size) ||
        !get_int(env, argv[2], break_minutes)) {
        return error_term(env, g_atoms.bad_int);
    }

    bool valid = PlanProcessor::validate_plan(duration, chunk_size, break_minutes);
    return ok_term(env, valid ? g_atoms.true_atom : g_atoms.false_atom);
}

static ERL_NIF_TERM nif_adjust_plan(ErlNifEnv* env, int argc,
                                    const ERL_NIF_TERM argv[]) {
    if (argc != 3) return enif_make_badarg(env);

    int new_chunk = 0, new_break = 0;
    if (!get_int(env, argv[1], new_chunk) ||
        !get_int(env, argv[2], new_break)) {
        return error_term(env, g_atoms.bad_int);
    }

    return with_plan_to_binary(env, argv[0], [&](auto& plan) {
        auto adjusted = PlanProcessor::adjust_plan(plan, new_chunk, new_break);
        return PlanProcessor::plan_to_json(adjusted);
    });
}

// ============================================================================
// PlanTemplateEngine NIFs
// ============================================================================

static ERL_NIF_TERM nif_list_templates(ErlNifEnv* env, int argc,
                                       [[maybe_unused]] const ERL_NIF_TERM argv[]) {
    if (argc != 0) return enif_make_badarg(env);

    return produce_binary(env, [] {
        PlanTemplateEngine::TemplateEngine engine;
        auto templates = engine.get_all_templates();
        return engine.templates_to_json(templates);
    });
}

static ERL_NIF_TERM nif_get_template(ErlNifEnv* env, int argc,
                                     const ERL_NIF_TERM argv[]) {
    if (argc != 1) return enif_make_badarg(env);

    std::string template_id;
    if (!binary_to_string(env, argv[0], template_id)) {
        return error_term(env, g_atoms.bad_template_id);
    }

    // Returns {ok, undefined} for a missing template, hence the manual
    // term construction rather than produce_binary.
    return catch_exceptions(env, [&]() -> ERL_NIF_TERM {
        PlanTemplateEngine::TemplateEngine engine;
        auto tpl = engine.get_template(template_id);
        if (!tpl) return ok_term(env, g_atoms.undefined);
        std::string json = engine.template_to_json(*tpl);
        ERL_NIF_TERM bin;
        if (!make_binary(env, json, bin)) [[unlikely]] return internal_error(env);
        return ok_term(env, bin);
    });
}

static ERL_NIF_TERM nif_apply_template(ErlNifEnv* env, int argc,
                                       const ERL_NIF_TERM argv[]) {
    if (argc != 2) return enif_make_badarg(env);

    std::string template_id, args;
    if (!binary_to_string(env, argv[0], template_id) ||
        !binary_to_string(env, argv[1], args)) {
        return error_term(env, g_atoms.bad_binary_arg);
    }

    return produce_binary(env, [&] {
        PlanTemplateEngine::TemplateEngine engine;
        auto plan = engine.apply_template(template_id, args,
                                          std::string(kPlanSource));
        return PlanProcessor::plan_to_json(plan);
    });
}

// ============================================================================
// SmartTimePlanner NIFs
// ============================================================================

static ERL_NIF_TERM nif_generate_schedule(ErlNifEnv* env, int argc,
                                          const ERL_NIF_TERM argv[]) {
    if (argc != 3) return enif_make_badarg(env);

    int start_hour = 0, start_minute = 0;
    if (!get_int(env, argv[1], start_hour, 0, 23) ||
        !get_int(env, argv[2], start_minute, 0, 59)) {
        return error_term(env, g_atoms.bad_int);
    }

    return with_plan_to_binary(env, argv[0], [&](auto& plan) {
        SmartTimePlanner::SmartPlanner planner;
        auto schedule = planner.generate_schedule(plan, start_hour, start_minute);
        return planner.schedule_to_json(schedule);
    });
}

static ERL_NIF_TERM nif_optimize_schedule(ErlNifEnv* env, int argc,
                                          const ERL_NIF_TERM argv[]) {
    if (argc != 2) return enif_make_badarg(env);

    std::vector<int> available;
    if (!list_to_ints(env, argv[1], available)) {
        return error_term(env, g_atoms.bad_int_list);
    }

    return with_plan_to_binary(env, argv[0], [&](auto& plan) {
        SmartTimePlanner::SmartPlanner planner;
        auto schedule = planner.optimize_schedule(plan, available, true);
        return planner.schedule_to_json(schedule);
    });
}

static ERL_NIF_TERM nif_optimize_plan(ErlNifEnv* env, int argc,
                                      const ERL_NIF_TERM argv[]) {
    if (argc != 1) return enif_make_badarg(env);

    return with_plan_to_binary(env, argv[0], [&](auto& plan) {
        SmartTimePlanner::SmartPlanner planner;
        return planner.generate_optimized_plan(plan, true);
    });
}

static ERL_NIF_TERM nif_analyze_productivity(ErlNifEnv* env, int argc,
                                             const ERL_NIF_TERM argv[]) {
    if (argc != 1) return enif_make_badarg(env);

    std::vector<std::string> plan_jsons;
    if (!list_to_strings(env, argv[0], plan_jsons)) {
        return error_term(env, g_atoms.bad_plan_list);
    }

    // All plan parsing happens inside produce_binary's try block so that
    // malformed plans produce a clear {error, Detail} rather than being
    // silently skipped.
    return produce_binary(env, [&] {
        std::vector<PlanProcessor::FullPlan> plans;
        plans.reserve(plan_jsons.size());
        for (const auto& j : plan_jsons) {
            plans.push_back(PlanProcessor::plan_from_json(j));
        }
        SmartTimePlanner::SmartPlanner planner;
        return planner.stats_to_json(planner.analyze_productivity(plans));
    });
}

// ============================================================================
// PlanValidatorEnhanced NIFs
// ============================================================================

static ERL_NIF_TERM nif_validate_enhanced(ErlNifEnv* env, int argc,
                                          const ERL_NIF_TERM argv[]) {
    if (argc != 1) return enif_make_badarg(env);

    return with_plan_to_binary(env, argv[0], [&](auto& plan) {
        PlanValidatorEnhanced::EnhancedValidator validator;
        auto report = validator.validate_and_suggest(plan);
        return validator.report_to_json(report);
    });
}

static ERL_NIF_TERM nif_get_quality_score(ErlNifEnv* env, int argc,
                                          const ERL_NIF_TERM argv[]) {
    if (argc != 1) return enif_make_badarg(env);

    return with_plan_to_binary(env, argv[0], [&](auto& plan) {
        PlanValidatorEnhanced::EnhancedValidator validator;
        return validator.calculate_quality_score(plan);
    });
}

static ERL_NIF_TERM nif_get_improvements(ErlNifEnv* env, int argc,
                                         const ERL_NIF_TERM argv[]) {
    if (argc != 1) return enif_make_badarg(env);

    // Returns {ok, [Binary, ...]} — a list, not a single binary, so with_plan
    // (not with_plan_to_binary) is the right wrapper.
    return with_plan(env, argv[0], [&](auto& plan) -> ERL_NIF_TERM {
        PlanValidatorEnhanced::EnhancedValidator validator;
        auto improvements = validator.suggest_improvements(plan);
        ERL_NIF_TERM list;
        if (!make_binary_list(env, improvements, list)) [[unlikely]] {
            return internal_error(env);
        }
        return ok_term(env, list);
    });
}

// ============================================================================
// NIF function table
// ============================================================================

static constexpr ErlNifFunc nif_funcs[] = {
    {"nif_create_plan",          1, nif_create_plan,          kDirtyCpu},
    {"nif_validate_plan",        3, nif_validate_plan,        kDirtyCpu},
    {"nif_adjust_plan",          3, nif_adjust_plan,          kDirtyCpu},
    {"nif_list_templates",       0, nif_list_templates,       kDirtyCpu},
    {"nif_get_template",         1, nif_get_template,         kDirtyCpu},
    {"nif_apply_template",       2, nif_apply_template,       kDirtyCpu},
    {"nif_generate_schedule",    3, nif_generate_schedule,    kDirtyCpu},
    {"nif_optimize_schedule",    2, nif_optimize_schedule,    kDirtyCpu},
    {"nif_optimize_plan",        1, nif_optimize_plan,        kDirtyCpu},
    {"nif_analyze_productivity", 1, nif_analyze_productivity, kDirtyCpu},
    {"nif_validate_enhanced",    1, nif_validate_enhanced,    kDirtyCpu},
    {"nif_get_quality_score",    1, nif_get_quality_score,    kDirtyCpu},
    {"nif_get_improvements",     1, nif_get_improvements,     kDirtyCpu},
};

// ============================================================================
// Lifecycle callbacks
// ============================================================================

static int load(ErlNifEnv* env, void** priv_data,
                [[maybe_unused]] ERL_NIF_TERM load_info) {
    g_atoms.init(env);
    *priv_data = nullptr;
    return 0;
}

static void unload([[maybe_unused]] ErlNifEnv* env,
                   [[maybe_unused]] void* priv_data) noexcept {
    // Nothing to release; atom cache is static.
}

static int upgrade(ErlNifEnv* env, void** priv_data,
                   void** old_priv_data,
                   [[maybe_unused]] ERL_NIF_TERM load_info) {
    // Re-initialize the atom cache in case the BEAM instance changed.
    g_atoms.init(env);
    *priv_data = *old_priv_data;
    return 0;
}

ERL_NIF_INIT(helpy_plan_nif, nif_funcs, load, nullptr, upgrade, unload)