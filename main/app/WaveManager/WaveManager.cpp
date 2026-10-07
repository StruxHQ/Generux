#include "WaveManager.h"
#include "BoardContext.h"
#include "StruxProvider.h"
#include "SettingsManager.h"
#include "CommandManager.h"
#include "esp_log.h"

WaveManager::WaveManager(AppProvider& app)
    : app_(app)
{
}

void WaveManager::Init()
{
    auto initAttempt = initState_.TryBeginInit();
    if (!initAttempt)
    {
        ESP_LOGW(TAG, "Already initialized or initializing");
        return;
    }

    StruxProvider& strux = app_.getStrux();
    strux.getSettingsManager().Register({ &enabledSetting_, &freqSetting_ });
    strux.getCommandManager().Register(this, { &getCommand_, &setCommand_ });

    // Resume whatever was last persisted. A stored frequency that is out of range
    // (only reachable through `settings set`) leaves the output off.
    enabled_ = enabledSetting_.Get();
    hz_ = freqSetting_.Get();
    Apply();

    initAttempt.SetReady();
    ESP_LOGI(TAG, "Initialized");
}

bool WaveManager::Set(bool enabled, uint32_t hz, bool persist)
{
    if (hz < MIN_HZ || hz > MAX_HZ)
        return false;

    enabled_ = enabled;
    hz_ = hz;
    const bool ok = Apply();

    if (persist)
    {
        enabledSetting_.Set(enabled);
        freqSetting_.Set(hz);
        app_.getStrux().getSettingsManager().Save();
    }
    return ok;
}

bool WaveManager::Apply()
{
    SquareWave& wave = app_.getBoard().GetSquareWave();

    if (!enabled_ || hz_ < MIN_HZ || hz_ > MAX_HZ)
    {
        wave.Stop();
        return !enabled_;
    }
    return wave.Start(hz_);
}

// ──────────────────────────────────────────────────────────────
// Commands
// ──────────────────────────────────────────────────────────────

void WaveManager::WriteState(CommandContext& ctx, bool ok, const char* error)
{
    auto resp = ctx.reply.object();
    resp.field("ok", ok);
    if (error)
        resp.field("error", error);
    resp.field("enabled", enabled_);
    resp.field("freq", hz_);
    resp.field("actual", app_.getBoard().GetSquareWave().GetFrequency());
    resp.field("min", MIN_HZ);
    resp.field("max", MAX_HZ);
}

namespace {

constexpr CommandArg<bool> enabledArg{
    "enabled", "true runs the output, false stops it and holds the pin low. "
               "Absent leaves it as it is.",
    Presence::Optional };

constexpr CommandArg<uint32_t> freqArg{
    "freq", "Frequency in Hz, 5 to 100000. Absent keeps the current one.",
    Presence::Optional };

constexpr CommandArg<bool> persistArg{
    "persist", "false applies without writing flash - for the many small steps "
               "of a sweep; send the last one persisted. Default true.",
    Presence::Optional };

} // namespace

CommandEntry WaveManager::getCommand_{
    "wave get", &InvokeCommand<&WaveManager::Cmd_Get>,
    "Report the square-wave output: whether it is on, the frequency set, the "
    "frequency actually produced, and the allowed range."
};

CommandEntry WaveManager::setCommand_{
    "wave set", &InvokeCommand<&WaveManager::Cmd_Set>,
    "Set the square-wave frequency and/or switch the output on or off. Applied "
    "immediately and persisted unless persist is false. Omitted arguments keep "
    "their current value.",
    { &enabledArg, &freqArg, &persistArg }
};

CommandResult WaveManager::Cmd_Get(CommandContext& ctx)
{
    WriteState(ctx, true, nullptr);
    return CommandResult::Ok;
}

CommandResult WaveManager::Cmd_Set(CommandContext& ctx)
{
    // Every argument is "absent keeps what is there", so each one falls back
    // explicitly: an omitted optional decodes as false/0, not as the current value.
    const bool enabled = ctx.has(enabledArg) ? ctx.arg(enabledArg) : enabled_;
    const uint32_t freq = ctx.has(freqArg) ? ctx.arg(freqArg) : hz_;
    const bool persist = ctx.has(persistArg) ? ctx.arg(persistArg) : true;

    if (freq < MIN_HZ || freq > MAX_HZ)
    {
        WriteState(ctx, false, "freq is outside 5..100000 Hz");
        return CommandResult::Ok;
    }

    const bool ok = Set(enabled, freq, persist);
    WriteState(ctx, ok, ok ? nullptr : "the hardware could not produce that frequency");
    return CommandResult::Ok;
}
