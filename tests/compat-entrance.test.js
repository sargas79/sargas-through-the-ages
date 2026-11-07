import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { playEntrance } from "../scripts/compat.js";

/** Just enough of an element for playEntrance: a class list and listeners. */
function fakeElement() {
  const classes = new Set();
  const listeners = new Map();
  return {
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch: (type, event) => listeners.get(type)?.(event),
    listening: type => listeners.has(type)
  };
}

describe("playEntrance", () => {
  it("marks a window that is opening, and unmarks it once the entrance has played", () => {
    const element = fakeElement();
    playEntrance({ element }, { isFirstRender: true });
    assert.equal(element.classList.contains("tta-entering"), true);

    element.dispatch("animationend", { animationName: "tta-in" });
    assert.equal(element.classList.contains("tta-entering"), false);
    assert.equal(element.listening("animationend"), false);
  });

  it("leaves a re-render alone, so an update does not replay the fade", () => {
    const element = fakeElement();
    playEntrance({ element }, { isFirstRender: false });
    assert.equal(element.classList.contains("tta-entering"), false);
    assert.equal(element.listening("animationend"), false);
  });

  it("ignores other animations ending inside the window", () => {
    const element = fakeElement();
    playEntrance({ element }, { isFirstRender: true });
    element.dispatch("animationend", { animationName: "something-else" });
    assert.equal(element.classList.contains("tta-entering"), true);
  });

  it("does nothing without an element", () => {
    assert.doesNotThrow(() => playEntrance({}, { isFirstRender: true }));
  });
});
