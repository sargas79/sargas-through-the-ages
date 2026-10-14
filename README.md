# Sargas Through the Ages

A world-calendar and campaign-history module for **Foundry VTT v14 (build 366)**.

Sargas Through the Ages gives a world one shared, fully custom calendar; stores campaign
notes as real Journal Entries; and adds a separate visual timeline of **Ages** and
historical **events**. Everything is reachable from a single **Calendar** button at
the top of the **Journal** tab in the sidebar.

The module is system-agnostic — it adds no game mechanics and works in any v14 world.

---

## Features

- **Setting calendars**: ready-made presets for the Forgotten Realms, Pathfinder,
  Eberron, Greyhawk, Dark Sun, Birthright and the real-world Gregorian calendar, with
  their months, moons, eras and holidays already dated.
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
- **Parties**: for a world where two or more groups play at different points in its
  history. Each party has its own date and clock, and its own events and shared notes
  that the other party never receives; the calendar, moons and Ages are shared.
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

**From the package directory** — search for **Sargas Through the Ages** in Foundry's
*Add-on Modules → Install Module* browser.

**From a manifest URL** — in the same dialog, paste:

```
https://github.com/sargas79/sargas-through-the-ages/releases/latest/download/module.json
```

**Manually** — download the release archive and extract it so the module lives at
`Data/modules/sargas-through-the-ages/`. The folder name must match the package id exactly.

Then enable **Sargas Through the Ages** in *Game Settings → Manage Modules*.

---

## First-time setup

1. Enable the module. Nothing is created in your world until you save a configuration.
2. Open **Game Settings → Configure Settings → Sargas Through the Ages → Configure Calendar**.
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
| Visible to players | Hidden moons are not drawn for players. See the note on moons under *What privacy means here*. |

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
| Birthright (Anuire) | 12 months of 32 days with 4 festival days between them, 8-day week | 388, from 1524 HC | the Moon, new at the start of every month |
| Gregorian (Earth) | The real calendar, 7-day week | 365, from 1 January 2026 | the Moon, 29.53 days |

A preset loads into the configuration editor rather than writing straight to the
world, exactly like a JSON import: the confirmation dialog lists what will change and
where the preset knowingly differs from its setting, and nothing is applied until you
press **Save**. Everything it brings is ordinary editable data — rename a month,
delete a moon or adjust the starting year before saving, and the result is yours.

Each preset also carries an Age list covering its setting's eras, and a year suffix
so dates read as `1495 DR` rather than `Year 1495`.

**Holidays.** Eberron ships 29 holiday notes, Birthright 20 and the Forgotten Realms 9;
Greyhawk and Dark Sun mark their festivals; Pathfinder and Gregorian ship none.
Holidays are created as ordinary player-visible calendar notes in the preset's starting
year, and only when the checkbox is ticked. They do not repeat in later years — copy or recreate
them if you want them again.

**Where presets are approximate.** This module has no leap years, so Golarion and the
Gregorian calendar run 365 days every year and slip a day against reality every four
years, and Harptos loses Shieldmeet entirely. Birthright's four festival days fall
outside the week in the setting, but this module counts weekdays through them, so only
the spring months of 1524 HC begin on Firlen as canon says. Dark Sun's 76-year cycle
of year names has no equivalent here. Greyhawk's Luna is full at Richfest but cannot also be full at
the other three festivals, which stand 91 days apart. Eberron's twelve moons share one
staggered 28-day cycle, because a 28-day cycle inside a 28-day month cannot put each
moon full in its own namesake month. The dialog repeats whichever of these applies
when you load a preset.

You can also apply a preset from a macro:

```js
const api = game.modules.get("sargas-through-the-ages").api;
api.listPresets();                                    // ids, labels, descriptions
await api.applyPreset("harptos", { createHolidays: true });
```

### Exporting and importing

The **Export and import** section of the configuration window writes the calendar
structure, its moons, the Age list and the parties to a JSON file, optionally
including the timeline events. Party members are left out, since they are this
world's user accounts; a file that defines parties brings them in empty, and the
import dialog says so. Journal notes are never included — export those with Foundry's
own journal tools.

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

An event made from a player's note is always visible to players and belongs to the
author's party, if they are in one. Promoting your own note leaves the visibility and
party up to you.

### Parties

Parties are for one world that two or more groups play in, each at a different point
in its history. Leave the section empty if one group plays in your world; nothing
changes.

In the **Parties** section of the configuration window, add a party, give it a name
and colour, and pick its members from the world's player accounts. A player can be
in one party; picking a player who is already in another party moves them. The first
party you add becomes the **active party** and takes the current campaign date.

- **The calendar stands on the active party's date.** Everyone sees it, the header
  names the party, and the time controls and *Set date* move it. Its time changes
  drive Foundry world time exactly as before parties existed.
