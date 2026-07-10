// OpenApiary firmware version — single source of truth.
//
// Bump these on every released build. They are consumed in three places:
//   * main.cpp broadcasts them in the BTHome advert (object 0xF2, firmware
//     version uint24: major.minor.patch) so the app can show installed-vs-latest
//     without connecting to the scale.
//   * the release/signing pipeline names the DFU package + .uf2 from them.
//   * the app pins the same version string (see app/src/lib/ota.ts CURRENT_BUILD)
//     as a fallback when no advert has been seen yet.
#pragma once

#define OA_FW_MAJOR 1
#define OA_FW_MINOR 0
#define OA_FW_PATCH 9

#define OA_FW_STR2(x) #x
#define OA_FW_STR(x)  OA_FW_STR2(x)
// e.g. "v1.0.0"
#define OA_FW_VERSION_STRING "v" OA_FW_STR(OA_FW_MAJOR) "." OA_FW_STR(OA_FW_MINOR) "." OA_FW_STR(OA_FW_PATCH)
