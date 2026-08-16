// Serialization helpers for the Helpy Plan service.
//
// Thin, self-documenting wrappers around JsonUtils that provide the canonical
// entry points for JSON serialization and parsing used throughout the codebase.

#pragma once

#include "json_utils.hpp"

#include <optional>
#include <string>
#include <string_view>

namespace Serialization {

// Type alias for brevity and to decouple callers from the JsonUtils namespace.
using JsonValue = JsonUtils::JsonValue;

namespace detail {

// Indentation (in spaces) used when pretty-printing JSON.
inline constexpr int kPrettyPrintIndent = 2;

// Sentinel value understood by JsonValue::serialize() to mean "no whitespace".
// NOTE: relying on a magic sentinel is fragile. If JsonValue is ever open for
// change, prefer a dedicated serializeCompact() overload and remove this.
inline constexpr int kCompactIndent = -1;

} // namespace detail

/// Serialize \p data to a pretty-printed (indented) JSON string.
[[nodiscard]] inline std::string toJson(const JsonValue& data) {
    return data.serialize(detail::kPrettyPrintIndent);
}

/// Serialize \p data to a compact (whitespace-free) JSON string.
[[nodiscard]] inline std::string toCompactJson(const JsonValue& data) {
    return data.serialize(detail::kCompactIndent);
}

/// Parse a JSON document.
///
/// Propagates any exception thrown by JsonUtils::parseJson on malformed input;
/// callers must be prepared to handle parse errors (or use tryFromJson).
[[nodiscard]] inline JsonValue fromJson(std::string_view json) {
    // The std::string copy is unavoidable unless JsonUtils::parseJson grows a
    // std::string_view overload; revisit if profiling shows this is hot.
    return JsonUtils::parseJson(std::string{json});
}

/// Parse a JSON document without throwing.
///
/// Returns std::nullopt on any failure, including malformed input and
/// allocation failure. The underlying exception is swallowed silently today;
/// wire up debug logging here (e.g. via spdlog / LOG_DEBUG) if parse failures
/// need diagnosing in the field.
[[nodiscard]] inline std::optional<JsonValue>
tryFromJson(std::string_view json) noexcept {
    try {
        return JsonUtils::parseJson(std::string{json});
    } catch (...) {
        return std::nullopt;
    }
}

} // namespace Serialization