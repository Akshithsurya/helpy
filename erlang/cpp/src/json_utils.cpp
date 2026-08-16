#include "json_utils.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <optional>
#include <ostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>

// Requires C++17 (std::to_chars, std::from_chars, std::optional,
// [[nodiscard]], [[maybe_unused]], structured bindings).

namespace JsonUtils {

namespace {

constexpr int kMaxDepth = 1000;
static_assert(kMaxDepth > 0, "kMaxDepth must be positive");

// --- Compiler portability helpers -----------------------------------------

#if defined(__GNUC__) || defined(__clang__)
#  define JSON_LIKELY(x)     __builtin_expect(!!(x), 1)
#  define JSON_UNLIKELY(x)   __builtin_expect(!!(x), 0)
#  define JSON_UNREACHABLE() __builtin_unreachable()
#  define JSON_COLD          [[gnu::cold]]
#elif defined(_MSC_VER)
#  define JSON_LIKELY(x)     (x)
#  define JSON_UNLIKELY(x)   (x)
#  define JSON_UNREACHABLE() __assume(false)
#  define JSON_COLD
#else
#  define JSON_LIKELY(x)     (x)
#  define JSON_UNLIKELY(x)   (x)
#  define JSON_UNREACHABLE() (void)0
#  define JSON_COLD
#endif

constexpr char kHex[] = "0123456789abcdef";

// --- Output adapters ------------------------------------------------------
// Lightweight writer abstraction targeting std::string AND std::ostream
// with zero virtual-dispatch overhead.

struct StringWriter {
    std::string& str;
    void put(char c)                         { str.push_back(c); }
    void write(const char* s, std::size_t n) { str.append(s, n); }
};

struct OStreamWriter {
    std::ostream& os;
    void put(char c)                         { os.put(c); }
    void write(const char* s, std::size_t n) {
        os.write(s, static_cast<std::streamsize>(n));
    }
};

// --- Serialization --------------------------------------------------------

template <typename Writer>
void escapeStringTo(Writer& w, std::string_view s) {
    const char* const data = s.data();
    const std::size_t n    = s.size();

    std::size_t i = 0;
    while (i < n) {
        // Fast scan: bulk-copy runs of ordinary characters, stopping at
        // '"', '\\', or a control byte (< 0x20).
        const std::size_t run_start = i;
        while (i < n) {
            const unsigned char c = static_cast<unsigned char>(data[i]);
            if (c < 0x20 || c == '"' || c == '\\')
                break;
            ++i;
        }
        if (i > run_start)
            w.write(data + run_start, i - run_start);
        if (i >= n)
            break;

        const unsigned char c = static_cast<unsigned char>(data[i++]);
        switch (c) {
            case '"':  w.write("\\\"", 2); break;
            case '\\': w.write("\\\\", 2); break;
            case '\b': w.write("\\b",  2); break;
            case '\f': w.write("\\f",  2); break;
            case '\n': w.write("\\n",  2); break;
            case '\r': w.write("\\r",  2); break;
            case '\t': w.write("\\t",  2); break;
            default: {  // control character 0x00–0x1F → \u00XX
                const char buf[6] = {'\\', 'u', '0', '0',
                                     kHex[c >> 4], kHex[c & 0xF]};
                w.write(buf, 6);
                break;
            }
        }
    }
}

// Cache-aligned 128-byte block of spaces; covers indent ≤ 128 in one write.
alignas(64) constexpr char kSpaces[128] = {
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',' ',
};
static_assert(sizeof(kSpaces) == 128, "kSpaces must be 128 bytes");

template <typename Writer>
void writeIndent(Writer& w, int indent, int level) {
    if (indent <= 0)
        return;
    w.put('\n');
    const std::size_t total =
        static_cast<std::size_t>(level) * static_cast<std::size_t>(indent);
    std::size_t remaining = total;
    while (remaining > 0) {
        const std::size_t chunk = std::min(remaining, std::size_t{128});
        w.write(kSpaces, chunk);
        remaining -= chunk;
    }
}

template <typename Writer>
void serializeImpl(Writer& w, const JsonValue& val, int indent, int level) {
    // Leaf types: no depth check needed — they cannot recurse.
    if (val.isNull()) {
        w.write("null", 4);
    } else if (val.isBool()) {
        if (val.asBool()) w.write("true",  4);
        else              w.write("false", 5);
    } else if (val.isInt()) {
        char buf[32];
        const auto res = std::to_chars(buf, buf + sizeof(buf), val.asInt());
        w.write(buf, static_cast<std::size_t>(res.ptr - buf));
    } else if (val.isDouble()) {
        const double d = val.asDouble();
        // NaN / Infinity are not representable in JSON (RFC 8259 §6).
        if (JSON_UNLIKELY(!std::isfinite(d)))
            throw std::runtime_error(
                "JSON serialize: NaN/Infinity not representable");
        char buf[64];
        const auto res = std::to_chars(buf, buf + sizeof(buf), d);
        w.write(buf, static_cast<std::size_t>(res.ptr - buf));
    } else if (val.isString()) {
        w.put('"');
        escapeStringTo(w, val.asString());
        w.put('"');
    } else if (val.isArray()) {
        if (JSON_UNLIKELY(level > kMaxDepth))
            throw std::runtime_error(
                "JSON serialize: maximum nesting depth exceeded");
        const auto& arr = val.asArray();
        if (arr.empty()) { w.write("[]", 2); return; }
        w.put('[');
        for (std::size_t i = 0; i < arr.size(); ++i) {
            if (i > 0) w.put(',');
            writeIndent(w, indent, level + 1);
            serializeImpl(w, arr[i], indent, level + 1);
        }
        writeIndent(w, indent, level);
        w.put(']');
    } else {
        // Object — the only remaining alternative.
        if (JSON_UNLIKELY(level > kMaxDepth))
            throw std::runtime_error(
                "JSON serialize: maximum nesting depth exceeded");
        const auto& obj = val.asObject();
        if (obj.empty()) { w.write("{}", 2); return; }
        const std::string_view sep = (indent > 0) ? "\": " : "\":";
        w.put('{');
        std::size_t i = 0;
        for (const auto& [key, value] : obj) {
            if (i > 0) w.put(',');
            writeIndent(w, indent, level + 1);
            w.put('"');
            escapeStringTo(w, key);
            w.write(sep.data(), sep.size());
            serializeImpl(w, value, indent, level + 1);
            ++i;
        }
        writeIndent(w, indent, level);
        w.put('}');
    }
}

// --- Parsing (recursive descent) ------------------------------------------

class JsonParser {
public:
    explicit JsonParser(std::string_view text) noexcept
        : text_(text) {}

