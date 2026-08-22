import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { FLAGS, MODULE_ID } from "../scripts/constants.js";
import { installRelayWorld } from "./helpers/relay-stub.js";

const GM = { id: "gm1", name: "The GM", isGM: true };
const ALICE = { id: "alice", name: "Alice" };
const BOB = { id: "bob", name: "Bob" };

let harness = null;

afterEach(() => {
  harness?.restore();
  harness = null;
});

/**
 * Load the relay fresh for each test.
 *
 * The module keeps per-client state — pending promises, the set of already
 * executed requests — so a cache-busting import is what makes one test's
 * traffic invisible to the next.
 */
async function loadRelay() {
  return import(`../scripts/services/relay-service.js?t=${Math.random()}`);
}

describe("relay identity", () => {
  it("hands the handler the document the request was written on", async () => {
    harness = installRelayWorld([GM, ALICE], "gm1");
    const relay = await loadRelay();

    const seen = [];
    relay.registerHandler("probe", async (payload, user) => {
      seen.push({ name: user.name, id: user.id, payload });
      return "done";
    });
    relay.registerRelay();

    // Alice writes the request on her own document. This process is standing
    // in for the GM's client, which is where the handler runs.
    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.REQUESTS}.r1`]: { operation: "probe", payload: { note: "hi" } }
    }, "alice");

    assert.equal(seen.length, 1);
    assert.equal(seen[0].id, "alice");
    assert.deepEqual(seen[0].payload, { note: "hi" });
  });

  // This is the vulnerability the transport was changed to close. Under the old
  // socket relay the requester was a `userId` field the sender wrote, so Bob
  // could name Alice — or a GM — and be granted their permissions.
  it("does not let one user's request be attributed to another", async () => {
    harness = installRelayWorld([GM, ALICE, BOB], "gm1");
    const relay = await loadRelay();

    const seen = [];
    relay.registerHandler("probe", async (payload, user) => {
      seen.push(user.id);
    });
    relay.registerRelay();

    // The write lands on Alice's document but was performed by Bob. Only a GM
    // could actually do this; the point is that even then it is not read as
    // Alice asking, which is exactly what the socket transport got wrong.
    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.REQUESTS}.r1`]: { operation: "probe", payload: {} }
    }, "bob");

    assert.deepEqual(seen, [], "a request not written by its own user must be ignored");
  });

  it("ignores a request written onto a user by a GM", async () => {
    harness = installRelayWorld([GM, ALICE], "gm1");
    const relay = await loadRelay();

    const seen = [];
    relay.registerHandler("probe", async (payload, user) => seen.push(user.id));
    relay.registerRelay();

    // The GM writes onto Alice's document. A GM may do this, and it still is
    // not Alice asking for anything.
    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.REQUESTS}.r1`]: { operation: "probe", payload: {} }
    }, "gm1");

    assert.deepEqual(seen, []);
  });
});

describe("relay execution", () => {
  it("runs a request only once, however often the hook fires", async () => {
    harness = installRelayWorld([GM, ALICE], "gm1");
    const relay = await loadRelay();

    let runs = 0;
    relay.registerHandler("probe", async () => { runs += 1; });
    relay.registerRelay();

    const alice = harness.users.get("alice");
    const path = `flags.${MODULE_ID}.${FLAGS.REQUESTS}.r1`;
    await alice.update({ [path]: { operation: "probe", payload: {} } }, "alice");
    // A second update to the same flags, as any unrelated write would produce.
    await alice.update({ [`flags.${MODULE_ID}.other`]: 1 }, "alice");

    assert.equal(runs, 1);
  });

  it("clears the request flag once it has been handled", async () => {
    harness = installRelayWorld([GM, ALICE], "gm1");
    const relay = await loadRelay();
    relay.registerHandler("probe", async () => "ok");
    relay.registerRelay();

    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.REQUESTS}.r1`]: { operation: "probe", payload: {} }
    }, "alice");

    assert.deepEqual(alice.getFlag(MODULE_ID, FLAGS.REQUESTS), {});
  });

  it("reports an unsupported operation back rather than throwing into the hook", async () => {
    harness = installRelayWorld([GM, ALICE], "gm1");
    const relay = await loadRelay();
    relay.registerRelay();

    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.REQUESTS}.r1`]: { operation: "nope", payload: {} }
    }, "alice");

    const responses = alice.getFlag(MODULE_ID, FLAGS.RESPONSES);
    assert.equal(responses.r1.ok, false);
    assert.match(responses.r1.error, /Unsupported operation/);
  });

  it("carries a handler's failure back as the response, not as a success", async () => {
    harness = installRelayWorld([GM, ALICE], "gm1");
    const relay = await loadRelay();
    relay.registerHandler("probe", async () => { throw new Error("denied"); });
    relay.registerRelay();

    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.REQUESTS}.r1`]: { operation: "probe", payload: {} }
    }, "alice");

    assert.equal(alice.getFlag(MODULE_ID, FLAGS.RESPONSES).r1.ok, false);
    assert.equal(alice.getFlag(MODULE_ID, FLAGS.RESPONSES).r1.error, "denied");
  });
});

