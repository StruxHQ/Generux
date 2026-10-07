#include "check.h"
#include "CommandArgs.h"

// Decoding a command's declared arguments out of its JSON envelope. Host-testable
// because CommandArgs.h names no layer: no stream, no transport, no board. What is
// checked here is the part a device cannot easily be made to demonstrate -- a value
// exactly on its length limit, an explicit zero told apart from an absent argument,
// a required argument hidden behind an undeclared one.

namespace
{
    constexpr CommandArg<const char*> labelArg{ "partition", "Partition label.", 16 };
    constexpr CommandArg<uint32_t>    offsetArg{ "offset", "Byte offset.", Presence::Optional };
    constexpr CommandArg<bool>        restartArg{ "restart", "Reboot now.", Presence::Optional };
    constexpr CommandArg<int32_t>     trimArg{ "trim", "Signed trim.", Presence::Optional };
    constexpr CommandArg<float>       voltageArg{ "voltage", "Volts.", Presence::Optional };

    const ArgDesc* const kArgs[] = { &labelArg, &offsetArg, &restartArg,
                                     &trimArg, &voltageArg, nullptr };
}

// The decoder rewrites the line it is given, so every case declares its own mutable
// copy rather than sharing one.

TEST(a_required_string_and_an_optional_number_decode)
{
    char line[] = R"({"type":"partition write","partition":"ota_1","offset":4096})";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, kArgs, v, failed) == CommandResult::Ok);
    CHECK(failed == nullptr);
    CHECK(strcmp(v.get<const char*>(0), "ota_1") == 0);
    CHECK(v.has(1));
    CHECK_EQ(v.get<uint32_t>(1), 4096u);
    CHECK(!v.has(2));
}

TEST(an_absent_optional_is_absent_and_an_explicit_zero_is_not)
{
    // The distinction the whole presence/default split exists for: `partition write`
    // has to tell "start at 0" from "the caller said nothing about where to start".
    char absent[] = R"({"partition":"ota_1"})";
    char zero[]   = R"({"partition":"ota_1","offset":0})";
    const char* failed = nullptr;

    ArgValues a;
    CHECK(DecodeJsonArgs(absent, kArgs, a, failed) == CommandResult::Ok);
    CHECK(!a.has(1));
    CHECK_EQ(a.get<uint32_t>(1), 0u);

    ArgValues z;
    CHECK(DecodeJsonArgs(zero, kArgs, z, failed) == CommandResult::Ok);
    CHECK(z.has(1));
    CHECK_EQ(z.get<uint32_t>(1), 0u);
}

TEST(a_missing_required_argument_names_itself)
{
    char line[] = R"({"type":"partition write","offset":0})";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, kArgs, v, failed) == CommandResult::MissingArgument);
    CHECK(failed != nullptr && strcmp(failed, "partition") == 0);
}

TEST(a_string_is_refused_one_character_past_its_declared_length)
{
    // maxLength is the length at which a value is refused, which is the number
    // self-description reports and the one a caller can act on.
    char fits[]  = R"({"partition":"0123456789abcdef"})";        // 16
    char over[]  = R"({"partition":"0123456789abcdefg"})";       // 17
    const char* failed = nullptr;

    ArgValues a;
    CHECK(DecodeJsonArgs(fits, kArgs, a, failed) == CommandResult::Ok);
    CHECK(strcmp(a.get<const char*>(0), "0123456789abcdef") == 0);

    ArgValues b;
    CHECK(DecodeJsonArgs(over, kArgs, b, failed) == CommandResult::ArgumentTooLong);
    CHECK(failed != nullptr && strcmp(failed, "partition") == 0);
}

TEST(an_empty_string_is_a_value_not_an_absence)
{
    // Getting this wrong once turned an explicitly empty password into the string
    // "0" and silently changed what was stored.
    char line[] = R"({"partition":""})";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, kArgs, v, failed) == CommandResult::Ok);
    CHECK(v.has(0));
    CHECK(strcmp(v.get<const char*>(0), "") == 0);
}

