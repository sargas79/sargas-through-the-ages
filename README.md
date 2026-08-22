# Through the Ages

A world-calendar and campaign-history module for **Foundry VTT v14 (build 366)**.

Through the Ages gives a world one shared, fully custom calendar; stores campaign
notes as real Journal Entries; and adds a separate visual timeline of **Ages** and
historical **events**. Everything is reachable from a single **Calendar** button at
the top of the **Journal** tab in the sidebar.

The module is system-agnostic — it adds no game mechanics and works in any v14 world.

---

## Features

- **Setting calendars**: ready-made presets for the Forgotten Realms, Pathfinder,
  Eberron, Greyhawk, Dark Sun and the real-world Gregorian calendar, with their
  months, moons, eras and holidays already dated.
- A custom calendar: months per year, month names and lengths, weekday names, and the
  weekday the calendar's first year begins on. Months may differ in length, so
  festival days and short months can stand between the long ones.
- One authoritative campaign date, controlled only by GMs and synchronised to every
  connected client without a reload.
- A shared 24-hour campaign clock with GM time presets that advance Foundry world
   time through its public API, so installed systems and modules can process their
   own time-based behaviour.
- Journal-backed calendar notes, stored in a managed **Calendar Notes** folder using
  canonical numeric names (`YYYY-MM-DD`, and `YYYY-MM-00` for month notes).
- Player notes that are private to their author and the GMs by default.
- **Ages**: named eras spanning a contiguous range of years, with overlap validation.
- **Moons**: up to twelve optional moons, each with its own cycle length — whole days
  or fractional, so a 29.53-day moon drifts as the real one does — starting offset and
  phase count, shown in the header, the day detail panel and the month grid.
- Era labels: an optional year prefix and suffix, so dates read as `1495 DR` or
  `4710 AR` rather than `Year 1495`.
- **Export and import** of the calendar structure, moons, Ages and timeline events as
  a portable JSON file.
- A timeline window with three display densities: expanded, current year, current month.
- GM promotion of any player note into a timeline event, without altering the note.
- Full localisation; no player-facing string is hard-coded.

### Not included

No leap years, seasons, weather, recurring events, reminders, scene automation,
third-party calendar integrations, or a separate sidebar tab. Moon phases are exposed
through the API rather than driving any automation of their own. Holidays exist only
as ordinary calendar notes: the setting presets can create a year of them for you,
but nothing repeats them the following year.

---

## Installation

**From the package directory** — search for **Through the Ages** in Foundry's
*Add-on Modules → Install Module* browser.

**From a manifest URL** — in the same dialog, paste:

```
https://github.com/sargas79/through-the-ages/releases/latest/download/module.json
```

**Manually** — download the release archive and extract it so the module lives at
`Data/modules/through-the-ages/`. The folder name must match the package id exactly.

Then enable **Through the Ages** in *Game Settings → Manage Modules*.

---

## First-time setup

1. Enable the module. Nothing is created in your world until you save a configuration.
2. Open **Game Settings → Configure Settings → Through the Ages → Configure Calendar**.
   (The same window is reachable from the gear button inside the calendar itself.)
3. Set the months per year, days per month, and the number of weekdays. Every month
   uses the same number of days in 1.0.
4. Name the months and weekdays.
5. Set the starting campaign date.
6. Optionally add **Ages**. Ages may not overlap; gaps are allowed but warned about.
7. Save. The module creates the **Calendar Notes** journal folder at this point.

The **Calendar** button then appears at the top of the sidebar's **Journal** tab for
everyone, next to the directory's own controls — the calendar's notes are journal
documents, so both live in the same place.

---

## GM workflows

### Changing campaign time

The calendar header shows the shared campaign date and 24-hour time. Its GM-only
time menu advances by **1 minute**, **10 minutes**, **1 hour**, **10 hours**, **1 day
(24 hours)**, **next adventure day (07:00 on the following calendar day)**, **1
week**, or **1 configured calendar month**. A **+1 day** control sits beside it for
quick forward corrections. Advancing rolls time, day, month, and year correctly, and
the campaign can never move earlier than Year 1, Month 1, Day 1 at 00:00.

