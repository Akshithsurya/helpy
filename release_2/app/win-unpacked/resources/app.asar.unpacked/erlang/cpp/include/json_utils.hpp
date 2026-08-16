
#ifndef JSON_UTILS_HPP
#define JSON_UTILS_HPP

#include &lt;string&gt;
#include &lt;vector&gt;
#include &lt;map&gt;
#include &lt;variant&gt;
#include &lt;sstream&gt;

namespace JsonUtils {

class JsonValue;
using JsonArray = std::vector&lt;JsonValue&gt;;
using JsonObject = std::map&lt;std::string, JsonValue&gt;;

class JsonValue {
public:
    JsonValue() : type_(Type::Null) {}
    JsonValue(std::nullptr_t) : type_(Type::Null) {}
    JsonValue(bool v) : type_(Type::Bool), bool_val_(v) {}
    JsonValue(int v) : type_(Type::Int), int_val_(v) {}
    JsonValue(double v) : type_(Type::Double), double_val_(v) {}
    JsonValue(const std::string&amp; v) : type_(Type::String), string_val_(v) {}
    JsonValue(const char* v) : type_(Type::String), string_val_(v) {}
    JsonValue(const JsonArray&amp; v) : type_(Type::Array), array_val_(v) {}
    JsonValue(const JsonObject&amp; v) : type_(Type::Object), object_val_(v) {}

    bool isNull() const { return type_ == Type::Null; }
    bool isBool() const { return type_ == Type::Bool; }
    bool isInt() const { return type_ == Type::Int; }
    bool isDouble() const { return type_ == Type::Double; }
    bool isString() const { return type_ == Type::String; }
    bool isArray() const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }

    bool asBool() const { return bool_val_; }
    int asInt() const { return isInt() ? int_val_ : (isDouble() ? static_cast&lt;int&gt;(double_val_) : 0); }
    double asDouble() const { return isDouble() ? double_val_ : (isInt() ? static_cast&lt;double&gt;(int_val_) : 0.0); }
    const std::string&amp; asString() const { return string_val_; }
    const JsonArray&amp; asArray() const { return array_val_; }
    JsonArray&amp; asArray() { return array_val_; }
    const JsonObject&amp; asObject() const { return object_val_; }
    JsonObject&amp; asObject() { return object_val_; }

    bool has(const std::string&amp; key) const {
        return isObject() &amp;&amp; object_val_.count(key) &gt; 0;
    }

    const JsonValue&amp; operator[](const std::string&amp; key) const {
        static const JsonValue null_val;
        if (!isObject()) return null_val;
        auto it = object_val_.find(key);
        return it != object_val_.end() ? it-&gt;second : null_val;
    }

    JsonValue&amp; operator[](const std::string&amp; key) {
        if (!isObject()) {
            *this = JsonValue(JsonObject{});
        }
        return object_val_[key];
    }

    void push_back(const JsonValue&amp; val) {
        if (!isArray()) {
            *this = JsonValue(JsonArray{});
        }
        array_val_.push_back(val);
    }

    void set(const std::string&amp; key, const JsonValue&amp; val) {
        if (!isObject()) {
            *this = JsonValue(JsonObject{});
        }
        object_val_[key] = val;
    }

    std::string serialize(int indent = -1) const;

private:
    enum class Type {
        Null, Bool, Int, Double, String, Array, Object
    };

    Type type_;
    bool bool_val_ = false;
    int int_val_ = 0;
    double double_val_ = 0.0;
    std::string string_val_;
    JsonArray array_val_;
    JsonObject object_val_;
};

class JsonBuilder {
public:
    JsonBuilder() {}

    JsonBuilder&amp; add(const std::string&amp; key, const JsonValue&amp; val) {
        object_[key] = val;
        return *this;
    }

    JsonBuilder&amp; add(const std::string&amp; key, const std::string&amp; val) {
        object_[key] = JsonValue(val);
        return *this;
    }

    JsonBuilder&amp; add(const std::string&amp; key, const char* val) {
        object_[key] = JsonValue(val);
        return *this;
    }

    JsonBuilder&amp; add(const std::string&amp; key, int val) {
        object_[key] = JsonValue(val);
        return *this;
    }

    JsonBuilder&amp; add(const std::string&amp; key, double val) {
        object_[key] = JsonValue(val);
        return *this;
    }

    JsonBuilder&amp; add(const std::string&amp; key, bool val) {
        object_[key] = JsonValue(val);
        return *this;
    }

    JsonValue build() const {
        return JsonValue(object_);
    }

private:
    JsonObject object_;
};

JsonValue parseJson(const std::string&amp; json);

}

#endif
