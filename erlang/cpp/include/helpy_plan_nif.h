#ifndef HELPY_PLAN_NIF_H
#define HELPY_PLAN_NIF_H

#include <erl_nif.h>

#ifdef __cplusplus
extern "C" {
#endif

// NIF initialization
ERL_NIF_TERM nif_parse_plan(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_calculate_stats(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_generate_recommendation(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);

// New NIF functions for enhanced features
ERL_NIF_TERM nif_process_plan(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_validate_plan(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_optimize_task_distribution(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_calculate_analytics(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_calculate_productivity_score(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_schedule_tasks(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_calculate_optimal_breaks(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);
ERL_NIF_TERM nif_prioritize_tasks(ErlNifEnv* env, int argc, const ERL_NIF_TERM argv[]);

int load(ErlNifEnv* env, void** priv_data, ERL_NIF_TERM load_info);
void unload(ErlNifEnv* env, void* priv_data);
int upgrade(ErlNifEnv* env, void** priv_data, void** old_priv_data, ERL_NIF_TERM load_info);

#ifdef __cplusplus
}
#endif

#endif // HELPY_PLAN_NIF_H
