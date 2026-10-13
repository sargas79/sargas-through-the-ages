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
  holidays: [
    {
      month: 1, day: 1, days: 1, title: "The Day of Rebirth",
      content: "<p>The spring equinox and New Year's Day, a day outside any month. Sacred to"
        + " Cuiraecen and Sera, and the traditional time to start new ventures and renew old"
        + " friendships.</p>"
    },
    {
      month: 5, day: 1, days: 1, title: "The Night of Fire",
      content: "<p>Haelyn's Festival at the summer solstice, when falling stars streak the sky."
        + " Marriages made on this day are said to be blessed by the gods. Sacred to Erik,"
        + " Haelyn and Cuiraecen.</p>"
    },
    {
      month: 8, day: 22, days: 1, title: "Anniversary of Deismaar",
      content: "<p>The anniversary of the Battle of Mount Deismaar, kept across Cerilia. Most"
        + " celebrations honour the ascent of the new gods rather than the battle itself.</p>"
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
      month: 13, day: 1, days: 1, title: "The Eve of the Dead",
      content: "<p>The winter solstice, the one night Haelyn's constellation hides below the"
        + " horizon, and a night of frantic prayer against the Shadow World. Sacred to"
        + " Belinik, Nesirie, Kartathok and the senior faithful of Ruornil.</p>"
    },
    {
      month: 15, day: 32, days: 1, title: "The Feast of Faniele",
      content: "<p>Faniele is sacred to Kriesha. The Vos fast through the month and break it"
        + " with a feast on its last day.</p>"
    },
    {
      month: 16, day: 6, days: 1, title: "The Day of Holy Justice",
      content: "<p>A holy day of Haelyn's faithful.</p>"
    }
  ]
};