Moving the campaign **backwards** is deliberate by design: select the day in the
month grid and use **Set as current date** in the day panel, or **Set date & time…**
in the header. Both open the same form and both confirm before anything moves. There
is no one-click control that rewinds the campaign, because a stray click on one would
move the date for every connected player and change Foundry world time with it.

Every module-controlled advance also calls Foundry's public world-time API with the
same elapsed seconds. Through the Ages does not inspect or modify actor, item, or
effect data: the active game system and other modules remain responsible for their
own duration expiry and time-based automation. The **Set Date** form includes a time
and confirms that moving time may affect those external systems.

On upgrade, existing calendars gain a `00:00` clock while their current Foundry world
time is preserved. If another source changes Foundry world time, Through the Ages
keeps its calendar unchanged and warns GMs. Use **Use current Foundry time** to
acknowledge that change before using its time controls again; this only establishes a
new synchronization checkpoint and does not alter calendar data.

**Combat is the usual source of that warning.** Foundry advances world time by the
system's round length every time a combat round passes, which this module does not
follow: the campaign calendar stays where the GM put it, and the strip reports the
difference. GMs are warned once per divergence rather than once per round, and the
strip stands until it is acknowledged.

Browsing months and years with the navigation arrows never changes the campaign date.

### Notes

*Add day note* and *Add month note* create notes on the selected day or the viewed
month. GM notes default to **GM only**; change the visibility selector to share one
with players. The filter dropdown narrows the note list to GM notes, player notes,
a specific player, day or month notes, or notes already promoted to the timeline.

### Ages and events

Open the timeline with **Open Timeline**. *Add event* creates an event on an exact
date, with a title, description, colour, icon, and player visibility. The three mode
buttons switch the shared display density; only a GM can change it.

### Moons

Moons are configured in the **Moons** section of the configuration window and are
off by default: a calendar with no moons behaves exactly as it did before.

Each moon has:

| Field | Meaning |
|---|---|
| Cycle (days) | Days for one complete cycle, from new moon to new moon. Need not be a whole number. Independent of the month length, so phases drift across months. |
| Offset (days) | How far into its cycle the moon already is on Year 1, Month 1, Day 1. Use it to put several moons out of step. |
| Phases | How many named phases the cycle is divided into: 2, 4 or 8. |
| Show in the month grid | Draws a small phase disc in every day cell. Turn it off for moons that only matter occasionally. |
| Visible to players | Hidden moons appear only for GMs, exactly like a hidden Age. |

A phase is centred on its exact point in the cycle, so a moon reads as full on the
day nearest the true midpoint rather than on the day after it. The configuration
row previews each moon's phase on the current campaign date as you edit it.

### Setting calendars

The **Setting calendars** section at the top of the configuration window loads a
ready-made calendar for a published setting. Pick one, decide whether you want its
holiday notes, and press **Load preset**.

| Preset | Structure | Year | Moons |
|---|---|---|---|
| Forgotten Realms (Harptos) | 12 months of 30 days with 5 festival days between them, a 10-day tenday | 365, from 1495 DR | Selûne, 30.45 days, full over Midsummer |
| Pathfinder (Golarion) | 12 months mirroring the real year, 7-day week | 365, from 4710 AR | Somal, 29.5 days |
| Eberron (Galifar) | 12 months of 28 days, 7-day week | 336, from 998 YK | all twelve, 28 days each |
| Greyhawk (Common Year) | 12 months of 28 days with 4 festival weeks | 364, from 591 CY | Luna 28 days, Celene 91 days |
| Dark Sun (Athas) | 12 months of 30 days with 3 five-day sun weeks, 6-day week | 375, from Free Year 1 | Ral 34 days, Guthay 125 days |
| Gregorian (Earth) | The real calendar, 7-day week | 365, from 1 January 2026 | the Moon, 29.53 days |

