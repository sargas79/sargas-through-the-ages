/**
 * Pure party logic: normalisation, ordering, membership and date lookup.
 *
 * A party is a group of players standing at its own point in the world's
 * history. Parties are plain objects:
 * `{ id, name, color, members: [userId], currentDate, currentTime, sortOrder }`
 *
 * The calendar structure, moons and Ages are shared by every party; only the
 * date, the clock, and (through the stores) the events and notes are per party.
 *
 * ## One "now"
 *
 * `calendar.currentDate` and `calendar.currentTime` keep meaning the *active*
 * party's date. Everything that read the campaign date before parties existed —
 * the header, the `timeChanged` hook, companion modules — keeps reading it
 * there, unchanged. The active party's own record is not consulted for its
 * date; it is brought up to date when another party takes over. See
 * `setActiveParty` in `calendar-service.js`.
 *
 * This file must stay free of Foundry globals so it can be unit tested.
 */

import { DEFAULT_COLOR, LIMITS } from "../constants.js";

/** Normalise a party record, filling defaults and clamping what it can. */
export function normalizeParty(party, index = 0) {
  const members = Array.isArray(party?.members) ? party.members : [];
  const rawDate = party?.currentDate ?? {};
  const rawTime = party?.currentTime ?? {};
  return {
    id: party?.id ?? `party-${index}`,
    name: String(party?.name ?? "").trim().slice(0, LIMITS.PARTY_NAME_MAX),
    color: party?.color || DEFAULT_COLOR,
    members: [...new Set(members.map(id => String(id ?? "").trim()).filter(Boolean))],
    // Dates are clamped against the calendar by the migration, which knows the
    // month lengths; here they are only made numeric.
    currentDate: {
      year: Math.max(LIMITS.YEAR_MIN, Math.trunc(Number(rawDate.year) || LIMITS.YEAR_MIN)),
      month: Math.max(1, Math.trunc(Number(rawDate.month) || 1)),
      day: Math.max(1, Math.trunc(Number(rawDate.day) || 1))
    },
    currentTime: {
      hour: Math.min(23, Math.max(0, Math.trunc(Number(rawTime.hour) || 0))),
      minute: Math.min(59, Math.max(0, Math.trunc(Number(rawTime.minute) || 0)))
    },
    sortOrder: Number.isFinite(Number(party?.sortOrder)) ? Number(party.sortOrder) : index
  };
}

/** Parties in their explicit order, then by name. */
export function sortParties(parties = []) {
  return [...parties].sort((a, b) => {
    const orderA = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    const orderB = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    return (orderA - orderB) || String(a.name).localeCompare(String(b.name));
  });
}

/** One party by id, or null. */
export function findParty(parties = [], partyId) {
  if (!partyId) return null;
  return parties.find(party => party.id === partyId) ?? null;
}

/** True when the user is listed in the party. */
export function isMember(party, userId) {
  return !!party && !!userId && (party.members ?? []).includes(userId);
}

/**
 * The one party a user belongs to, or null.
 *
 * A user is in at most one party. The migration enforces it, so the first
 * match is the only match.
 */
export function partyForUser(parties = [], userId) {
  if (!userId) return null;
  return sortParties(parties).find(party => isMember(party, userId)) ?? null;
}

/**
 * The date a party stands at.
 *
 * The active party's date is the calendar's own; any other party's is on its
 * record. Asking for a party that does not exist, or asking when there are no
 * parties at all, gives the calendar's date, so callers that are not party
 * aware get the answer they always got.
 * @returns {{date:object, time:object}}
 */
export function partyMoment(calendar, parties = [], activePartyId = null, partyId = null) {
  const party = findParty(parties, partyId);
  if (!party || party.id === activePartyId) {
    return { date: calendar.currentDate, time: calendar.currentTime };
  }
  return { date: party.currentDate, time: party.currentTime };
}

/**
 * Users listed in more than one party, each with the party that keeps them.
 * @returns {Array<{userId:string, keptBy:object, droppedFrom:object}>}
 */
export function findDuplicateMembers(parties = []) {
  const seen = new Map();
  const duplicates = [];
  for (const party of sortParties(parties)) {
    for (const userId of party.members ?? []) {
      const keptBy = seen.get(userId);
      if (keptBy) duplicates.push({ userId, keptBy, droppedFrom: party });
      else seen.set(userId, party);
    }
  }
  return duplicates;
}

/**
 * Copy of the list with every user left in only the first party listing them.
 * The order is the sort order, so the party that keeps a user is predictable.
 */
export function dedupeMembers(parties = []) {
  const seen = new Set();
  return sortParties(parties).map(party => {
    const members = (party.members ?? []).filter(userId => {
      if (seen.has(userId)) return false;
      seen.add(userId);
      return true;
    });
    return { ...party, members };
  });
}
