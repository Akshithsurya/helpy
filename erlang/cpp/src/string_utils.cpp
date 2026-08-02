#ifndef STRING_UTILS_HPP
#define STRING_UTILS_HPP

#include <string>
#include <string_view>
#include <vector>
#include <algorithm>
#include <cctype>
#include <numeric>

namespace StringUtils {



namespace detail {
    constexpr std::string_view kWhitespace = " \t\n\r\f\v";
}


[[nodiscard]] inline std::string toLower(std::string_view str) {
    std::string result(str);
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) noexcept {
                       return static_cast<char>(std::tolower(c));
                   });
    return result;
}

[[nodiscard]] inline std::string toUpper(std::string_view str) {
    std::string result(str);
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) noexcept {
                       return static_cast<char>(std::toupper(c));
                   });
    return result;
}

inline void toLowerInPlace(std::string& str) {
    std::transform(str.begin(), str.end(), str.begin(),
                   [](unsigned char c) noexcept {
                       return static_cast<char>(std::tolower(c));
                   });
}

inline void toUpperInPlace(std::string& str) {
    std::transform(str.begin(), str.end(), str.begin(),
                   [](unsigned char c) noexcept {
                       return static_cast<char>(std::toupper(c));
                   });
}

// ---- Trimming ----

[[nodiscard]] inline std::string_view trim_view(std::string_view str) noexcept {
    const auto start = str.find_first_not_of(detail::kWhitespace);
    if (start == std::string_view::npos) return {};
    const auto end = str.find_last_not_of(detail::kWhitespace);
    return str.substr(start, end - start + 1);
}

[[nodiscard]] inline std::string trim(std::string_view str) {
    return std::string(trim_view(str));
}

[[nodiscard]] inline std::string_view ltrim_view(std::string_view str) noexcept {
    const auto start = str.find_first_not_of(detail::kWhitespace);
    return start == std::string_view::npos ? std::string_view{} : str.substr(start);
}

[[nodiscard]] inline std::string ltrim(std::string_view str) {
    return std::string(ltrim_view(str));
}

[[nodiscard]] inline std::string_view rtrim_view(std::string_view str) noexcept {
    const auto end = str.find_last_not_of(detail::kWhitespace);
    return end == std::string_view::npos ? std::string_view{} : str.substr(0, end + 1);
}

[[nodiscard]] inline std::string rtrim(std::string_view str) {
    return std::string(rtrim_view(str));
}

inline void trimInPlace(std::string& str) {
    const auto end = str.find_last_not_of(detail::kWhitespace);
    if (end == std::string::npos) { str.clear(); return; }
    str.erase(end + 1);
    str.erase(0, str.find_first_not_of(detail::kWhitespace));
}

// ---- Splitting ----

[[nodiscard]] inline std::vector<std::string> split(std::string_view str,
                                                    char delimiter,
                                                    bool skipEmpty = false) {
    std::vector<std::string> result;
    const auto approx = static_cast<std::size_t>(
        std::count(str.begin(), str.end(), delimiter)) + 1;
    result.reserve(approx);

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
        return {std::string(str)};
    }

    std::vector<std::string> result;
    const auto approx = str.size() / (delimiter.size() + 1) + 1;
    result.reserve(approx);

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
    const auto approx = static_cast<std::size_t>(
        std::count(str.begin(), str.end(), delimiter)) + 1;
    result.reserve(approx);

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
        return {str};
    }

    std::vector<std::string_view> result;
    const auto approx = str.size() / (delimiter.size() + 1) + 1;
    result.reserve(approx);

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

// ---- Joining ----

template <typename Range>
[[nodiscard]] std::string join(const Range& parts, std::string_view delimiter) {
    auto it = std::begin(parts);
    const auto end = std::end(parts);
    if (it == end) return {};

    // Single pass: count elements and total character length.
    std::size_t n = 1;
    std::size_t total = it->size();
    for (auto p = std::next(it); p != end; ++p) {
        total += p->size();
        ++n;
    }
    total += delimiter.size() * (n - 1);

    std::string result;
    result.reserve(total);
    result.append(*it);
    for (++it; it != end; ++it) {
        result.append(delimiter);
        result.append(*it);
    }
    return result;
}

// ---- Prefix / suffix / contains ----

[[nodiscard]] inline bool startsWith(std::string_view str, std::string_view prefix) noexcept {
    return str.size() >= prefix.size() &&
           str.compare(0, prefix.size(), prefix) == 0;
}

[[nodiscard]] inline bool endsWith(std::string_view str, std::string_view suffix) noexcept {
    return str.size() >= suffix.size() &&
           str.compare(str.size() - suffix.size(), suffix.size(), suffix) == 0;
}

[[nodiscard]] inline bool contains(std::string_view str, std::string_view sub) noexcept {
    return str.find(sub) != std::string_view::npos;
}

[[nodiscard]] inline bool contains(std::string_view str, char ch) noexcept {
    return str.find(ch) != std::string_view::npos;
}

// ---- Replace ----

[[nodiscard]] inline std::string replaceAll(std::string_view str,
                                            std::string_view from,
                                            std::string_view to) {
    if (from.empty()) return std::string(str);

    // Count matches for accurate reservation.
    std::size_t matchCount = 0;
    for (std::string_view::size_type pos = 0;
         (pos = str.find(from, pos)) != std::string_view::npos;
         pos += from.size()) {
        ++matchCount;
    }

    // Calculate exact required size for single allocation
    const std::size_t total_size = str.size() + static_cast<std::size_t>(static_cast<long long>(to.size()) - static_cast<long long>(from.size())) * matchCount;
    std::string result;
    result.reserve(total_size);

    std::string_view::size_type last = 0;
    std::string_view::size_type pos = 0;
    while ((pos = str.find(from, last)) != std::string_view::npos) {
        result.append(str.substr(last, pos - last));
        result.append(to);
        last = pos + from.size();
    }
    result.append(str.substr(last));
    return result;
}

// Single-character replace-all — optimized for efficiency with std::replace
[[nodiscard]] inline std::string replaceAll(std::string_view str, char from, char to) {
    std::string result(str);
    std::ranges::replace(result, from, to);
    return result;
}
} // namespace StringUtils

#endif // STRING_UTILS_HPP