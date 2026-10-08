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
    strux.getSettingsManager().Register({ &enabledSetting_, &freqSetting_, &dutySetting_ });
    strux.getCommandManager().Register(this, { &getCommand_, &setCommand_ });

    // Resume whatever was last persisted. A stored frequency or duty that is out of
    // range (a range that has since narrowed, or `settings set`) leaves the output off.
    enabled_ = enabledSetting_.Get();
    hz_ = freqSetting_.Get();
    duty_ = dutySetting_.Get();
    Apply();

    initAttempt.SetReady();
    ESP_LOGI(TAG, "Initialized");
}

bool WaveManager::Set(bool enabled, uint32_t hz, uint32_t duty, bool persist)
{
    if (!InRange(hz, duty))
        return false;

    enabled_ = enabled;
    hz_ = hz;
    duty_ = duty;
    const bool ok = Apply();

    if (persist)
    {
        enabledSetting_.Set(enabled);
        freqSetting_.Set(hz);
        dutySetting_.Set(duty);
        app_.getStrux().getSettingsManager().Save();
    }
    return ok;
}

bool WaveManager::Apply()
{
    SquareWave& wave = app_.getBoard().GetSquareWave();

    if (!enabled_ || !InRange(hz_, duty_))
    {
        wave.Stop();
        return !enabled_;
    }
    return wave.Start(hz_, duty_);
}

// ──────────────────────────────────────────────────────────────
// Commands
// ──────────────────────────────────────────────────────────────

void WaveManager::WriteState(CommandContext& ctx, bool ok, const char* error)
{
    SquareWave& wave = app_.getBoard().GetSquareWave();

    auto resp = ctx.reply.object();
    resp.field("ok", ok);
    if (error)
        resp.field("error", error);
    resp.field("enabled", enabled_);
    resp.field("freq", hz_);
    resp.field("actual", wave.GetFrequency());
    resp.field("duty", duty_);
    resp.field("dutyActual", wave.GetDuty());
    resp.field("min", MIN_HZ);
    resp.field("max", MAX_HZ);
}

namespace {

constexpr CommandArg<bool> enabledArg{
    "enabled", "true runs the output, false stops it and holds the pin low. "
               "Absent leaves it as it is.",
    Presence::Optional };

constexpr CommandArg<uint32_t> freqArg{
    "freq", "Frequency in Hz, 5 to 1000000. 'actual' in the reply is what the "
            "divider reached. Absent keeps the current one.",
    Presence::Optional };

constexpr CommandArg<uint32_t> dutyArg{
    "duty", "Percent of each period the pin is high, 1 to 99. The timer reaches it "
            "in steps of 1/2^bits of a period (1.6 % at 1 MHz, finer below); "
            "'dutyActual' in the reply is what it reached. Absent keeps the current one.",
    Presence::Optional };

constexpr CommandArg<bool> persistArg{
    "persist", "false applies without writing flash - for the many small steps "
               "of a sweep; send the last one persisted. Default true.",
    Presence::Optional };

} // namespace

CommandEntry WaveManager::getCommand_{
    "wave get", &InvokeCommand<&WaveManager::Cmd_Get>,
    "Report the square-wave output: whether it is on, the frequency and duty set, "
    "the frequency and duty actually produced, and the allowed frequency range."
};

CommandEntry WaveManager::setCommand_{
    "wave set", &InvokeCommand<&WaveManager::Cmd_Set>,
    "Set the square-wave frequency and/or duty, and/or switch the output on or off. "
    "Applied immediately and persisted unless persist is false. Omitted arguments "
    "keep their current value.",
    { &enabledArg, &freqArg, &dutyArg, &persistArg }
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
    const uint32_t duty = ctx.has(dutyArg) ? ctx.arg(dutyArg) : duty_;
    const bool persist = ctx.has(persistArg) ? ctx.arg(persistArg) : true;

    if (freq < MIN_HZ || freq > MAX_HZ)
    {
        WriteState(ctx, false, "freq is outside 5..1000000 Hz");
        return CommandResult::Ok;
    }
    if (duty < MIN_DUTY || duty > MAX_DUTY)
    {
        WriteState(ctx, false, "duty is outside 1..99 %");
        return CommandResult::Ok;
    }

    const bool ok = Set(enabled, freq, duty, persist);
    WriteState(ctx, ok, ok ? nullptr : "the hardware could not produce that frequency");
    return CommandResult::Ok;
}
