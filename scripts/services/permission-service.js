/**
 * Central authority for "may this user do that?".
 *
 * Every UI surface and every write path asks these helpers instead of testing
 * `game.user.isGM` inline, so the permission model stays in one place.
 */

import { MODULE_ID, PLAYER_SCOPE, SCOPE, SETTINGS, VISIBILITY } from "../constants.js";

function setting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

/** True when the user (defaults to the current user) is a Game Master. */
export function isGM(user = game.user) {
  return !!user?.isGM;
}

/** Only GMs may configure the calendar or change world time. */
export function canConfigureCalendar(user = game.user) {
  return isGM(user);
}

/** Only GMs may set or advance the shared campaign date. */
export function canChangeTime(user = game.user) {
  return isGM(user);
}

/** Only GMs manage Ages. */
export function canManageAges(user = game.user) {
  return isGM(user);
}

/** Only GMs create, edit or delete timeline events. */
export function canManageEvents(user = game.user) {
  return isGM(user);
}

/** Only GMs promote a calendar note into a timeline event. */
export function canPromoteNotes(user = game.user) {
  return isGM(user);
}

/** Whether the user may create a note with the given scope. */
export function canCreateNote(scope, user = game.user) {
  if (isGM(user)) return true;
  if (setting(SETTINGS.PLAYER_NOTE_CREATION, false) !== true) return false;
  const allowed = setting(SETTINGS.PLAYER_NOTE_SCOPE, PLAYER_SCOPE.BOTH);
  if (allowed === PLAYER_SCOPE.BOTH) return true;
  return allowed === scope;
}

/** The note scopes the user may currently create. */
export function allowedNoteScopes(user = game.user) {
  return [SCOPE.DAY, SCOPE.MONTH].filter(scope => canCreateNote(scope, user));
}

/**
 * Whether a note (described by its module flags) is visible to a user.
 * GMs always see every note.
 *
 * This file knows nothing about parties, so a party note's membership test is
 * the caller's to supply: `isPartyMember` says whether the user is in the
 * note's party. The author sees their own party note whether or not they are
 * still in that party.
 */
export function canViewNote(noteFlags, user = game.user, { isPartyMember = false } = {}) {
  if (!noteFlags) return false;
  if (isGM(user)) return true;
  if (noteFlags.visibility === VISIBILITY.PLAYERS) return true;
  if (noteFlags.visibility === VISIBILITY.AUTHOR_AND_GM) return noteFlags.authorId === user.id;
  if (noteFlags.visibility === VISIBILITY.PARTY) return isPartyMember || noteFlags.authorId === user.id;
  return false;
}

/** Authors may edit their own notes; GMs may edit anything. */
export function canEditNote(noteFlags, user = game.user) {
  if (!noteFlags) return false;
  if (isGM(user)) return true;
  return noteFlags.authorId === user.id;
}

/** Same rule as editing: authors and GMs. */
export function canDeleteNote(noteFlags, user = game.user) {
  return canEditNote(noteFlags, user);
}

/** Only GMs may change a note's visibility classification. */
export function canChangeNoteVisibility(user = game.user) {
  return isGM(user);
}

/** Whether the user may open the timeline application at all. */
export function canViewTimeline(user = game.user) {
  if (isGM(user)) return true;
  return setting(SETTINGS.SHOW_TIMELINE_TO_PLAYERS, true) === true;
}

/** Whether a timeline event is visible to a user. */
export function canViewEvent(event, user = game.user) {
  if (!event) return false;
  if (isGM(user)) return true;
  return event.visibility === VISIBILITY.PLAYERS;
}

/** Whether the user may change the shared timeline display mode. */
export function canSetTimelineMode(user = game.user) {
  return isGM(user);
}

/**
 * Foundry ownership levels for a note page, derived from its visibility.
 * GM accounts always retain access through their global GM role.
 *
 * A party note names its members here, since this is where the document's
 * delivery is decided: the members observe, the author owns, nobody else gets
 * the page at all.
 */
export function ownershipForVisibility(visibility, authorId, partyMembers = []) {
  const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  switch (visibility) {
    case VISIBILITY.PLAYERS:
      return { default: LEVELS.OBSERVER };
    case VISIBILITY.AUTHOR_AND_GM: {
      const ownership = { default: LEVELS.NONE };
      if (authorId) ownership[authorId] = LEVELS.OWNER;
      return ownership;
    }
    case VISIBILITY.PARTY: {
      const ownership = { default: LEVELS.NONE };
      for (const userId of partyMembers ?? []) ownership[userId] = LEVELS.OBSERVER;
      if (authorId) ownership[authorId] = LEVELS.OWNER;
      return ownership;
    }
    case VISIBILITY.GM_ONLY:
    default:
      return { default: LEVELS.NONE };
  }
}
