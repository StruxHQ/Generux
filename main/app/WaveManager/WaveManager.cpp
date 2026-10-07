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
    strux.getCommandManager().Register(this, commands_);

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

RequestError WaveManager::Cmd_Get(CommandContext& ctx)
{
    RETURN_IF_ERROR(ctx.readArgs());
    WriteState(ctx, true, nullptr);
    return RequestError::Ok;
}

RequestError WaveManager::Cmd_Set(CommandContext& ctx)
{
    bool enabled = enabled_;
    uint32_t freq = hz_;
    bool persist = true;

    RETURN_IF_ERROR(ctx.readArgs(
        Optional("enabled", enabled,
                 "true runs the output, false stops it and holds the pin low. "
                 "Absent leaves it as it is."),
        Optional("freq", freq,
                 "Frequency in Hz, 5 to 100000. Absent keeps the current one."),
        Optional("persist", persist,
                 "false applies without writing flash - for the many small steps "
                 "of a sweep; send the last one persisted. Default true.")
    ));

    if (freq < MIN_HZ || freq > MAX_HZ)
    {
        WriteState(ctx, false, "freq is outside 5..100000 Hz");
        return RequestError::Ok;
    }

    const bool ok = Set(enabled, freq, persist);
    WriteState(ctx, ok, ok ? nullptr : "the hardware could not produce that frequency");
    return RequestError::Ok;
}
