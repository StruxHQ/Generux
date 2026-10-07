#include "check.h"
#include "CommandArgs.h"

// The console codec's request grammar: `led set enabled=true` rather than an
// envelope. Host-testable for the same reason the JSON decoder is -- it names no
// layer -- and worth testing here rather than on a board because what is easy to
// get wrong is the splitting: where a command's name ends, what a quoted value
// does to it, and whether a value that was terminated in place left the scan
// somewhere sensible.

namespace
{
    constexpr CommandArg<const char*> keyArg{ "key", "Setting key.", 16 };
    constexpr CommandArg<const char*> valueArg{ "value", "New value.", 24, Presence::Optional };
    constexpr CommandArg<uint32_t>    offsetArg{ "offset", "Byte offset.", Presence::Optional };
    constexpr CommandArg<bool>        restartArg{ "restart", "Reboot now.", Presence::Optional };

    const ArgDesc* const kArgs[] = { &keyArg, &valueArg, &offsetArg, &restartArg, nullptr };

    // What the envelope does, in one call: split, then decode what is left.
    struct Parsed
    {
        char          name[protocol::MAX_COMMAND_NAME] = {};
        ArgValues     values;
        const char*   failed = nullptr;
        CommandResult result = CommandResult::Ok;
    };

    void Parse(char* line, Parsed& out)
    {
        char* args = SplitConsoleCommand(line, out.name, sizeof(out.name));
        out.result = DecodeConsoleArgs(args, kArgs, out.values, out.failed);
    }
}

// Every case declares its own mutable copy: both halves rewrite the line they are
// given, which is what lets a decoded string point into it.

TEST(a_one_word_command_is_a_command)
{
    char line[] = "help";
    char name[protocol::MAX_COMMAND_NAME] = {};

    CHECK(*SplitConsoleCommand(line, name, sizeof(name)) == '\0');
    CHECK(strcmp(name, "help") == 0);
}

TEST(the_name_is_every_leading_word_that_is_not_an_argument)
{
    // The whole rule, and the reason nothing here consults the registry.
    char one[]   = "system ping";
    char two[]   = "led set enabled=true";
    char name[protocol::MAX_COMMAND_NAME] = {};

    SplitConsoleCommand(one, name, sizeof(name));
    CHECK(strcmp(name, "system ping") == 0);

    SplitConsoleCommand(two, name, sizeof(name));
    CHECK(strcmp(name, "led set") == 0);
}

TEST(leading_and_repeated_spaces_are_not_part_of_the_name)
{
    char line[] = "   settings    set   key=a";
    char name[protocol::MAX_COMMAND_NAME] = {};

    char* args = SplitConsoleCommand(line, name, sizeof(name));
    CHECK(strcmp(name, "settings set") == 0);
    CHECK(strncmp(args, "key=a", 5) == 0);
}

TEST(a_name_too_long_to_be_one_is_refused_rather_than_truncated)
{
    // A truncated name would match a real command by accident. Empty is how every
    // codec says "this request names nothing".
    char line[] = "aaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbb cccccccccccccccc";
    char name[protocol::MAX_COMMAND_NAME] = {};

    SplitConsoleCommand(line, name, sizeof(name));
    CHECK(name[0] == '\0');
}

TEST(arguments_decode_by_their_declared_type)
{
    char line[] = "partition write key=ota_1 offset=4096 restart=true";
    Parsed p;
    Parse(line, p);

    CHECK(p.result == CommandResult::Ok);
    CHECK(strcmp(p.name, "partition write") == 0);
    CHECK(p.values.has(2));
    CHECK_EQ(p.values.get<uint32_t>(2), 4096u);
    CHECK(p.values.get<bool>(3));
}

TEST(a_quoted_value_may_contain_spaces)
{
    char line[] = "settings set key=device.name value=\"My Device\"";
    Parsed p;
    Parse(line, p);

    CHECK(p.result == CommandResult::Ok);
    CHECK(strcmp(p.values.get<const char*>(0), "device.name") == 0);
    CHECK(strcmp(p.values.get<const char*>(1), "My Device") == 0);
}

TEST(a_value_after_a_quoted_one_is_still_found)
{
    // The quoted branch terminates the value over its closing quote, so the scan
    // has to resume past it rather than at it.
    char line[] = "settings set value=\"two words\" key=a";
    Parsed p;
    Parse(line, p);

    CHECK(p.result == CommandResult::Ok);
    CHECK(strcmp(p.values.get<const char*>(1), "two words") == 0);
    CHECK(strcmp(p.values.get<const char*>(0), "a") == 0);
}

TEST(an_empty_value_is_supplied_rather_than_absent)
{
    // `settings set key=x value=` clears a setting; it is not the same as omitting
    // `value`, which the presence flag is what distinguishes.
    char line[] = "settings set key=x value=";
    Parsed p;
    Parse(line, p);

    CHECK(p.result == CommandResult::Ok);
    CHECK(p.values.has(1));
    CHECK(p.values.get<const char*>(1)[0] == '\0');
}

TEST(a_missing_required_argument_names_itself)
{
    char line[] = "settings set value=x";
    Parsed p;
    Parse(line, p);

    CHECK(p.result == CommandResult::MissingArgument);
    CHECK(p.failed != nullptr && strcmp(p.failed, "key") == 0);
}

TEST(a_bare_word_among_the_arguments_is_refused)
{
    // Refused rather than guessed at: a flag form would have to decide which
    // declaration it meant, and the answer would depend on the order they happen
    // to be declared in.
    char line[] = "settings set key=a oops";
    Parsed p;
    Parse(line, p);

    CHECK(p.result == CommandResult::MalformedRequest);
}

TEST(an_undeclared_argument_is_ignored_exactly_as_json_ignores_one)
{
    char line[] = "settings set nosuch=1 key=a";
    Parsed p;
    Parse(line, p);

    CHECK(p.result == CommandResult::Ok);
    CHECK(strcmp(p.values.get<const char*>(0), "a") == 0);
}

TEST(a_malformed_number_and_an_overlong_string_name_the_argument)
{
    char bad[] = "partition write offset=12abc";
    Parsed p;
    Parse(bad, p);
    CHECK(p.result == CommandResult::MalformedNumber);
    CHECK(p.failed != nullptr && strcmp(p.failed, "offset") == 0);

    char tooLong[] = "settings set key=0123456789abcdefghij";
    Parsed q;
    Parse(tooLong, q);
    CHECK(q.result == CommandResult::ArgumentTooLong);
    CHECK(q.failed != nullptr && strcmp(q.failed, "key") == 0);
}

TEST(both_codecs_read_the_same_declarations_the_same_way)
{
    // The point of the second codec: the grammar differs and nothing below it does.
    char console[] = "settings set key=relay.url value=ws://x";
    char json[]    = R"({"type":"settings set","key":"relay.url","value":"ws://x"})";

    Parsed c;
    Parse(console, c);

    ArgValues j;
    const char* failed = nullptr;
    CHECK(DecodeJsonArgs(json, kArgs, j, failed) == CommandResult::Ok);

    CHECK(c.result == CommandResult::Ok);
    CHECK(strcmp(c.values.get<const char*>(0), j.get<const char*>(0)) == 0);
    CHECK(strcmp(c.values.get<const char*>(1), j.get<const char*>(1)) == 0);
}
