#include "check.h"
#include "ConnectionState.h"

// The handshake. This is the code that is genuinely awkward to exercise on
// hardware -- a nonce collision needs two boards drawing the same 64-bit number
// -- and trivial to exercise here, which is the whole argument for the file.

static bool inLowHalf(uint16_t id)  { return id < channel::LOW_LIMIT; }
static bool inHighHalf(uint16_t id) { return id >= channel::HIGH_BASE; }

TEST(equal_nonces_do_not_settle)
{
    ConnectionState s;
    s.nonce = 42;
    CHECK(!s.Settle(42));      // caller redraws and sends again
}

TEST(the_higher_nonce_takes_the_low_half)
{
    ConnectionState s;
    s.nonce = 100;
    CHECK(s.Settle(99));
    CHECK(s.lowHalf);
    CHECK_EQ(s.nextId, channel::LOW_BASE);

    ConnectionState t;
    t.nonce = 99;
    CHECK(t.Settle(100));
    CHECK(!t.lowHalf);
    CHECK_EQ(t.nextId, channel::HIGH_BASE);
}

TEST(two_peers_never_choose_the_same_half)
{
    // The property that matters, over values chosen to catch a signed compare:
    // the top bit set on one side only is exactly where int64 would invert.
    const uint64_t nonces[] = {
        0ull, 1ull, 2ull,
        0x7FFFFFFFFFFFFFFFull, 0x8000000000000000ull, 0x8000000000000001ull, ~0ull,
    };

    for (uint64_t a : nonces)
        for (uint64_t b : nonces)
        {
            if (a == b) continue;

            ConnectionState left, right;
            left.nonce = a;
            right.nonce = b;

            CHECK(left.Settle(b));
            CHECK(right.Settle(a));

            // Exactly one of them allocates from the low half.
            CHECK(left.lowHalf != right.lowHalf);

            uint16_t li = 0, ri = 0;
            CHECK(left.AllocateId(li));
            CHECK(right.AllocateId(ri));
            CHECK(li != ri);
        }
}

TEST(allocation_stays_inside_its_own_half)
{
    ConnectionState low;
    low.nonce = 2;
    low.Settle(1);
    for (int i = 0; i < 64; ++i)
    {
        uint16_t id = 0;
        CHECK(low.AllocateId(id));
        CHECK(inLowHalf(id));
    }

    ConnectionState high;
    high.nonce = 1;
    high.Settle(2);
    for (int i = 0; i < 64; ++i)
    {
        uint16_t id = 0;
        CHECK(high.AllocateId(id));
        CHECK(inHighHalf(id));
    }
}

TEST(the_cursor_wraps_to_its_own_base_not_to_zero)
{
    // The high half's wrap is the interesting one: rolling a uint16 past 0xFFFF
    // lands on 0, which belongs to the OTHER peer.
    ConnectionState high;
    high.nonce = 1;
    high.Settle(2);
    high.nextId = 0xFFFF;

    uint16_t id = 0;
    CHECK(high.AllocateId(id));
    CHECK_EQ(id, 0xFFFF);

    CHECK(high.AllocateId(id));
    CHECK_EQ(id, channel::HIGH_BASE);

    ConnectionState low;
    low.nonce = 2;
    low.Settle(1);
    low.nextId = static_cast<uint16_t>(channel::LOW_LIMIT - 1);

    CHECK(low.AllocateId(id));
    CHECK_EQ(id, channel::LOW_LIMIT - 1);
    CHECK(low.AllocateId(id));
    CHECK_EQ(id, channel::LOW_BASE);
}

TEST(allocation_skips_ids_the_table_still_holds)
{
    ConnectionState s;
    s.nonce = 2;
    s.Settle(1);                       // low half, cursor at 0

    s.channels.Open(0, ChannelTable::State::Passive);
    s.channels.Open(1, ChannelTable::State::Active);

    uint16_t id = 0;
    CHECK(s.AllocateId(id));
    CHECK_EQ(id, 2);                   // reusing a live id answers the wrong request
}

TEST(reset_puts_a_connection_back_to_handshake)
{
    ConnectionState s;
    s.nonce = 5;
    s.Settle(1);
    s.phase = ConnectionState::Phase::Ready;
    s.channels.Open(3, ChannelTable::State::Active);
    s.logChannel = 3;
    s.telemetryChannel = 4;
    s.logCursor = 77;
    s.attempts = 2;

    s.Reset();

    CHECK(s.phase == ConnectionState::Phase::Handshake);
    CHECK_EQ(s.nonce, 0);
    CHECK_EQ(s.attempts, 0);
    CHECK(!s.lowHalf);
    CHECK_EQ(s.nextId, 0);
    CHECK_EQ(s.logChannel, -1);        // signed, because 0 is a real channel id
    CHECK_EQ(s.telemetryChannel, -1);
    CHECK_EQ(s.logCursor, 0);
    CHECK(!s.channels.Holds(3));
}