    [[nodiscard]] JsonValue parse() {
        skipWhitespace();
        JsonValue v = parseValue(0);
        skipWhitespace();
        if (pos_ != text_.size())
            fail("trailing characters after value");
        return v;
    }

private:
    std::string_view text_;
    std::size_t pos_ = 0;

    JSON_COLD [[noreturn]] void fail(std::string_view msg) const {
        std::size_t line = 1, col = 1;
        for (std::size_t i = 0; i < pos_ && i < text_.size(); ++i) {
            if (text_[i] == '\n') { ++line; col = 1; }
            else                  { ++col; }
        }

        const std::size_t ctx_before = std::min(pos_, std::size_t{12});
        const std::size_t ctx_after  =
            std::min(text_.size() - pos_, std::size_t{12});

        std::string err;
        err.reserve(96 + msg.size() + ctx_before + ctx_after);
        err += "JSON parse error at line ";
        appendNumber(err, line);
        err += ", column ";
        appendNumber(err, col);
        err += " (offset ";
        appendNumber(err, pos_);
        err += "): ";
        err += msg;
        err += " -- near \"";
        err += text_.substr(pos_ - ctx_before, ctx_before + ctx_after);
        err += '"';

        throw JsonParseError(std::move(err), line, col, pos_);
    }

    // Append an unsigned integer using to_chars — avoids std::to_string
    // allocations on the cold error path.
    static void appendNumber(std::string& out, std::size_t v) {
        char buf[24];
        const auto res = std::to_chars(buf, buf + sizeof(buf), v);
        out.append(buf, static_cast<std::size_t>(res.ptr - buf));
    }

