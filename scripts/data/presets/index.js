/**
 * The bundled campaign-setting calendars.
 *
 * Each entry is plain data describing a setting's calendar the way a GM would
 * fill the configuration window in by hand, plus two things the window cannot
 * express directly: a weekday anchor and a moon anchor. Those say "this date is
 * a Fireday" and "this moon is full on this night", and the preset service
 * turns them into the stored offsets. Anchors are used rather than raw offsets
 * so the canon fact stays readable next to the number it produces.
 *
 * Nothing here touches Foundry globals, so the whole set is unit testable.
 */

import { ANUIRE } from "./anuire.js";
import { DARK_SUN } from "./darksun.js";
import { EBERRON } from "./eberron.js";
import { GOLARION } from "./golarion.js";
import { GREGORIAN } from "./gregorian.js";
import { GREYHAWK } from "./greyhawk.js";
import { HARPTOS } from "./harptos.js";

/** Every preset, in the order the picker offers them. */
export const CALENDAR_PRESETS = [
  HARPTOS,
  GOLARION,
  EBERRON,
  GREYHAWK,
  DARK_SUN,
  ANUIRE,
  GREGORIAN
];

/** Preset identifiers, in picker order. */
export const PRESET_IDS = CALENDAR_PRESETS.map(preset => preset.id);
