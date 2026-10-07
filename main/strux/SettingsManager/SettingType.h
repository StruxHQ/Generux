#pragma once

#include <cstdint>

// Grows rarely. Every switch over it has NO default case, so (with
// -Werror=switch) adding a type here breaks the build at every converter
// that hasn't been updated — exactly what we want.
enum class SettingType : uint8_t { String, Int32, UInt32, Float, Bool };

// Presentation hints a setting carries, declared beside it. They are advisory:
// `settings list` reports every setting with its value and its flags, and whatever
// draws the list decides what to do with them. Anything that can run a command is
// already trusted to read and write every setting.
//   Hidden - a client should not draw it (a value the user never needs to see)
//   Secret - a client should draw it masked (a credential the user may replace)
enum class SettingFlags : uint8_t { None = 0, Hidden = 1, Secret = 2 };

constexpr SettingFlags operator|(SettingFlags a, SettingFlags b)
{
    return static_cast<SettingFlags>(static_cast<uint8_t>(a) | static_cast<uint8_t>(b));
}

constexpr bool operator&(SettingFlags a, SettingFlags b)
{
    return (static_cast<uint8_t>(a) & static_cast<uint8_t>(b)) != 0;
}

// One place for the names; used by Setting::Die(), the UI converter, logs.
// The trailing return is NOT a default case — -Wswitch still flags a missing
// enum value; the trailing return only satisfies -Wreturn-type.
constexpr const char* SettingTypeToString(SettingType type)
{
    switch (type)
    {
    case SettingType::String: return "string";
    case SettingType::Int32:  return "int32";
    case SettingType::UInt32: return "uint32";
    case SettingType::Float:  return "float";
    case SettingType::Bool:   return "bool";
    }
    return "?";
}