describe("relay availability", () => {
  it("refuses to send when no GM is connected", async () => {
    harness = installRelayWorld([{ ...GM, active: false }, ALICE], "alice");
    const relay = await loadRelay();
    await assert.rejects(() => relay.request("probe", {}), /NoActiveGM/);
  });

  it("reports the transport as unavailable when the user cannot write their own flags", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    harness.users.get("alice").readOnly = true;

    assert.equal(await relay.verifyRelayAvailable(), false);
  });

  it("says the transport is available when the write goes through", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    assert.equal(await relay.verifyRelayAvailable(), true);
  });

  it("leaves no probe flag behind after checking", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    await relay.verifyRelayAvailable();
    assert.equal(harness.users.get("alice").getFlag(MODULE_ID, FLAGS.RELAY_PROBE), undefined);
  });

  it("clears flags a previous session left behind", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.REQUESTS}.old1`]: { operation: "probe" },
      [`flags.${MODULE_ID}.${FLAGS.RESPONSES}.old2`]: { ok: true }
    });

    const cleared = await relay.clearStaleRelayFlags();
    assert.equal(cleared, 2);
    assert.deepEqual(alice.getFlag(MODULE_ID, FLAGS.REQUESTS), {});
    assert.deepEqual(alice.getFlag(MODULE_ID, FLAGS.RESPONSES), {});
  });
});

describe("the primary GM", () => {
  it("is the lowest-id connected GM, so exactly one client executes", async () => {
    harness = installRelayWorld(
      [{ id: "gm2", name: "Second", isGM: true }, { id: "gm1", name: "First", isGM: true }, ALICE],
      "gm1"
    );
    const relay = await loadRelay();
    assert.equal(relay.isPrimaryGM(), true);

    harness.actAs("gm2");
    assert.equal(relay.isPrimaryGM(), false);
  });

  it("does not count a disconnected GM as able to service requests", async () => {
    harness = installRelayWorld([{ ...GM, active: false }, ALICE], "alice");
    const relay = await loadRelay();
    assert.equal(relay.hasActiveGM(), false);
  });
});

describe("the requesting client", () => {
  // The two halves cannot both run in one process — a client is either the GM
  // executing or the player waiting — so the GM's write is simulated here and
  // what is under test is that the waiting promise settles from it.
  it("resolves its pending promise from the response written back", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    relay.registerRelay();

    const alice = harness.users.get("alice");
    const pending = relay.request("probe", { note: "hi" });

    // The request landed on Alice's own document for a GM to find.
    const requests = alice.getFlag(MODULE_ID, FLAGS.REQUESTS);
    const [requestId, entry] = Object.entries(requests)[0];
    assert.equal(entry.operation, "probe");
    assert.deepEqual(entry.payload, { note: "hi" });

    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.RESPONSES}.${requestId}`]: { ok: true, result: "written" }
    }, "gm1");

    assert.equal(await pending, "written");
  });

  it("rejects when the response carries a refusal", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    relay.registerRelay();

    const alice = harness.users.get("alice");
    const pending = relay.request("probe", {});
    const requestId = Object.keys(alice.getFlag(MODULE_ID, FLAGS.REQUESTS))[0];

    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.RESPONSES}.${requestId}`]: { ok: false, error: "NoteEditDenied" }
    }, "gm1");

    await assert.rejects(() => pending, /NoteEditDenied/);
  });

  it("clears the response flag once it has been read", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    relay.registerRelay();

    const alice = harness.users.get("alice");
    const pending = relay.request("probe", {});
    const requestId = Object.keys(alice.getFlag(MODULE_ID, FLAGS.REQUESTS))[0];

    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.RESPONSES}.${requestId}`]: { ok: true, result: null }
    }, "gm1");
    await pending;

    assert.deepEqual(alice.getFlag(MODULE_ID, FLAGS.RESPONSES), {});
  });

  it("ignores a response for a request it never made", async () => {
    harness = installRelayWorld([GM, ALICE], "alice");
    const relay = await loadRelay();
    relay.registerRelay();

    const alice = harness.users.get("alice");
    await alice.update({
      [`flags.${MODULE_ID}.${FLAGS.RESPONSES}.unknown`]: { ok: true, result: "x" }
    }, "gm1");

    // Nothing was pending, so nothing resolves and nothing throws.
    assert.equal(alice.getFlag(MODULE_ID, FLAGS.RESPONSES).unknown.result, "x");
  });
});