A preset loads into the configuration editor rather than writing straight to the
world, exactly like a JSON import: the confirmation dialog lists what will change and
where the preset knowingly differs from its setting, and nothing is applied until you
press **Save**. Everything it brings is ordinary editable data — rename a month,
delete a moon or adjust the starting year before saving, and the result is yours.

Each preset also carries an Age list covering its setting's eras, and a year suffix
so dates read as `1495 DR` rather than `Year 1495`.

**Holidays.** Eberron ships 29 holiday notes and the Forgotten Realms 9; Greyhawk and
Dark Sun mark their festivals; Pathfinder and Gregorian ship none. Holidays are
created as ordinary player-visible calendar notes in the preset's starting year, and
only when the checkbox is ticked. They do not repeat in later years — copy or recreate
them if you want them again.

**Where presets are approximate.** This module has no leap years, so Golarion and the
Gregorian calendar run 365 days every year and slip a day against reality every four
years, and Harptos loses Shieldmeet entirely. Dark Sun's 76-year cycle of year names
has no equivalent here. Greyhawk's Luna is full at Richfest but cannot also be full at
the other three festivals, which stand 91 days apart. Eberron's twelve moons share one
staggered 28-day cycle, because a 28-day cycle inside a 28-day month cannot put each
moon full in its own namesake month. The dialog repeats whichever of these applies
when you load a preset.

You can also apply a preset from a macro:

```js
const api = game.modules.get("through-the-ages").api;
api.listPresets();                                    // ids, labels, descriptions
await api.applyPreset("harptos", { createHolidays: true });
```

### Exporting and importing

The **Export and import** section of the configuration window writes the calendar
structure, its moons and the Age list to a JSON file, optionally including the
timeline events. Journal notes are never included — export those with Foundry's own
journal tools.

Importing loads the file into the configuration editor rather than writing it
straight to the world: the GM reviews the result, sees the usual validation and
structural warnings, and presses **Save** to apply it. Cancelling changes nothing.
Staged timeline events replace the existing list only when the form is saved, and
can be discarded first with **Discard staged events**.

Files exported by a newer version of the module are refused rather than partially
read. Older files are upgraded on import through the same migration used for stored
data, and out-of-range values are clamped instead of failing.

### Promoting a player note

On any day note, press **Create timeline event**. The form arrives prefilled with the
note's title, date, and a plain-text excerpt of its content. Choose the event's title,
description, visibility, and optionally tick *Also make the original note visible to
players*. The source note is never deleted or rewritten unless you tick that box, and
the event keeps working even if the note is later removed.

---

## Player workflows

Players can open the calendar, read the current date, browse months and years, and see
the current Age. If the GM has enabled player notes they can add their own day and/or
month notes, and edit or delete the notes they authored.

Players see only their own notes, notes a GM explicitly shared with everyone, and
timeline events marked player-visible. Players can never change the calendar
configuration, the campaign date, Ages, events, or the timeline display mode.

---

## Permissions

| Capability | GM | Player |
|---|---|---|
| Configure the calendar and Ages | yes | no |
| Set or advance the campaign date | yes | no |
| Browse dates | yes | yes |
| Create notes | yes | when enabled by the GM |
| Edit / delete own notes | yes | yes |
| Edit / delete anyone's notes | yes | no |
| Change a note's visibility | yes | no |
| See all notes | yes | no |
| Create / edit / delete timeline events | yes | no |
| Promote a note to an event | yes | no |
| Open the timeline | yes | when enabled by the GM |
| Change the shared timeline mode | yes | no |

Player note writes are relayed to a connected GM over the module socket and
re-validated there, so a player can only ever act on their own note. If no GM is
online the attempt is refused with a clear message rather than failing silently.

---

## How data is stored

| Data | Location |
|---|---|
| Calendar structure, month lengths, current date, moons, Ages | world setting `through-the-ages.calendarData` |
| Timeline events | world setting `through-the-ages.timelineEvents` |
| Note text | Journal Entry Pages in the **Calendar Notes** folder |
| Note metadata (date key, author, visibility) | page flags under `flags.through-the-ages` |
| Browsing position, filters | per-client, never shared |

