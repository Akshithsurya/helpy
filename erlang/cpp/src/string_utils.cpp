#ifndef STRING_UTILS_HPP
#define STRING_UTILS_HPP

#include <algorithm>
#include <string>
#include <string_view>
#include <vector>

namespace StringUtils {

namespace detail {

inline constexpr std::string_view kWhitespace = " \t\n\r\f\v";

// Locale-independent ASCII case conversion. Unlike std::tolower/std::toupper
// (which depend on the global C locale, are not constexpr, and require an
// unsigned-char cast to avoid UB), these are constexpr, noexcept, and behave
// identically regardless of locale.
constexpr char asciiToLower(unsigned char c) noexcept {
    return (c >= 'A' && c <= 'Z') ? static_cast<char>(c + ('a' - 'A'))
                                  : static_cast<char>(c);
}
constexpr char asciiToUpper(unsigned char c) noexcept {
    return (c >= 'a' && c <= 'z') ? static_cast<char>(c - ('a' - 'A'))
                                  : static_cast<char>(c);
}

}  // namespace detail

// ============================================================================
// Case conversion
// ============================================================================

[[nodiscard]] constexpr std::string toLower(std::string_view str) {
    std::string result(str);
    for (char& c : result)
        c = detail::asciiToLower(static_cast<unsigned char>(c));
    return result;
}

[[nodiscard]] constexpr std::string toUpper(std::string_view str) {
    std::string result(str);
    for (char& c : result)
        c = detail::asciiToUpper(static_cast<unsigned char>(c));
    return result;
}

constexpr std::string& toLowerInPlace(std::string& str) {
    for (char& c : str)
        c = detail::asciiToLower(static_cast<unsigned char>(c));
    return str;
}

constexpr std::string& toUpperInPlace(std::string& str) {
    for (char& c : str)
        c = detail::asciiToUpper(static_cast<unsigned char>(c));
    return str;
}

[[nodiscard]] constexpr bool equalsIgnoreCase(std::string_view a,
                                              std::string_view b) noexcept {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (detail::asciiToLower(static_cast<unsigned char>(a[i])) !=
            detail::asciiToLower(static_cast<unsigned char>(b[i])))
            return false;
    }
    return true;
}

// ============================================================================
// Trimming
// ============================================================================

[[nodiscard]] constexpr std::string_view trim_view(std::string_view str) noexcept {
    const auto start = str.find_first_not_of(detail::kWhitespace);
    if (start == std::string_view::npos) return {};
    const auto end = str.find_last_not_of(detail::kWhitespace);
    return str.substr(start, end - start + 1);
}

[[nodiscard]] constexpr std::string_view ltrim_view(std::string_view str) noexcept {
    const auto start = str.find_first_not_of(detail::kWhitespace);
    return start == std::string_view::npos ? std::string_view{} : str.substr(start);
}

[[nodiscard]] constexpr std::string_view rtrim_view(std::string_view str) noexcept {
    const auto end = str.find_last_not_of(detail::kWhitespace);
    return end == std::string_view::npos ? std::string_view{} : str.substr(0, end + 1);
}

[[nodiscard]] inline std::string trim(std::string_view str) {
    return std::string(trim_view(str));
}
[[nodiscard]] inline std::string ltrim(std::string_view str) {
    return std::string(ltrim_view(str));
}
[[nodiscard]] inline std::string rtrim(std::string_view str) {
    return std::string(rtrim_view(str));
}

constexpr void trimInPlace(std::string& str) {
    const auto end = str.find_last_not_of(detail::kWhitespace);
    if (end == std::string::npos) { str.clear(); return; }
    str.erase(end + 1);
    str.erase(0, str.find_first_not_of(detail::kWhitespace));
}

constexpr void ltrimInPlace(std::string& str) {
    const auto start = str.find_first_not_of(detail::kWhitespace);
    if (start == std::string::npos) str.clear();
    else if (start > 0) str.erase(0, start);
}

constexpr void rtrimInPlace(std::string& str) {
    const auto end = str.find_last_not_of(detail::kWhitespace);
    if (end == std::string::npos) str.clear();
    else str.erase(end + 1);
}

// ============================================================================
// Splitting
// ============================================================================

[[nodiscard]] inline std::vector<std::string> split(std::string_view str,
                                                    char delimiter,
                                                    bool skipEmpty = false) {
    std::vector<std::string> result;
    result.reserve(static_cast<std::size_t>(
                       std::count(str.begin(), str.end(), delimiter)) + 1);

    std::string_view::size_type pos = 0;
    std::string_view::size_type next = str.find(delimiter);
    while (next != std::string_view::npos) {
        if (auto token = str.substr(pos, next - pos); !skipEmpty || !token.empty())
            result.emplace_back(token);
        pos = next + 1;
        next = str.find(delimiter, pos);
    }
    if (auto token = str.substr(pos); !skipEmpty || !token.empty())
        result.emplace_back(token);
    return result;
}

[[nodiscard]] inline std::vector<std::string> split(std::string_view str,
                                                    std::string_view delimiter,
                                                    bool skipEmpty = false) {
    if (delimiter.empty()) {
        if (!skipEmpty || !str.empty()) return {std::string(str)};
        return {};
    }

    std::vector<std::string> result;
    result.reserve(str.size() / (delimiter.size() + 1) + 1);

    std::string_view::size_type pos = 0;
    std::string_view::size_type next = str.find(delimiter);
    while (next != std::string_view::npos) {
        if (auto token = str.substr(pos, next - pos); !skipEmpty || !token.empty())
            result.emplace_back(token);
        pos = next + delimiter.size();
        next = str.find(delimiter, pos);
    }
    if (auto token = str.substr(pos); !skipEmpty || !token.empty())
        result.emplace_back(token);
    return result;
}

