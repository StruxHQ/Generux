#pragma once

#include <cstdint>

// ──────────────────────────────────────────────────────────────
// Role interface: application vocabulary for "the square-wave output".
// One pin, frequency and duty chosen at runtime. Boards bind a real
// driver (LedcSquareWave).
// ──────────────────────────────────────────────────────────────

class SquareWave
{
public:
    /// (Re)start the output at `hz` with the pin high for `dutyPercent` of
    /// each period. Returns false, leaving the output stopped, when the
    /// hardware cannot produce that frequency.
    virtual bool Start(uint32_t hz, uint32_t dutyPercent) = 0;

    /// Stop the output and hold the pin low.
    virtual void Stop() = 0;

    /// The frequency actually being produced — which can differ from the
    /// one asked for by the divider's resolution — or 0 while stopped.
    virtual uint32_t GetFrequency() const = 0;

    /// The duty actually being produced, in percent — the timer reaches it in
    /// steps of 1/2^bits of a period — or 0 while stopped.
    virtual float GetDuty() const = 0;

    virtual ~SquareWave() = default;
};
