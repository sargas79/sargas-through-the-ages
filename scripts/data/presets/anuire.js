/**
 * Birthright — the Anuirean calendar of Cerilia, dated in Haelyn's Count.
 *
 * Twelve months of thirty-two days with a festival day at each equinox and
 * solstice: 388 days. The festivals are ordinary one-day months here.
 *
 * Haelyn's Count is used rather than the Michaeline Reckoning Anuireans date by
 * (551 MR = 1524 HC) because it starts at the Battle of Mount Deismaar, so the
 * Empire's whole history falls in positive years and can be shown as Ages.
 */

export const ANUIRE = {
  id: "anuire",
  yearLength: 388,
  calendar: {
    monthsPerYear: 16,
    daysPerMonth: 32,
    monthNames: [
      "Day of Rebirth", "Sarimiere", "Talienir", "Roelir",
      "Night of Fire", "Haelynir", "Anarire", "Deismir",
      "Veneration of the Sleeping", "Erntenir", "Sehnir", "Emmanir",
      "Eve of the Dead", "Keltier", "Faniele", "Pasiphiel"
    ],
    monthLengths: [1, 32, 32, 32, 1, 32, 32, 32, 1, 32, 32, 32, 1, 32, 32, 32],
    weekdayNames: ["Firlen", "Relen", "Dielen", "Varilen", "Branlen", "Barlen", "Mierlen", "Taelen"],
    // The Book of Days opens every month on a Firlen.
    weekdayAnchor: { date: { year: 1524, month: 2, day: 1 }, weekday: 0 },
    currentDate: { year: 1524, month: 2, day: 1 },
    currentTime: { hour: 8, minute: 0 },
    yearPrefix: "",
    yearSuffix: "HC",
    moons: [
      {
        name: "The Moon",
        // Canon gives 32 days, but a 32-day cycle slips a day at every festival.
        // A twelfth of the year keeps each month opening on the new moon to
        // within a day and comes back exact every quarter, forever.
        cycleLength: 388 / 12,
        phaseCount: 8,
        color: "#e8e6df",
        showInGrid: true,
        playerVisible: true,
        // Each month starts with the new moon and is full on its 16th to 18th.
        anchor: { date: { year: 1524, month: 2, day: 1 }, phase: "new" }
      }
    ]
  },
  /** Where this preset knowingly departs from the setting, shown when it loads. */
  caveats: [
    "TTA.Presets.anuire.Caveat.Week"
  ],
  ages: [
    {
      name: "Roele's Conquest",
      startYear: 1,
      durationYears: 60,
      description: "<p>The old gods die at Mount Deismaar and their champions rise as new ones."
        + " Roele unites the Andu tribes, founds the City of Anuire and carries the Iron"
        + " Throne's banner into Brechtür and the Rjurik lands.</p>",
      color: "#8f3d2e"
    },
    {
      name: "The Anuirean Empire",
      startYear: 61,
      durationYears: 913,
      description: "<p>Roele's heirs hold the Iron Throne for nine centuries, from Boeric's"
        + " accession to the death of Michael Roele, the last Emperor, at the Gorgon's"
        + " hand. Anuireans count the Michaeline Reckoning from that death.</p>",
      color: "#a8873a"
    },
    {
      name: "The Wars of Succession",
      startYear: 974,
      durationYears: 127,
      description: "<p>With no Emperor, the great houses fight over the Iron Throne while"
        + " Brechtür, the Rjurik realms and the Khinasi lands throw off Anuirean rule.</p>",
      color: "#6d4a7f"
    },
    {
      name: "The Divided Realms",
      startYear: 1101,
      durationYears: 500,
      description: "<p>The Empire is gone and the Iron Throne stands empty. Blooded regents"
        + " rule a patchwork of rival realms, and the awnsheghlien grow bolder.</p>",
      color: "#3f6fa8"
    }
  ],
  // Dated as the Book of Days dates them. Festivals defined by a weekday or the
  // moon are placed where canon puts them in a month that opens on a Firlen.
  holidays: [
    {
      month: 1, day: 1, days: 1, title: "The Day of Rebirth",
      content: "<p>The spring equinox and New Year's Day, a day outside any month. Sacred to"
        + " Cuiraecen and Sera, and the traditional time to start new ventures and renew old"
        + " friendships.</p>"
    },
    {
      month: 2, day: 1, days: 1, title: "The Betrayal of Man",
      content: "<p>Remembered by the elves of Anuire on the day after the spring equinox, the"
        + " day men turned on the Sidhelien. Riders of the gheallie Sidhe hunt men in its"
        + " memory.</p>"
    },
    {
      month: 2, day: 17, days: 1, title: "Foregathering of the Erebannien",
      content: "<p>Held in Aerenwe at the standing stones of Shadowgreen from the first full moon"
        + " after the Day of Rebirth. The rangers of the Erebannien gather with priests of Erik"
        + " and Ruornil and with bards for feasting, hunting, a market, archery and"
        + " wrestling.</p>"
    },
    {
      month: 3, day: 3, days: 1, title: "Kira's Dance",
      content: "<p>Kept by the followers of Eloele for Kira, a small Vos warrior who stole a ham"
        + " from the tribe that raided her own and led its warriors on a chase across"
        + " ice she had broken that morning.</p>"
    },
    {
      month: 3, day: 17, days: 2, title: "The Day of Revelry",
      content: "<p>The most boisterous elven festival, held midway between the spring equinox"
        + " and the summer solstice. Elves, faerie folk and their forest friends feast and"
        + " dance, and some say the second day is for recovering. Humans are not"
        + " encouraged to attend.</p>"
    },
    {
      month: 4, day: 12, days: 1, title: "El-Arrasi's Day",
      content: "<p>The Khinasi remember el-Arrasi's victory over the Emperor Alandalae, which won"
        + " the Basarji near-independence from Anuire. El-Arrasi was poisoned by the Sons of the"
        + " Serpent on the same day twelve years later.</p>"
    },
    {
      month: 4, day: 28, days: 7, title: "High Summer's Fest",
      content: "<p>Held at Dhalsiel in Mhoried from five days before the Night of Fire to the day"
        + " after. A great hunt and feast open days of footraces, archery, riding and wrestling"
        + " among Erik's rangers, and the bards sing of the victors.</p>"
    },
    {
      month: 5, day: 1, days: 1, title: "The Night of Fire",
      content: "<p>Haelyn's Festival at the summer solstice, when falling stars streak the sky."
        + " Marriages made on this day are said to be blessed by the gods. Sacred to Erik,"
        + " Haelyn and Cuiraecen.</p>"
    },
    {
      month: 6, day: 18, days: 1, title: "The Challenge of Shaene",
      content: "<p>Cuiraecen's valiants go questing in honour of Shaene, who rode out alone to"
        + " face an ogre while the village hunters were still planning their traps.</p>"
    },
    {
      month: 8, day: 22, days: 1, title: "Anniversary of Deismaar",
      content: "<p>The anniversary of the Battle of Mount Deismaar, kept across Cerilia and the"
        + " holiest day in Haelyn's calendar. Most celebrations honour the ascent of the new"
        + " gods rather than the battle itself.</p>"
    },
    {
      month: 8, day: 30, days: 1, title: "The Burning of the Shade",
      content: "<p>A Vos festival a week after the anniversary of Deismaar. A Shade, usually a"
        + " scarecrow draped in black, is burnt on a great bonfire in contempt of the Lost,"
        + " Azrai's necromancers, whom the Vos blame for the defeat.</p>"
    },
    {
      month: 9, day: 1, days: 1, title: "The Veneration of the Sleeping",
      content: "<p>The autumn equinox, a day outside any month, particularly sacred to"
        + " Ruornil.</p>"
    },
    {
      month: 10, day: 17, days: 1, title: "High Festival of the Autumn Moon",
      content: "<p>Held under the first full moon after the Veneration of the Sleeping, with a"
        + " moonlit feast and recited lore.</p>"
    },
    {
      month: 11, day: 11, days: 1, title: "Eloele's Birthday",
      content: "<p>Celebrated by the followers of Eloele as the birthday of the Lady of"
        + " Night.</p>"
    },
    {
      month: 12, day: 31, days: 3, title: "The Call of Days",
      content: "<p>A three-day festival of lights in Boeruine, above all in Calant, ending on the"
        + " Eve of the Dead. The Northern Imperial Temple hands out flowers from its holy"
        + " gardens with alms, and a great bonfire burns inside a circle of standing"
        + " stones.</p>"
    },
    {
      month: 13, day: 1, days: 1, title: "The Eve of the Dead",
      content: "<p>The winter solstice, the one night Haelyn's constellation hides below the"
        + " horizon, and a night of frantic prayer against the Shadow World. Sacred to"
        + " Belinik, Nesirie, Kartathok and the senior faithful of Ruornil.</p>"
    },
    {
      month: 14, day: 8, days: 1, title: "All Shadow's Fled",
      content: "<p>Held on the Taelen after the Eve of the Dead, when the undead are said to"
        + " return to the Shadow World. Local lords keep it as a public festival to coax"
        + " frightened peasants back out of doors.</p>"
    },
    {
      month: 15, day: 32, days: 1, title: "The Feast of Faniele",
      content: "<p>Faniele is sacred to Kriesha. The Vos fast through the month and break it"
        + " with a feast on its last day.</p>"
    },
    {
      month: 16, day: 6, days: 1, title: "The Day of Holy Justice",
      content: "<p>The day the Book of Laws, Haelyn's most sacred text, appeared in the"
        + " Avelerine Cathedral, his first temple.</p>"
    },
    {
      month: 16, day: 15, days: 1, title: "Gretchen's Flight",
      content: "<p>The Rjurik remember Gretchen, a young druid who took the form of a deer to"
        + " lead goblins away from her starving tribe and ran to Viborg to bring help,"
        + " dying of exhaustion once her message was delivered.</p>"
    }
  ]
};
