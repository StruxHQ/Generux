#include "check.h"
#include "ChannelTable.h"

TEST(an_opened_channel_is_found_and_held)
{
    ChannelTable t;
    CHECK(t.Find(7) == nullptr);
    CHECK(!t.Holds(7));

    CHECK(t.Open(7, ChannelTable::State::Active) != nullptr);
    CHECK(t.Find(7) != nullptr);
    CHECK(t.Holds(7));

    t.Close(7);
    CHECK(t.Find(7) == nullptr);
    CHECK(!t.Holds(7));
}

TEST(channel_zero_is_an_ordinary_id)
{
    // Nothing is reserved any more -- three ids used to be, and the whole point
    // of the handshake is that none has to be.
    ChannelTable t;
    CHECK(!t.Holds(0));
    CHECK(t.Open(0, ChannelTable::State::Active) != nullptr);
    CHECK(t.Holds(0));
}

TEST(a_full_table_refuses_rather_than_overwriting)
{
    ChannelTable t;
    for (int i = 0; i < ChannelTable::MAX; ++i)
        CHECK(t.Open(static_cast<uint16_t>(100 + i), ChannelTable::State::Passive) != nullptr);

    // The caller turns this into a RESET "too many channels"; silently evicting
    // a live channel would present as the peer answering the wrong request.
    CHECK(t.Open(200, ChannelTable::State::Passive) == nullptr);

    t.Close(100);
    CHECK(t.Open(200, ChannelTable::State::Passive) != nullptr);
}

TEST(busy_means_a_handler_is_running_not_merely_open)
{
    ChannelTable t;
    CHECK(!t.Busy());

    // Passive streams -- logs, telemetry -- are open with nothing scheduled, so
    // they must not make the connection look busy or nothing else could open.
    t.Open(1, ChannelTable::State::Passive);
    t.Open(2, ChannelTable::State::Passive);
    CHECK(!t.Busy());

    t.Open(3, ChannelTable::State::Active);
    CHECK(t.Busy());

    t.Close(3);
    CHECK(!t.Busy());
}

TEST(reset_forgets_every_channel)
{
    ChannelTable t;
    t.Open(1, ChannelTable::State::Active);
    t.Open(2, ChannelTable::State::Passive);

    // A fresh transport connection knows no ids from the old one.
    t.Reset();
    CHECK(!t.Busy());
    CHECK(!t.Holds(1));
    CHECK(!t.Holds(2));
    CHECK(t.Open(1, ChannelTable::State::Active) != nullptr);
}

TEST(closing_an_unknown_id_is_harmless)
{
    ChannelTable t;
    t.Open(5, ChannelTable::State::Active);
    t.Close(99);            // residue for a channel nobody holds
    CHECK(t.Holds(5));
    CHECK(t.Busy());
}
