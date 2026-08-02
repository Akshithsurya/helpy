
#ifndef SERIALIZATION_HPP
#define SERIALIZATION_HPP

#include "json_utils.hpp"
#include <string>

namespace Serialization {

// Serialize plan data to JSON
std::string toJson(const JsonUtils::JsonValue&amp; data);

// Serialize plan data to compact JSON
std::string toCompactJson(const JsonUtils::JsonValue&amp; data);

// Deserialize JSON to plan data
JsonUtils::JsonValue fromJson(const std::string&amp; json);

// Safe deserialization with error handling
JsonUtils::JsonValue fromJsonSafe(const std::string&amp; json, bool&amp; success);

} // namespace Serialization

#endif // SERIALIZATION_HPP
