/**
 * Eberron — the Galifar calendar, dated in Years of the Kingdom.
 *
 * The only one of the seven settings that fits without compromise: twelve months
 * of twenty-eight days, a seven-day week, and a 336-day year that is exactly
 * forty-eight weeks long, so no date ever drifts against its weekday.
 */

/** Canon pairs each moon with a month; the colours follow their descriptions. */
const MOONS = [
  { name: "Zarantyr", color: "#e8e6e0" },
  { name: "Olarune", color: "#e8a35c" },
  { name: "Therendor", color: "#c9c9c4" },
  { name: "Eyre", color: "#b8bfc4" },
  { name: "Dravago", color: "#c6b3d9" },
  { name: "Nymm", color: "#e8c96a" },
  { name: "Lharvion", color: "#d8d8d0" },
  { name: "Barrakas", color: "#cfd4d8" },
  { name: "Rhaan", color: "#9fc0e0" },
  { name: "Sypheros", color: "#8a8a8a" },
  { name: "Aryth", color: "#d1663f" },
  { name: "Vult", color: "#7f8489" }
];

export const EBERRON = {
  id: "eberron",
  yearLength: 336,
  calendar: {
    monthsPerYear: 12,
    daysPerMonth: 28,
    monthNames: MOONS.map(moon => moon.name),
    monthLengths: Array(12).fill(28),
    weekdayNames: ["Sul", "Mol", "Zol", "Wir", "Zor", "Far", "Sar"],
    // Canon: 1 Zarantyr is a Sul, and a 48-week year keeps it that way forever.
    weekdayAnchor: { date: { year: 998, month: 1, day: 1 }, weekday: 0 },
    currentDate: { year: 998, month: 1, day: 1 },
    currentTime: { hour: 8, minute: 0 },
    yearPrefix: "",
    yearSuffix: "YK",
    /**
     * The twelve moons share a 28-day cycle, staggered around it so the night
     * sky shows a spread of phases rather than twelve identical discs. A 28-day
     * cycle inside a 28-day month cannot also put every moon full in its own
     * namesake month, which the preset's caveats say out loud.
     */
    moons: MOONS.map((moon, index) => ({
      name: moon.name,
      cycleLength: 28,
      phaseCount: 8,
      color: moon.color,
      showInGrid: true,
      playerVisible: true,
      anchor: { date: { year: 998, month: 1, day: 1 + Math.round((index * 28) / 12) }, phase: "full" }
    }))
  },
  /** Where this preset knowingly departs from the setting, shown when it loads. */
  caveats: [
    "TTA.Presets.eberron.Caveat.MoonCycles",
    "TTA.Presets.eberron.Caveat.ManyMoons"
  ],
  ages: [
    {
      name: "The Kingdom of Galifar",
      startYear: 1,
      durationYears: 893,
      description: "<p>Galifar I unites the Five Nations and founds the kingdom whose coronation"
        + " year begins the calendar. Nine centuries of peace follow.</p>",
      color: "#3f6fa8"
    },
    {
      name: "The Last War",
      startYear: 894,
      durationYears: 103,
      description: "<p>King Jarot dies and his heirs turn on one another. A century of war ends"
        + " only with the destruction of Cyre on the Day of Mourning.</p>",
      color: "#8f3d2e"
    },
    {
      name: "The Thronehold Accords",
      startYear: 997,
      durationYears: 100,
      description: "<p>The Treaty of Thronehold ends the fighting and leaves twelve exhausted"
        + " nations watching one another across new borders.</p>",
      color: "#5b7f6a"
    }
  ],
  holidays: [
    {
      month: 1, day: 6, days: 1, title: "The Tain Gala",
      content: "<p>Lady Celyria ir'Tain holds a ball at her Skyway mansion. The guest list defines"
        + " the social order of Sharn; the families holding permanent invitations, the Sixty, are"
        + " its de facto royalty.</p><p><em>Held once every month.</em></p>"
    },
    {
      month: 1, day: 13, days: 1, title: "Revelation Day",
      content: "<p>Also called Ascension Day. Each Seeker examines the spiritual progress of the"
        + " past year and takes back a portion of what they have given, drinking in turn from the"
        + " ritemaster's chalice at a Sacrament of Blood.</p>"
    },
    {
      month: 1, day: 14, days: 1, title: "Rebirth Eve",
      content: "<p>The Purified new year, falling on the winter solstice. The faithful keep vigil"
        + " through the longest night, guarding against evil, and spend the following day at rest"
        + " or in celebration as they see fit.</p>"
    },
    { month: 1, day: 14, days: 1, title: "Winter Solstice", content: "" },
    {
      month: 2, day: 9, days: 1, title: "Crystalfall",
      content: "<p>A sombre festival marking the destruction of Sharn's Glass Tower in 918 YK. Ice"
        + " sculptures of the tower are carved and thrown into the Dagger River, the largest"
        + " gathering being in Sunset Park.</p>"
    },
    {
      month: 2, day: 18, days: 1, title: "Bright Soul's Day",
      content: "<p>As the dark days of winter close, the Purified celebrate the lives of those who"
        + " died fighting evil to protect the faithful.</p>"
    },
    {
      month: 3, day: 5, days: 1, title: "Tirasday",
      content: "<p>Celebrating the birth of Tira Miron, the Voice of the Flame.</p>"
    },
    {
      month: 3, day: 15, days: 1, title: "Sun's Blessing",
      content: "<p>A festival of Dol Arrah: a day of peace on which enemies set aside their"
        + " differences.</p>"
    },
    {
      month: 4, day: 11, days: 1, title: "Initiation Day",
      content: "<p>The day the priesthood declared itself a faith independent of the Sovereign"
        + " Host. Groundbreaking on a new cathedral and most seminary graduations are still"
        + " scheduled for it.</p>"
    },
    { month: 4, day: 15, days: 1, title: "Spring Equinox", content: "" },
    {
      month: 5, day: 6, days: 1, title: "Baker's Night",
      content: "<p>Families gather to share pastries made by bakers faithful to the Flame. One of"
        + " the most popular holidays and the least understood: no record survives of what it"
        + " celebrates or when it was adopted.</p>"
    },
    {
      month: 5, day: 26, days: 1, title: "Aureon's Crown",
      content: "<p>A celebration of knowledge marked by lectures and sermons, and the secular date"
        + " for graduation ceremonies.</p>"
    },
    {
      month: 5, day: 28, days: 1, title: "Promisetide",
      content: "<p>With nature at its height, the Purified honour the Flame for the promise of the"
        + " paradise to come, when the world is made pure for the faithful.</p>"
    },
    {
      month: 6, day: 12, days: 1, title: "Brightblade",
      content: "<p>Dedicated to Dol Dorn and marked by gladiatorial and athletic contests.</p>"
    },
    {
      month: 6, day: 21, days: 1, title: "First Dawn",
      content: "<p>Commemorating the day in 914 YK when the Church of the Silver Flame assumed"
        + " control of Thrane's government.</p>"
    },
    {
      month: 7, day: 14, days: 1, title: "Silvertide",
      content: "<p>The highest holy day of the faith, celebrating the sacrifice of the couatls and"
        + " the birth of the Silver Flame.</p>"
    },
    { month: 7, day: 15, days: 1, title: "Summer Solstice", content: "" },
    {
      month: 7, day: 23, days: 1, title: "Race of the Eight Winds",
      content: "<p>An aerial race flown around the Dura Quarter.</p>"
    },
    {
      month: 8, day: 4, days: 1, title: "The Hunt",
      content: "<p>In honour of Balinor, marked by communal hunts of dangerous creatures.</p>"
    },
    {
      month: 8, day: 9, days: 1, title: "Victory Day",
      content: "<p>Commemorating the end of the lycanthropic purge. Children act out the final"
        + " battles while adults hear sermons on the triumphs, the defeats, and the sometimes"
        + " questionable methods of the templars.</p>"
    },
    {
      month: 8, day: 25, days: 1, title: "Fathen's Fall",
      content: "<p>Marking a priest of the Silver Flame martyred in Sharn. The day's activities"
        + " often cause tension with the shifter community.</p>"
    },
    {
      month: 9, day: 9, days: 1, title: "Boldrei's Feast",
      content: "<p>A feast of community and an occasion for extravagant parties. Traditionally"
        + " also the day of elections.</p>"
    },
    {
      month: 10, day: 1, days: 1, title: "The Ascension",
      content: "<p>Worshippers remember the sacrifice of Tira Miron, who joined with the Silver"
        + " Flame to become its Voice.</p>"
    },
    {
      month: 10, day: 18, days: 2, title: "Wildnight",
      content: "<p>At sunset the faithful and unfaithful alike give vent to their passions in a"
        + " raucous two-day festival dedicated to the Fury.</p>"
    },
    {
      month: 10, day: 25, days: 1, title: "Saint Valtros's Day",
      content: "<p>The birth of Saint Valtros, the first paladin called to serve the Silver Flame."
        + " Marked chiefly by brief prayers and church services.</p>"
    },
    {
      month: 11, day: 11, days: 1, title: "Signing of the Treaty of Thronehold",
      content: "<p>In 996 YK the Treaty of Thronehold formally ended the Last War. Celebratory"
        + " feasts are held throughout the Five Nations.</p>"
    },
    {
      month: 11, day: 24, days: 1, title: "Rampartide",
      content: "<p>As the nights lengthen the Purified atone and fast, obeying the scripture that"
        + " bids them make of themselves a rampart against wickedness.</p>"
    },
    {
      month: 12, day: 21, days: 1, title: "Khybersef",
      content: "<p>On the longest night the bonds holding the fiendish overlords in Khyber are at"
        + " their weakest. Many quests and crusades are launched on Khyber's Eve.</p>"
    },
    {
      month: 12, day: 26, days: 3, title: "Long Shadows",
      content: "<p>Three days honouring the Shadow, dominated by dark magic.</p>"
    }
  ]
};
