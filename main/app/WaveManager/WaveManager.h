#pragma once

#include "AppProvider.h"
#include "InitState.h"
#include "CommandEntry.h"
#include "TypedSettings.h"

// ──────────────────────────────────────────────────────────────
// The product: a 50% duty square wave on one pin, at a frequency set from the web UI.
//
// Both the frequency and whether the output runs are settings, so the device comes
// back up producing what it was last told to persist. `wave set` applies at once and
// persists unless told not to (a sweep from the web UI's jog slider sends live steps
// unpersisted). A change made through `settings set` instead takes effect at the
// next boot, because the running state is read from the settings only at Init.
//
// The hardware half is the board's SquareWave role (LedcSquareWave on both boards
// today), which owns the clock and divider maths and reports the frequency it
// actually reached. Its browser half is the home page over the use-wave hook.
// ──────────────────────────────────────────────────────────────
class WaveManager
{
    static constexpr const char* TAG = "WaveManager";

public:
    // The range the UI and the command promise. The driver can reach somewhat past
    // both ends on these chips; these are the ends that are tested and exact enough
    // to be worth offering.
    static constexpr uint32_t MIN_HZ = 5;
    static constexpr uint32_t MAX_HZ = 100'000;

    explicit WaveManager(AppProvider& app);

    WaveManager(const WaveManager&) = delete;
    WaveManager& operator=(const WaveManager&) = delete;
    WaveManager(WaveManager&&) = delete;
    WaveManager& operator=(WaveManager&&) = delete;

    void Init();

    /// Apply, and persist unless `persist` is false. False when `hz` is outside
    /// [MIN_HZ, MAX_HZ] or the hardware refused it; nothing is stored in that case.
    /// A sweep sends many unpersisted steps and one persisted one at the end: every
    /// persisted step is a flash write.
    bool Set(bool enabled, uint32_t hz, bool persist = true);

private:
    AppProvider& app_;
    InitState initState_;

    // What the output is doing. Loaded from the settings at Init, and written back
    // to them only on a persisted Set.
    bool enabled_ = false;
    uint32_t hz_ = 0;

    /// Drive the output to enabled_/hz_.
    bool Apply();

    // ── Settings (keys at most 15 characters — NVS's limit).
    inline static BoolSetting enabledSetting_{ "wave.enabled", "Square Wave Output On", false };
    inline static UInt32Setting freqSetting_{ "wave.freq", "Square Wave Frequency (Hz)", 1000 };

    // ── Commands ──
    RequestError Cmd_Get(CommandContext& ctx);
    RequestError Cmd_Set(CommandContext& ctx);
    void WriteState(CommandContext& ctx, bool ok, const char* error);

    inline static CommandEntry commands_[] = {
        { "wave", "get", &InvokeCommand<&WaveManager::Cmd_Get>,
          "Report the square-wave output: whether it is on, the frequency set, the "
          "frequency actually produced, and the allowed range." },
        { "wave", "set", &InvokeCommand<&WaveManager::Cmd_Set>,
          "Set the square-wave frequency and/or switch the output on or off. Applied "
          "immediately and persisted unless persist is false. Omitted arguments keep "
          "their current value." },
    };
};
