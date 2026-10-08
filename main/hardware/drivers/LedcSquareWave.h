#pragma once

#include "interfaces/SquareWave.h"
#include "driver/ledc.h"
#include "driver/gpio.h"
#include "esp_pm.h"
#include "esp_log.h"
#include "soc/soc_caps.h"
#include <algorithm>

// ──────────────────────────────────────────────────────────────
// Square wave on one pin from an LEDC timer, 50% duty. Pin injected by
// the board; this driver takes LEDC timer 0 / channel 0 in low-speed mode
// for itself.
//
// The timer counts a clock divided by a 10.8 fixed-point divider, and the
// period is 2^bits counts. 50% duty needs only one bit, so the resolution
// is free to be chosen for the DIVIDER instead: when APB/hz is a whole
// number, a resolution is picked that leaves an integer divider, and the
// output has no jitter at all (100 kHz = 80 MHz / 25 / 2^5). Otherwise the
// fractional divider dithers between two neighbouring periods — one APB
// cycle, 12.5 ns — and averages out to the requested frequency. Above
// DITHER_MAX_HZ that dither is too large a share of the period, and the
// output snaps to the nearest whole divider instead (40 MHz at the top).
//
// Retuning a running output only rewrites the divider, which low-speed
// mode latches at the end of the current period: no reset, no runt pulse,
// so a sweep is continuous. The timer is only reconfigured (and reset) when
// the resolution has to change — once per octave or so in a sweep, and
// whenever an exact divider is on offer at a different resolution.
//
// The clock is APB, which dynamic frequency scaling drops to 40 MHz when
// the CPU idles — halving the output. A PM lock pins APB at 80 MHz for as
// long as the wave runs, and only then.
// ──────────────────────────────────────────────────────────────

class LedcSquareWave : public SquareWave
{
    static constexpr const char* TAG = "SquareWave";

    static constexpr ledc_mode_t MODE = LEDC_LOW_SPEED_MODE;
    static constexpr ledc_timer_t TIMER = LEDC_TIMER_0;
    static constexpr ledc_channel_t CHANNEL = LEDC_CHANNEL_0;

    // APB with the PM lock held. Not read from the clock tree: under DFS that
    // reports whatever APB is at this instant, not what it will be once locked.
    static constexpr uint32_t APB_HZ = 80'000'000;

    // Divider as the register holds it: 10 integer bits, 8 fractional, and at
    // least 1.0. The same on every chip this template targets.
    static constexpr uint64_t DIV_MIN = 1u << 8;
    static constexpr uint64_t DIV_MAX = (1u << 18) - 1;

    // Above this a fractional divider stops being worth having. Its dither moves an
    // edge by one APB cycle, 12.5 ns, which is 0.6% of a period here and a whole
    // half-period at 40 MHz, where 25 MHz would come out as 40 and 20 MHz cycles
    // taking turns. So above it the output snaps to APB / 2 / n -- 40, 20, 13.33, 10,
    // 8 ... MHz, 1.25% apart at this end -- and reports what it reached.
    static constexpr uint32_t DITHER_MAX_HZ = 500'000;

public:
    explicit LedcSquareWave(int pin)
        : pin_(static_cast<gpio_num_t>(pin))
    {
    }

    void Init()
    {
        // Low until started, rather than a floating input.
        gpio_config_t cfg = {};
        cfg.pin_bit_mask = 1ULL << pin_;
        cfg.mode = GPIO_MODE_OUTPUT;
        gpio_config(&cfg);
        gpio_set_level(pin_, 0);

        // ESP_ERR_NOT_SUPPORTED without CONFIG_PM_ENABLE — then APB never moves
        // and there is nothing to hold.
        if (esp_pm_lock_create(ESP_PM_APB_FREQ_MAX, 0, "sqwave", &pmLock_) != ESP_OK)
            pmLock_ = nullptr;
    }