// Zero-allocation split — callers must ensure `str` outlives the returned views.
[[nodiscard]] inline std::vector<std::string_view> split_view(std::string_view str,
                                                              char delimiter,
                                                              bool skipEmpty = false) {
    std::vector<std::string_view> result;
    result.reserve(static_cast<std::size_t>(
                       std::count(str.begin(), str.end(), delimiter)) + 1);

    std::string_view::size_type pos = 0;
    std::string_view::size_type next = str.find(delimiter);
    while (next != std::string_view::npos) {
        if (auto token = str.substr(pos, next - pos); !skipEmpty || !token.empty())
            result.emplace_back(token);
        pos = next + 1;
        next = str.find(delimiter, pos);
    }
    if (auto token = str.substr(pos); !skipEmpty || !token.empty())
        result.emplace_back(token);
    return result;
}

[[nodiscard]] inline std::vector<std::string_view> split_view(std::string_view str,
                                                              std::string_view delimiter,
                                                              bool skipEmpty = false) {
    if (delimiter.empty()) {
        if (!skipEmpty || !str.empty()) return {str};
        return {};
    }

    std::vector<std::string_view> result;
    result.reserve(str.size() / (delimiter.size() + 1) + 1);

    std::string_view::size_type pos = 0;
    std::string_view::size_type next = str.find(delimiter);
    while (next != std::string_view::npos) {
        if (auto token = str.substr(pos, next - pos); !skipEmpty || !token.empty())
            result.emplace_back(token);
        pos = next + delimiter.size();
        next = str.find(delimiter, pos);
    }
    if (auto token = str.substr(pos); !skipEmpty || !token.empty())
        result.emplace_back(token);
    return result;
}

// ============================================================================
// Joining
// ============================================================================

template <typename Range>
[[nodiscard]] std::string join(const Range& parts, std::string_view delimiter) {
    auto it = std::begin(parts);
    const auto end = std::end(parts);
    if (it == end) return {};

    std::size_t n = 1;
    std::size_t total = static_cast<std::size_t>(it->size());
    for (auto p = std::next(it); p != end; ++p) {
        total += static_cast<std::size_t>(p->size());
        ++n;
    }
    if (n > 1) total += delimiter.size() * (n - 1);

    std::string result;
    result.reserve(total);
    result.append(*it);
    for (++it; it != end; ++it) {
        result.append(delimiter);
        result.append(*it);
    }
    return result;
}

// ============================================================================
// Prefix / suffix / contains
// ============================================================================

[[nodiscard]] constexpr bool startsWith(std::string_view str,
                                        std::string_view prefix) noexcept {
    return str.starts_with(prefix);
}

[[nodiscard]] constexpr bool endsWith(std::string_view str,
                                      std::string_view suffix) noexcept {
    return str.ends_with(suffix);
}

[[nodiscard]] constexpr bool contains(std::string_view str,
                                      std::string_view sub) noexcept {
    return str.find(sub) != std::string_view::npos;
}

[[nodiscard]] constexpr bool contains(std::string_view str, char ch) noexcept {
    return str.find(ch) != std::string_view::npos;
}

// ============================================================================
// Replace
// ============================================================================

[[nodiscard]] inline std::string replaceAll(std::string_view str,
                                            std::string_view from,
                                            std::string_view to) {
    if (from.empty()) return std::string(str);

    std::size_t matchCount = 0;
    for (std::string_view::size_type pos = 0;
         (pos = str.find(from, pos)) != std::string_view::npos;
         pos += from.size())
        ++matchCount;

    // Exact capacity using signed arithmetic to avoid underflow when
    // to.size() < from.size().
    const long long delta =
        static_cast<long long>(to.size()) - static_cast<long long>(from.size());
    const long long total_signed =
        static_cast<long long>(str.size()) +
        delta * static_cast<long long>(matchCount);
    const std::size_t total_size = static_cast<std::size_t>(total_signed);

    std::string result;
    result.reserve(total_size);

    std::string_view::size_type last = 0;
    std::string_view::size_type pos = 0;
    while ((pos = str.find(from, last)) != std::string_view::npos) {
        result.append(str.data() + last, pos - last);
        result.append(to);
        last = pos + from.size();
    }
    result.append(str.data() + last, str.size() - last);
    return result;
}

inline std::string& replaceAllInPlace(std::string& str,
                                      std::string_view from,
                                      std::string_view to) {
    if (from.empty()) return str;
    std::string::size_type pos = 0;
    while ((pos = str.find(from, pos)) != std::string::npos) {
        str.replace(pos, from.size(), to);
        pos += to.size();
    }
    return str;
}

[[nodiscard]] constexpr std::string replaceAll(std::string_view str,
                                               char from, char to) {
    std::string result(str);
    std::ranges::replace(result, from, to);
    return result;
}

constexpr std::string& replaceAllInPlace(std::string& str, char from, char to) {
    std::ranges::replace(str, from, to);
    return str;
}

// ============================================================================
// Miscellaneous
// ============================================================================

[[nodiscard]] constexpr std::string repeat(std::string_view str, std::size_t n) {
    std::string result;
    result.reserve(str.size() * n);
    for (std::size_t i = 0; i < n; ++i) result.append(str);
    return result;
}

}  // namespace StringUtils

#endif  // STRING_UTILS_HPP