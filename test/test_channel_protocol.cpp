#include "check.h"
#include "ChannelProtocol.h"

// The wire format itself. These are the bytes a relay, a browser and a second
// board all have to agree on, and every one of them is a value a host test can
// pin that hardware cannot: a byte-order mistake here does not crash, it just
// makes two correct implementations disagree about which channel a frame is for.

TEST(header_is_little_endian_on_the_wire)
{
    uint8_t out[channel::HEADER_LEN] = {};
    CHECK_EQ(channel::writeHeader(out, 0x1234, channel::FLAG_OPEN), channel::HEADER_LEN);

    // Spelled as literal bytes on purpose. A round-trip test passes just as
    // happily with both halves wrong.
    CHECK_EQ(out[0], 0x34);
    CHECK_EQ(out[1], 0x12);
    CHECK_EQ(out[2], channel::FLAG_OPEN);
}

TEST(header_round_trips_at_the_ends_of_the_id_space)
{
    const uint16_t ids[] = { 0x0000, 0x0001, 0x7FFF, 0x8000, 0xFFFF };
    for (uint16_t id : ids)
    {
        uint8_t out[channel::HEADER_LEN] = {};
        channel::writeHeader(out, id, channel::FLAG_FINAL);
        CHECK_EQ(channel::readU16(out), id);
    }
}

TEST(nonce_is_little_endian_on_the_wire)
{
    uint8_t out[8] = {};
    channel::writeU64(out, 0x0102030405060708ull);

    CHECK_EQ(out[0], 0x08);
    CHECK_EQ(out[7], 0x01);
    CHECK_EQ(channel::readU64(out), 0x0102030405060708ull);
}

TEST(nonce_round_trips_at_the_extremes)
{
    // The top bit matters: the handshake compares nonces as unsigned, and a
    // signed slip would invert who takes which half for half of all draws.
    const uint64_t values[] = { 0ull, 1ull, 0x7FFFFFFFFFFFFFFFull,
                                0x8000000000000000ull, ~0ull };
    for (uint64_t v : values)
    {
        uint8_t out[8] = {};
        channel::writeU64(out, v);
        CHECK_EQ(channel::readU64(out) == v, true);
    }
}

TEST(flags_are_distinct_bits)
{
    const uint8_t all = channel::FLAG_FINAL | channel::FLAG_RESET
                      | channel::FLAG_OPEN  | channel::FLAG_CONTROL;
    CHECK_EQ(all, 0x0F);

    // Each one recoverable from the union -- i.e. no two share a bit.
    CHECK((all & channel::FLAG_FINAL)   != 0);
    CHECK((all & channel::FLAG_RESET)   != 0);
    CHECK((all & channel::FLAG_OPEN)    != 0);
    CHECK((all & channel::FLAG_CONTROL) != 0);
}

TEST(the_two_halves_are_contiguous_and_cover_the_space)
{
    CHECK_EQ(channel::LOW_BASE, 0x0000);
    CHECK_EQ(channel::LOW_LIMIT, channel::HIGH_BASE);      // no gap, no overlap
    CHECK_EQ(channel::HIGH_LIMIT, 0x10000u);               // exclusive, past uint16

    const uint32_t low  = channel::LOW_LIMIT - channel::LOW_BASE;
    const uint32_t high = channel::HIGH_LIMIT - channel::HIGH_BASE;
    CHECK_EQ(low + high, 0x10000u);
}

TEST(handshake_payload_length_matches_its_fields)
{
    CHECK_EQ(channel::HANDSHAKE_LEN, 1u + 8u);   // version + nonce
}