    [[nodiscard]] char peek() const {
        if (JSON_UNLIKELY(pos_ >= text_.size()))
            fail("unexpected end of input");
        return text_[pos_];
    }

    [[nodiscard]] char next() {
        if (JSON_UNLIKELY(pos_ >= text_.size()))
            fail("unexpected end of input");
        return text_[pos_++];
    }

    void expect(char c) {
        if (JSON_UNLIKELY(next() != c)) {
            std::string msg = "expected '";
            msg += c;
            msg += '\'';
            fail(msg);
        }
    }

    [[nodiscard]] bool match(char c) noexcept {
        if (pos_ < text_.size() && text_[pos_] == c) {
            ++pos_;
            return true;
        }
        return false;
    }

    // Caller has already verified the first byte in parseValue()'s switch,
    // so we memcmp only the remaining bytes — saving one byte of comparison.
    [[nodiscard]] bool matchLiteral(std::string_view expected) noexcept {
        const std::size_t sz = expected.size();
        if (pos_ + sz > text_.size())
            return false;
        if (sz > 1 &&
            std::memcmp(text_.data() + pos_ + 1,
                        expected.data() + 1, sz - 1) != 0)
            return false;
        pos_ += sz;
        return true;
    }

    void skipWhitespace() noexcept {
        while (pos_ < text_.size()) {
            const char c = text_[pos_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r')
                ++pos_;
            else
                break;
        }
    }

    void requireAndScanDigits(const char* errMsg) {
        if (JSON_UNLIKELY(pos_ >= text_.size() ||
                          text_[pos_] < '0' || text_[pos_] > '9'))
            fail(errMsg);
        while (pos_ < text_.size() &&
               text_[pos_] >= '0' && text_[pos_] <= '9')
            ++pos_;
    }

    // --- Value dispatch ---------------------------------------------------
    // Depth check is deferred to parseObject/parseArray so that leaf values
    // (numbers, strings, booleans, null) skip the branch entirely.
    JsonValue parseValue(int depth) {
        skipWhitespace();
        const char c = peek();
        switch (c) {
            case '{':  return parseObject(depth);
            case '[':  return parseArray(depth);   // was '[[' — fixed
            case '"':  return JsonValue(parseString());
            case 't':
                if (JSON_UNLIKELY(!matchLiteral("true")))
                    fail("expected literal 'true'");
                return JsonValue(true);
            case 'f':
                if (JSON_UNLIKELY(!matchLiteral("false")))
                    fail("expected literal 'false'");
                return JsonValue(false);
            case 'n':
                if (JSON_UNLIKELY(!matchLiteral("null")))
                    fail("expected literal 'null'");
                return JsonValue();
            default:
                if (c == '-' || (c >= '0' && c <= '9'))
                    return parseNumber();
                failUnexpectedChar(c);
        }
        JSON_UNREACHABLE();
        return JsonValue();  // silence "not all paths return"
    }

    JSON_COLD [[noreturn]] void failUnexpectedChar(char c) const {
        const unsigned char uc = static_cast<unsigned char>(c);
        std::string msg;
        msg.reserve(40);
        msg += "unexpected character '";
        msg += c;
        msg += "' (0x";
        msg += kHex[uc >> 4];
        msg += kHex[uc & 0xF];
        msg += ')';
        fail(msg);
    }

    JsonValue parseObject(int depth) {
        if (JSON_UNLIKELY(depth > kMaxDepth))
            fail("maximum nesting depth exceeded");
        expect('{');
        skipWhitespace();
        JsonObject obj;
        if (match('}'))
            return JsonValue(std::move(obj));
        for (;;) {
            skipWhitespace();
            if (JSON_UNLIKELY(peek() != '"'))
                fail("expected string key");
            std::string key = parseString();
            skipWhitespace();
            expect(':');
            // Duplicate keys are preserved in insertion order.
            // RFC 8259 §4: names "SHOULD be unique".
            obj.emplace_back(std::move(key), parseValue(depth + 1));
            skipWhitespace();
            const char c = next();
            if (c == ',') continue;
            if (c == '}') break;
            fail("expected ',' or '}' after object member");
        }
        return JsonValue(std::move(obj));
    }

    JsonValue parseArray(int depth) {
        if (JSON_UNLIKELY(depth > kMaxDepth))
            fail("maximum nesting depth exceeded");
        expect('[');
        skipWhitespace();
        JsonArray arr;
        if (match(']'))
            return JsonValue(std::move(arr));
        for (;;) {
            arr.push_back(parseValue(depth + 1));
            skipWhitespace();
            const char c = next();
            if (c == ',') continue;
            if (c == ']') break;
            fail("expected ',' or ']' after array element");
        }
        return JsonValue(std::move(arr));
    }

    std::string parseString() {
        expect('"');
        std::string out;
        out.reserve(std::min(text_.size() - pos_, std::size_t{1024}));

        for (;;) {
            // Fast scan: bulk-copy runs of ordinary characters, stopping at
            // '"', '\\', or a control byte (< 0x20).
            const std::size_t run_start = pos_;
            while (pos_ < text_.size()) {
                const unsigned char c =
                    static_cast<unsigned char>(text_[pos_]);
                if (c == '"' || c == '\\' || c < 0x20)
                    break;
                ++pos_;
            }
            if (pos_ > run_start)
                out.append(text_.data() + run_start, pos_ - run_start);

            if (JSON_UNLIKELY(pos_ >= text_.size()))
                fail("unterminated string");

            const char c = text_[pos_++];
            if (c == '"')
                break;
            // Any byte < 0x20 that isn't '"' or '\\' is an unescaped control
            // character — illegal per RFC 8259 §7.
            if (c != '\\')
                fail("unescaped control character in string");

            const char esc = next();
            switch (esc) {
                case '"':  out.push_back('"');  break;
                case '\\': out.push_back('\\'); break;
                case '/':  out.push_back('/');  break;
                case 'b':  out.push_back('\b'); break;
                case 'f':  out.push_back('\f'); break;
                case 'n':  out.push_back('\n'); break;
                case 'r':  out.push_back('\r'); break;
                case 't':  out.push_back('\t'); break;
                case 'u': {
                    const unsigned code = parseHex4();
                    unsigned cp = code;
                    if (code >= 0xD800 && code <= 0xDBFF) {  // high surrogate
                        // Lookahead for \uXXXX without consuming — leaves
                        // parser in a cleaner state on malformed input.
                        if (JSON_UNLIKELY(pos_ + 6 > text_.size() ||
                                          text_[pos_]     != '\\' ||
                                          text_[pos_ + 1] != 'u'))
                            fail("expected \\u low surrogate after high surrogate");
                        pos_ += 2;
                        const unsigned low = parseHex4();
                        if (JSON_UNLIKELY(low < 0xDC00 || low > 0xDFFF))
                            fail("invalid low surrogate");
                        cp = 0x10000 + ((code - 0xD800) << 10)
                                   + (low - 0xDC00);
                    } else if (code >= 0xDC00 && code <= 0xDFFF) {
                        fail("unexpected low surrogate without preceding high surrogate");
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default:
                    failInvalidEscape(esc);
            }
        }
        return out;
    }

    JSON_COLD [[noreturn]] void failInvalidEscape(char esc) const {
        std::string msg;
        msg.reserve(32);
        msg += "invalid string escape '\\";
        msg += esc;
        msg += '\'';
        fail(msg);
    }

    unsigned parseHex4() {
        if (JSON_UNLIKELY(pos_ + 4 > text_.size()))
            fail("invalid \\u escape: expected 4 hex digits");
        unsigned value = 0;
        const auto res = std::from_chars(
            text_.data() + pos_, text_.data() + pos_ + 4, value, 16);
        if (JSON_UNLIKELY(res.ptr != text_.data() + pos_ + 4))
            fail("invalid hex digit in \\u escape");
        pos_ += 4;
        return value;
    }

    static void appendUtf8(std::string& out, unsigned cp) {
        // RFC 3629: valid codepoints U+0000..U+10FFFF excluding surrogates.
        char buf[4];
        std::size_t n;
        if (cp < 0x80) {
            buf[0] = static_cast<char>(cp);
            n = 1;
        } else if (cp < 0x800) {
            buf[0] = static_cast<char>(0xC0 | (cp >> 6));
            buf[1] = static_cast<char>(0x80 | (cp & 0x3F));
            n = 2;
        } else if (cp < 0x10000) {
            buf[0] = static_cast<char>(0xE0 | (cp >> 12));
            buf[1] = static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            buf[2] = static_cast<char>(0x80 | (cp & 0x3F));
            n = 3;
        } else if (cp <= 0x10FFFF) {
            buf[0] = static_cast<char>(0xF0 | (cp >> 18));
            buf[1] = static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            buf[2] = static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            buf[3] = static_cast<char>(0x80 | (cp & 0x3F));
            n = 4;
        } else {
            // Unreachable via valid \uXXXX — emit U+FFFD replacement char.
            out.append("\xEF\xBF\xBD", 3);
            return;
        }
        out.append(buf, n);
    }

    JsonValue parseNumber() {
        const std::size_t start = pos_;

        // Optional minus sign.
        if (pos_ < text_.size() && text_[pos_] == '-')
            ++pos_;

        // Integer part: at least one digit required.
        if (JSON_UNLIKELY(pos_ >= text_.size() ||
                          text_[pos_] < '0' || text_[pos_] > '9'))
            fail("invalid number: expected digit after sign");

        // JSON forbids leading zeros (e.g. "01"), per RFC 8259 §6.
        if (text_[pos_] == '0') {
            ++pos_;
        } else {
            while (pos_ < text_.size() &&
                   text_[pos_] >= '0' && text_[pos_] <= '9')
                ++pos_;
        }

        bool is_double = false;

        // Fractional part.
        if (pos_ < text_.size() && text_[pos_] == '.') {
            is_double = true;
            ++pos_;
            requireAndScanDigits(
                "invalid number: expected digit after decimal point");
        }

        // Exponent.
        if (pos_ < text_.size() &&
            (text_[pos_] == 'e' || text_[pos_] == 'E')) {
            is_double = true;
            ++pos_;
            if (pos_ < text_.size() &&
                (text_[pos_] == '+' || text_[pos_] == '-'))
                ++pos_;
            requireAndScanDigits(
                "invalid number: expected digit in exponent");
        }

        const std::string_view num = text_.substr(start, pos_ - start);

        if (is_double) {
            double value;
            const auto res = std::from_chars(
                num.data(), num.data() + num.size(), value);
            if (res.ec != std::errc())
                fail("invalid number");
            return JsonValue(value);
        }

        // Try integer first; fall back to double on overflow.
        long long ivalue;
        const auto ires = std::from_chars(
            num.data(), num.data() + num.size(), ivalue);
        if (ires.ec == std::errc::result_out_of_range) {
            double dvalue;
            const auto dres = std::from_chars(
                num.data(), num.data() + num.size(), dvalue);
            if (dres.ec != std::errc())
                fail("invalid number");
            return JsonValue(dvalue);
        }
        if (ires.ec != std::errc())
            fail("invalid number");
        return JsonValue(ivalue);
    }
};

}  // namespace

// --- JsonValue helper methods ---------------------------------------------

std::size_t JsonValue::size() const noexcept {
    switch (type_) {
        case Type::Array:  return arr_.size();
        case Type::Object: return obj_.size();
        default:           return 0;
    }
}

bool JsonValue::empty() const noexcept {
    return size() == 0;
}

const JsonValue& JsonValue::operator[](std::size_t i) const {
    return arr_[i];
}

JsonValue& JsonValue::operator[](std::size_t i) {
    return arr_[i];
}

const JsonValue* JsonValue::find(std::string_view key) const noexcept {
    if (type_ != Type::Object) return nullptr;
    for (const auto& [k, v] : obj_) {
        if (k == key)
            return &v;
    }
    return nullptr;
}

JsonValue* JsonValue::find(std::string_view key) noexcept {
    if (type_ != Type::Object) return nullptr;
    for (auto& [k, v] : obj_) {
        if (k == key)
            return &v;
    }
    return nullptr;
}

bool JsonValue::contains(std::string_view key) const noexcept {
    return find(key) != nullptr;
}

const JsonValue& JsonValue::at(std::string_view key) const {
    const auto* p = find(key);
    if (!p)
        throw std::out_of_range("JsonValue::at: key not found");
    return *p;
}

JsonValue& JsonValue::operator[](std::string_view key) {
    if (type_ != Type::Object)
        throw std::runtime_error("JsonValue::operator[]: not an object");
    if (auto* p = find(key))
        return *p;
    obj_.emplace_back(std::string(key), JsonValue());
    return obj_.back().second;
}

bool JsonValue::equals(const JsonValue& other) const noexcept {
    if (type_ != other.type_)
        return false;
    switch (type_) {
        case Type::Null:   return true;
        case Type::Bool:   return bool_ == other.bool_;
        case Type::Int:    return int_ == other.int_;
        case Type::Double: return dbl_ == other.dbl_;
        case Type::String: return str_ == other.str_;
        case Type::Array:  return arr_ == other.arr_;
        case Type::Object: {
            if (obj_.size() != other.obj_.size())
                return false;
            // Order-independent comparison (JSON objects are unordered).
            // Note: does not handle duplicate keys (spec says SHOULD be unique).
            for (const auto& [k, v] : obj_) {
                const auto* ov = other.find(k);
                if (!ov || !v.equals(*ov))
                    return false;
            }
            return true;
        }
    }
    return false;  // unreachable
}

// --- Checked conversions --------------------------------------------------

long long JsonValue::toInt(long long fallback) const noexcept {
    if (isInt())    return int_;
    if (isDouble()) return static_cast<long long>(dbl_);
    return fallback;
}

double JsonValue::toDouble(double fallback) const noexcept {
    if (isDouble()) return dbl_;
    if (isInt())    return static_cast<double>(int_);
    return fallback;
}

bool JsonValue::toBool(bool fallback) const noexcept {
    return isBool() ? bool_ : fallback;
}

std::string JsonValue::toString(const std::string& fallback) const {
    return isString() ? str_ : fallback;
}

// --- Public API -----------------------------------------------------------

std::string JsonValue::serialize(int indent) const {
    std::string result;
    result.reserve(256);
    StringWriter w{result};
    serializeImpl(w, *this, indent, 0);
    return result;
}

std::string serialize(const JsonValue& val, int indent) {
    return val.serialize(indent);
}

// NOTE: appends to `out`; does not clear it first.  This allows chaining
// multiple serializations into a pre-allocated buffer.
void serializeTo(std::string& out, const JsonValue& val, int indent) {
    StringWriter w{out};
    serializeImpl(w, val, indent, 0);
}

void serializeTo(std::ostream& os, const JsonValue& val, int indent) {
    OStreamWriter w{os};
    serializeImpl(w, val, indent, 0);
}

std::ostream& operator<<(std::ostream& os, const JsonValue& val) {
    serializeTo(os, val, 0);
    return os;
}

JsonValue parseJson(std::string_view json) {
    JsonParser parser(json);
    return parser.parse();
}

std::optional<JsonValue> tryParseJson(std::string_view json) {
    try {
        return parseJson(json);
    } catch (const JsonParseError&) {
        return std::nullopt;
    }
}

}  // namespace JsonUtils