- **Switching parties.** A GM with more than one party gets a picker in the calendar
  header. Choosing another party stores the current date on the outgoing party,
  loads the incoming party's date into the calendar, and leaves Foundry world time
  alone: a switch is not time passing. The configuration window's *Active party*
  radio does the same on save.
- **Where the others stand.** A GM sees a coloured marker on the month grid for each
  party that is not active. Players do not.
- **Events** can belong to a party (the *Party* field in the event editor) or be
  shared. A party's player-visible events are stored where only its members and the
  GMs receive them. The timeline gets a filter per party, and each card a party tag.
- **Notes** gain a *Party* visibility. A player in a party gets a *Share with my
  party* box in the note editor: the one visibility change a player can make, and
  only for their own party.
- **Removing a party** asks where its events and shared notes go: to another party, or
  to everyone. Removing the last party turns parties off and keeps the campaign date.

A party's own date can also be moved without making it active, through the API
(`advanceTime(seconds, { partyId })` and friends). Such a move changes only that
party's record and never Foundry world time; see the hooks below.

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
| Change a note's visibility | yes | only to share an own note with their own party, or take it back |
| See all notes | yes | no |
| Define parties, assign members, switch the active party | yes | no |
| Create / edit / delete timeline events | yes | no |
| Promote a note to an event | yes | no |
| Open the timeline | yes | when enabled by the GM |
| Change the shared timeline mode | yes | no |

Player note writes are relayed to a connected GM and re-validated there, so a
player can only ever act on their own note. If no GM is online the attempt is
refused with a clear message rather than failing silently.

The relay carries a request as a flag on the requesting player's **own User
document**, rather than as a socket message. Foundry lets a player update only
their own user, so the GM's client learns who is asking from the document that
changed rather than from a field inside the request — which a sending client
would be free to write. Nothing in a request's payload is trusted; only the
identity behind it is something the server vouched for.

---

## How data is stored

| Data | Location |
|---|---|
| Calendar structure, month lengths, current date, moons, player-visible Ages, parties (names, members, dates) and the active party | world setting `sargas-through-the-ages.calendarData` |
| Player-visible shared timeline events | world setting `sargas-through-the-ages.timelineEvents` |
| Hidden Ages, GM-only timeline events | flags on the **Calendar (GM only)** journal entry, which nobody owns |
| A party's player-visible timeline events | flags on that party's **Calendar (party: …)** journal entry, observed by its members only |
| Note text | Journal Entry Pages in the **Calendar Notes** folder |
| Note metadata (date key, author, visibility, party) | page flags under `flags.sargas-through-the-ages` |
| Browsing position, filters | per-client, never shared |
| In-flight player note writes | flags on the requesting player's own User document, cleared once handled |

One Journal Entry exists per date, named with the canonical key, and holds one page
per note:

```
Calendar Notes
├─ 0142-07-12
│  ├─ The caravan reaches Toloraria
│  ├─ Wrenn's private observation
│  └─ GM — Ashfen Roadhouse rumour
├─ Calendar (GM only)
└─ Calendar (party: The Northern Company)
```

---

## What privacy means here

Foundry sends every **world setting** to every connected client. Anything kept in
one is readable by any player who opens a console, whatever the interface chooses
to show them. Document **ownership** is the rule Foundry actually enforces: a
document a player has no ownership of is never sent to their client at all.

So everything this module treats as secret is stored as a document, not a setting:

- **Note bodies** are journal pages. A GM-only page grants nothing by default, an
  author-private page grants ownership to its author alone.
- **Hidden Ages** and **GM-only timeline events** live in the **Calendar (GM only)**
  entry inside the notes folder, which nobody owns by default. Marking an Age hidden
  or an event GM-only moves it there; revealing it moves it back into the world
  setting. Before version 2.2 these were kept in world settings, where the marking
  filtered them out of the interface but not out of the data.

**Moons are the exception.** A moon's *Visible to players* switch keeps it out of
the header, the day panel and the month grid, but the moon list is part of the
calendar structure every client needs in order to draw a date, so a hidden moon's
name and cycle are still in data a determined player can read. Treat it as a
display control, not as a secret. Nothing else about a moon is private in the first
place — its phase is a function of the date everyone already has.

If a GM changes the **Calendar (GM only)** entry's permissions from the journal
sidebar, *Repair notes folder* in the configuration window resets them, and the
module also resets them on load.

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
folder is named exactly `sargas-through-the-ages`.

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
version, a CHANGELOG whose newest section names a different version, no cover image
for the directory listing, or a script, stylesheet or language file that the
manifest declares but the tree does not hold. CI runs it on
every push and pull request, and the release workflow runs it before it builds.

The pure services — date arithmetic, Ages, validation, migrations — carry unit tests
under `tests/` and run under `node --test` with no Foundry runtime. UI, journal, and
socket behaviour is verified manually against Foundry v14 build 366.

The public API is available at `game.modules.get("sargas-through-the-ages").api`.

### Hooks