One Journal Entry exists per date, named with the canonical key, and holds one page
per note:

```
Calendar Notes
└─ 0142-07-12
   ├─ The caravan reaches Toloraria
   ├─ Wrenn's private observation
   └─ GM — Ashfen Roadhouse rumour
```

Month notes live in an entry named `0142-07-00`. Month and day numbers are used as
identifiers, never the editable labels, so renaming a month never disturbs an existing
note. Page ownership carries the privacy: GM-only pages grant nothing by default,
author-private pages grant ownership to the author alone, and shared pages grant
observer rights to everyone. Note bodies the current user may not see are filtered out
before rendering and never reach the calendar's HTML.

---

## Reconfiguring an existing campaign

Changing the calendar after notes exist is allowed, and nothing is ever deleted. The
configuration window warns and asks for explicit confirmation when a change would:

- reduce the months per year below a month already used by a note or event,
- shorten every month below a day number already used, or
- change the weekday count, which relabels the weekday shown for every historical date, or
- replace the timeline events with a set staged by an import.

Dates are stored numerically, so shrinking the calendar leaves existing notes intact
and retrievable — they simply fall outside the browsable grid until the calendar is
grown again.

---

## Troubleshooting

**The Calendar icon does not appear.** Confirm the module is enabled and that the
folder is named exactly `through-the-ages`.

**A player cannot save a note.** Check *Allow player notes* and *Player note scope* in
the module settings, and make sure a GM is connected — player writes need a GM online.

**The Calendar Notes folder was renamed or moved.** The module tracks the folder by id,
so renaming it is harmless. If entries were dragged out of it, use *Rebuild notes
folder* in the configuration window to re-home them.

**Notes exist but do not appear.** Enable *Debug logging* in the module settings and
check the console; a note whose stored date key is unreadable is skipped rather than
crashing the view.

---

## Development

```bash
npm test
node tools/check-manifest.mjs
```

`check-manifest.mjs` guards the packaging mistakes that stay invisible until a
release is already published: a missing field, an id that is not a valid package
slug, `module.json`, `package.json` and the `download` URL disagreeing on the
version, no cover image for the directory listing, or a script, stylesheet or
language file that the manifest declares but the tree does not hold. CI runs it on
every push and pull request, and the release workflow runs it before it builds.

The pure services — date arithmetic, Ages, validation, migrations — carry unit tests
under `tests/` and run under `node --test` with no Foundry runtime. UI, journal, and
socket behaviour is verified manually against Foundry v14 build 366.

The public API is available at `game.modules.get("through-the-ages").api`.

---

## Compatibility

Foundry VTT v14, minimum and verified build **14.366**. System-agnostic: this module
uses only Foundry's public world-time API and has no game-system dependencies.

---

## Releasing

The published version comes from the git tag and nothing else.

1. Land the release's changes on `main`, with their entries under a
   `## [Unreleased]` heading in the CHANGELOG — or under `## [X.Y.Z] - YYYY-MM-DD`
   when the number is already decided.
2. Set the same `X.Y.Z` in `module.json` (both `version` and the `download` URL) and
   in `package.json`, then run `node tools/check-manifest.mjs`.
3. Tag `vX.Y.Z` and push it.

The release workflow runs the tests and the manifest check, stamps the tag's version
onto `module.json`, reconciles the CHANGELOG — renaming `[Unreleased]` to the tag's
version, or refusing outright if the newest section names a different one — and
publishes `module.zip` and `module.json` as release assets, with that changelog
section as the release notes.

The `manifest` URL never changes: it always resolves to the newest release's
`module.json`, which is the URL registered with the Foundry package directory.

The `assets/` artwork is deliberately not in the archive. It is linked from the
repository by the manifest's `media` entries, which the directory reads, and would
otherwise pad every install.

## Licence

MIT — see [LICENSE](LICENSE).