TEST(json_null_leaves_an_argument_absent)
{
    char ok[]   = R"({"partition":"ota_1","offset":null})";
    char fail[] = R"({"partition":null})";
    const char* failed = nullptr;

    ArgValues a;
    CHECK(DecodeJsonArgs(ok, kArgs, a, failed) == CommandResult::Ok);
    CHECK(!a.has(1));

    ArgValues b;
    CHECK(DecodeJsonArgs(fail, kArgs, b, failed) == CommandResult::MissingArgument);
}

TEST(numbers_accept_hex_and_refuse_trailing_rubbish)
{
    char hex[]  = R"({"partition":"p","offset":"0x1000"})";
    char junk[] = R"({"partition":"p","offset":"12ab"})";
    const char* failed = nullptr;

    ArgValues a;
    CHECK(DecodeJsonArgs(hex, kArgs, a, failed) == CommandResult::Ok);
    CHECK_EQ(a.get<uint32_t>(1), 0x1000u);

    ArgValues b;
    CHECK(DecodeJsonArgs(junk, kArgs, b, failed) == CommandResult::MalformedNumber);
    CHECK(failed != nullptr && strcmp(failed, "offset") == 0);
}

TEST(signed_and_floating_arguments_round_trip)
{
    char line[] = R"({"partition":"p","trim":-7,"voltage":12.5})";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, kArgs, v, failed) == CommandResult::Ok);
    CHECK_EQ(v.get<int32_t>(3), -7);
    CHECK(v.get<float>(4) > 12.4f && v.get<float>(4) < 12.6f);
}

TEST(a_bool_is_true_only_for_true_or_one)
{
    const char* cases[] = { R"({"partition":"p","restart":true})",
                            R"({"partition":"p","restart":"1"})" };
    for (const char* json : cases)
    {
        char line[128];
        snprintf(line, sizeof(line), "%s", json);
        ArgValues v;
        const char* failed = nullptr;
        CHECK(DecodeJsonArgs(line, kArgs, v, failed) == CommandResult::Ok);
        CHECK(v.get<bool>(2));
    }

    char no[] = R"({"partition":"p","restart":false})";
    ArgValues v;
    const char* failed = nullptr;
    CHECK(DecodeJsonArgs(no, kArgs, v, failed) == CommandResult::Ok);
    CHECK(v.has(2));
    CHECK(!v.get<bool>(2));
}

TEST(undeclared_keys_are_skipped_including_structured_ones)
{
    // "type" is always there and is never an argument; a nested value is never an
    // argument either, because arguments are flat. Neither may hide the ones that are
    // -- a scan that lost its place here would report a missing required argument.
    char line[] = R"({"type":"partition write","extra":{"a":[1,2],"b":"}"},)"
                  R"("partition":"ota_1","tail":[{"x":1}],"offset":9})";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, kArgs, v, failed) == CommandResult::Ok);
    CHECK(strcmp(v.get<const char*>(0), "ota_1") == 0);
    CHECK_EQ(v.get<uint32_t>(1), 9u);
}

TEST(an_escaped_quote_survives_and_does_not_end_the_value)
{
    char line[] = R"({"partition":"a\"b","offset":1})";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, kArgs, v, failed) == CommandResult::Ok);
    CHECK(strcmp(v.get<const char*>(0), "a\"b") == 0);
    CHECK_EQ(v.get<uint32_t>(1), 1u);
}

TEST(a_command_with_no_arguments_decodes_an_ordinary_envelope)
{
    const ArgDesc* const none[] = { nullptr };
    char line[] = R"({"type":"system ping"})";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, none, v, failed) == CommandResult::Ok);
}

TEST(a_line_that_is_not_an_object_is_malformed)
{
    const ArgDesc* const none[] = { nullptr };
    char line[] = "system ping";
    ArgValues v;
    const char* failed = nullptr;

    CHECK(DecodeJsonArgs(line, none, v, failed) == CommandResult::MalformedRequest);
}