Every hook fires on the client that made the change, not on every client. A
module that must see changes made from any GM's window listens to the
`updateSetting` document hook for `sargas-through-the-ages.calendarData` and uses these
as a fast path.

| Hook | Payload | When |
|---|---|---|
| `sargas-through-the-ages.timeChanged` | `{ date, time, previous: { date, time }, elapsedSeconds, reason, partyId }` | The campaign date or time was set. `elapsedSeconds` is signed (negative on a rewind). `reason` is one of `api.TIME_CHANGE_REASON`: `"advance"` (the header controls, `advanceTime`, `advanceDays`), `"nextAdventureDay"`, or `"set"` (the date picker, `setCurrentDateTime`, a bare `advanceTo`). `partyId` is the active party's id, or `null` in a world without parties. |
| `sargas-through-the-ages.dateChanged` | `date` | Same moment, date only. Kept for older listeners. |
| `sargas-through-the-ages.partyTimeChanged` | `{ date, time, previous: { date, time }, elapsedSeconds, reason, partyId }` | A party that is **not** active had its own date or time moved (`api.advanceTime(seconds, { partyId })` and the like). The campaign date and Foundry world time did not change, and `timeChanged` did not fire: this is not time passing at the table. |
| `sargas-through-the-ages.activePartyChanged` | `{ partyId, previousPartyId }` | A GM made another party active. The campaign date now reads that party's date; Foundry world time did not change and `timeChanged` did not fire. A companion that tracks the campaign date should re-read it rather than treat the jump as elapsed time. |
| `sargas-through-the-ages.calendarConfigured` | `{ calendar, previous: { monthsPerYear, monthLengths, monthNames }, structureChanged }` | The calendar was saved from the configuration window, a preset or an import. Not emitted for Age-only saves. `structureChanged` is true when the month count or any month length differs, which is when dates stored by other modules may have become invalid. |

### For companion modules

`api.utils` carries the pure calendar arithmetic, each taking a `calendar` block
(`api.getCalendar()`): `addDays`, `addSeconds(date, time, seconds, calendar)`,
`toAbsoluteDay`, `fromAbsoluteDay`, `campaignSeconds(date, time, calendar)` and the
key helpers. Using these rather than re-implementing month sums keeps a companion's
deadlines in exact agreement with the calendar.

Parties change nothing for a companion that only reads `api.getCurrentDate()` and
listens to `timeChanged`: both are about the active party, which is what the table
is playing. `api.getParties()`, `api.getActiveParty()`, `api.getPartyDate(partyId)`
and `api.getPartyForUser(user)` are there for a companion that wants to know about
the others, and `api.utils.partyForUser(parties, userId)` is the pure lookup.

`api.relay.createRelay({ moduleId })` builds (once per module id) an instance of the authenticated
GM-executed write relay described under *What privacy means here*, with every flag
namespaced under the companion's own id. It returns `{ request, registerHandler,
registerRelay, clearStaleRelayFlags, verifyRelayAvailable, isPrimaryGM,
hasActiveGM }`. `api.relay.isPrimaryGM()` is the same election this module uses
(lowest id among connected GMs), so a companion that executes on the primary GM
always agrees with Through the Ages about who that is.

---

## Compatibility

Foundry VTT v14, minimum and verified build **14.366**. System-agnostic: this module
uses only Foundry's public world-time API and has no game-system dependencies.

---

## Releasing

The published version comes from the git tag and nothing else.

1. Land the release's changes on `main`, with their entries under the
   `## [Unreleased]` heading in the CHANGELOG.
2. On a branch, run `npm run release:prepare -- X.Y.Z`. It sets `X.Y.Z` in
   `module.json` (both `version` and the `download` URL) and in `package.json`, and
   renames `[Unreleased]` to `[X.Y.Z]` with today's date and a link to the release.
   Commit that and merge it to `main`.
3. Tag the merge commit `vX.Y.Z` and push the tag. If tags cannot be pushed from
   where you are, run the **Release** workflow by hand with the tag name; it creates
   the tag on the dispatched commit when it does not exist yet.

The release workflow runs the tests and the manifest check, stamps the tag's version
onto the packaged `module.json`, and publishes `module.zip` and `module.json` as
release assets, with the tag's CHANGELOG section as the release notes. It refuses a
tag whose commit was not prepared — a CHANGELOG still headed `[Unreleased]`, or
naming another version — so the changelog on `main` always matches what was
released. The manifest check also runs on every pull request and fails when the
CHANGELOG's newest section is neither `[Unreleased]` nor `module.json`'s version,
dated and linked.

The `manifest` URL never changes: it always resolves to the newest release's
`module.json`, which is the URL registered with the Foundry package directory.

The `assets/` artwork is deliberately not in the archive. It is linked from the
repository by the manifest's `media` entries, which the directory reads, and would
otherwise pad every install.

## Licence

MIT — see [LICENSE](LICENSE).