    bool Start(uint32_t hz) override
    {
        uint32_t bits;
        if (hz > DITHER_MAX_HZ)
        {
            // Snap to APB / 2 / n: one-bit resolution and a whole divider, so every
            // period is identical. The frequency handed to the driver is truncated,
            // which leaves the divider it computes a hair above n -- n, either way it
            // rounds.
            const uint32_t n = std::max<uint32_t>(1, (APB_HZ / 2 + hz / 2) / hz);
            hz = APB_HZ / 2 / n;
            bits = 1;
            if (running_ && bits_ == bits && ledc_set_freq(MODE, TIMER, hz) == ESP_OK)
            {
                actualHz_ = ledc_get_freq(MODE, TIMER);
                return true;
            }
        }
        else
        {
            if (running_ && Retune(hz))
                return true;
            bits = PickResolution(hz);
        }

        if (bits == 0)
        {
            ESP_LOGW(TAG, "%lu Hz is out of reach", (unsigned long)hz);
            Stop();
            return false;
        }

        if (!running_ && pmLock_)
            esp_pm_lock_acquire(pmLock_);
        running_ = true;

        ledc_timer_config_t timer = {};
        timer.speed_mode = MODE;
        timer.duty_resolution = static_cast<ledc_timer_bit_t>(bits);
        timer.timer_num = TIMER;
        timer.freq_hz = hz;
        timer.clk_cfg = LEDC_USE_APB_CLK;

        ledc_channel_config_t channel = {};
        channel.gpio_num = pin_;
        channel.speed_mode = MODE;
        channel.channel = CHANNEL;
        channel.timer_sel = TIMER;
        channel.duty = 1u << (bits - 1);
        channel.hpoint = 0;

        if (ledc_timer_config(&timer) != ESP_OK || ledc_channel_config(&channel) != ESP_OK)
        {
            ESP_LOGE(TAG, "LEDC refused %lu Hz at %lu bits", (unsigned long)hz, (unsigned long)bits);
            Stop();
            return false;
        }

        bits_ = bits;
        actualHz_ = ledc_get_freq(MODE, TIMER);
        ESP_LOGD(TAG, "%lu Hz requested, %lu Hz out (%lu bits)",
                 (unsigned long)hz, (unsigned long)actualHz_, (unsigned long)bits);
        return true;
    }

    void Stop() override
    {
        if (!running_)
            return;

        ledc_stop(MODE, CHANNEL, 0);
        if (pmLock_)
            esp_pm_lock_release(pmLock_);
        running_ = false;
        actualHz_ = 0;
    }

    uint32_t GetFrequency() const override { return actualHz_; }

private:
    gpio_num_t pin_;
    esp_pm_lock_handle_t pmLock_ = nullptr;
    bool running_ = false;
    uint32_t actualHz_ = 0;
    uint32_t bits_ = 0;

    /// Move a running output to `hz` by rewriting the divider alone. False when
    /// that is not the right move — the current resolution cannot reach `hz`, or
    /// a different one would make it exact — and the caller reconfigures.
    bool Retune(uint32_t hz)
    {
        const uint32_t exact = ExactResolution(hz);
        const bool keep = exact ? exact == bits_ : DividerValid(hz, bits_);
        if (!keep || ledc_set_freq(MODE, TIMER, hz) != ESP_OK)
            return false;

        actualHz_ = ledc_get_freq(MODE, TIMER);
        return true;
    }

    static bool DividerValid(uint32_t hz, uint32_t bits)
    {
        if (hz == 0 || bits == 0)
            return false;
        const uint64_t period = (uint64_t)hz << bits;
        const uint64_t div = (((uint64_t)APB_HZ << 8) + period / 2) / period;
        return div >= DIV_MIN && div <= DIV_MAX;
    }

    /// The most bits that leave a whole-number divider for `hz`, or 0 if none.
    static uint32_t ExactResolution(uint32_t hz)
    {
        if (hz == 0 || APB_HZ % hz != 0)
            return 0;
        const uint32_t counts = APB_HZ / hz;
        for (uint32_t bits = SOC_LEDC_TIMER_BIT_WIDTH; bits >= 1; bits--)
            if (counts % (1u << bits) == 0 && DividerValid(hz, bits))
                return bits;
        return 0;
    }

    /// Timer resolution for `hz`, or 0 when no divider reaches it: exact if that
    /// is on offer, otherwise the finest timing a fractional divider allows.
    static uint32_t PickResolution(uint32_t hz)
    {
        if (const uint32_t exact = ExactResolution(hz))
            return exact;
        for (uint32_t bits = SOC_LEDC_TIMER_BIT_WIDTH; bits >= 1; bits--)
            if (DividerValid(hz, bits))
                return bits;
        return 0;
    }
};
