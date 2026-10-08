#pragma once

// ──────────────────────────────────────────────────────────────
// What this product is, and how it is meant to be driven — in the product's own
// words, in the application layer, beside the managers the words are about.
//
// It lives here and not in the relay for one reason: whatever answers "how do I use
// this device" has to be the firmware that is actually running. A copy kept
// server-side is a copy that describes last month's build, and the one caller who
// cannot notice is the one most likely to act on it.
//
// Registered into the framework from AppContext::Init(), like every other thing the
// application tells Strux about itself (see SystemManager::SetDocumentation). Strux
// never reaches up for it.
//
// Two strings, on purpose:
//
//   DESCRIPTION   one line. It rides in the relay hello, so it is in a device list
//                 before anything asks the device a question. Sentence, not paragraph.
//
//   INSTRUCTIONS  free-form, as long as it needs to be, served only when asked for
//                 (`system describe`). Deliberately prose and NOT a schema: every
//                 command already declares its own name, arguments, types and
//                 required/optional state, and this is for the part that never fits
//                 in a declaration — which commands belong together, what order they
//                 go in, what the units are, what will not work and why.
//
// A fork replaces both when it replaces LedManager with a real feature.
// ──────────────────────────────────────────────────────────────
namespace DeviceDoc {

inline constexpr const char* DESCRIPTION =
    "Wavy square-wave generator - one pin, 50% duty, 5 Hz to 13.3 MHz, set from "
    "the web UI.";

inline constexpr const char* INSTRUCTIONS =
    "This is Wavy, a square-wave generator built on the Strux template. It drives "
    "one pin with a 50% duty square wave at a frequency you choose.\n"
    "\n"
    "The square wave\n"
    "  `wave get` reports whether the output is on, the frequency set (`freq`), the "
    "frequency actually produced (`actual`, 0 while off) and the allowed range "
    "(`min`/`max`, in Hz). `wave set -freq 25000 -enabled true` changes either or "
    "both; omitted arguments keep their value. Changes apply at once and are "
    "persisted, so the output resumes after a reboot. Up to 500 kHz `actual` "
    "differs from `freq` by up to about 0.1%, when 80 MHz is not a whole multiple "
    "of it. Above 500 kHz the output snaps to the nearest 40 MHz / n (13.333, 10, "
    "8, 6.667 ... MHz) so that every period is identical, and `actual` says which "
    "one it reached. The range stops at 13.333 MHz because faster outputs disrupt "
    "the device's own WiFi. The pin is GPIO4 on the "
    "ESP32-C3 SuperMini and GPIO25 on the ESP32 DevKit; it is held low while off.\n"
    "\n"
    "Discovering what it can do\n"
    "  Every command declares itself. `help` returns every command this firmware "
    "has, with its description and each of its arguments - name, type, whether it "
    "is required, and what it means - in one reply. Nothing about a command is "
    "written down twice, so what it returns is always this exact build.\n"
    "\n"
    "The relay LED\n"
    "  The board LED is lit while the device is connected to its relay server. "
    "`led get` reports three separate facts: whether the indicator is enabled, "
    "whether the relay link is up, and whether the LED is lit at this instant. "
    "`led set enabled=false` keeps the board dark without affecting the link. The "
    "setting is persisted, so it survives a reboot.\n"
    "\n"
    "Settings\n"
    "  `settings list` enumerates every setting on the device with its type and "
    "current value; `settings set` changes one in RAM and `settings save` commits it "
    "to NVS. A change is not durable until it is saved. Keys are dotted "
    "(`relay.url`, `led.enabled`) and are at most 15 characters, which is a storage "
    "limit and not a style.\n"
    "\n"
    "Things worth knowing before driving this device\n"
    "  * `system reboot` answers first and then restarts about half a second later, "
    "so every connection drops and anything in flight is lost.\n"
    "  * The `partition` commands write flash. `partition write` and "
    "`partition clear` change what the device boots; they exist for firmware "
    "updates and are not a general storage API.\n"
    "  * `web read` serves the device's own web UI files. It is how the relay "
    "renders this device's page; it is not a filesystem.\n"
    "  * Two codecs carry a command, and the device picks by the request line: one "
    "starting with '{' is JSON and is answered in JSON; anything else is read as a "
    "console line (`led set enabled=true`) and is answered in YAML. Nothing is "
    "negotiated and both reach the same commands.\n"
    "  * A reply is one record unless the command says otherwise. `web read` and "
    "`partition read` are the exceptions: they write a header record declaring a "
    "contentType and then raw bytes.\n"
    "  * Numbers in arguments are unsigned 32-bit. There are no floating-point "
    "arguments anywhere in the protocol.";

} // namespace DeviceDoc
