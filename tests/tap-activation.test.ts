import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_TAP_STATE,
  reduceTap,
  type TapEvent,
  type TapState,
} from "../lib/tap-activation";

/** Run a whole gesture and report how many times the action ran. */
function activations(events: readonly TapEvent[]): number {
  let state: TapState = INITIAL_TAP_STATE;
  let count = 0;
  for (const event of events) {
    const step = reduceTap(state, event);
    state = step.state;
    if (step.activate) count += 1;
  }
  return count;
}

const down = (pointerType: string, pointerId = 1): TapEvent => ({
  kind: "pointerdown",
  pointerId,
  pointerType,
});
const up = (pointerType: string, pointerId = 1): TapEvent => ({
  kind: "pointerup",
  pointerId,
  pointerType,
});
const click: TapEvent = { kind: "click" };
const cancel = (pointerId = 1): TapEvent => ({ kind: "pointercancel", pointerId });

test("a touch tap activates even when the browser never sends a click", () => {
  // The reported bug: the keyboard dismisses and reflows the layout, so the
  // release no longer resolves to the button and no `click` is synthesized.
  assert.equal(activations([down("touch"), up("touch")]), 1);
});

test("a touch tap that does end in a click still activates exactly once", () => {
  assert.equal(activations([down("touch"), up("touch"), click]), 1);
});

test("a mouse click activates exactly once, through the browser's own click", () => {
  assert.equal(activations([down("mouse"), up("mouse"), click]), 1);
});

test("a mouse press activates only on click, never on the release alone", () => {
  // Guards the desktop path: the release half of a mouse click must not run
  // the action, or every desktop click would fire twice.
  assert.equal(activations([down("mouse"), up("mouse")]), 0);
});

test("keyboard activation still works: a bare click runs the action", () => {
  // Enter/Space on a focused button raises `click` with no pointer events.
  assert.equal(activations([click]), 1);
});

test("a press-and-hold that becomes a scroll does not activate", () => {
  // The browser claims the gesture for scrolling and cancels the pointer.
  assert.equal(activations([down("touch"), cancel()]), 0);
  assert.equal(activations([down("touch"), cancel(), click]), 1); // the click is not ours
});

test("releasing on the button without pressing on it does not activate", () => {
  // A gesture that began elsewhere and ended here is not a tap on this button.
  assert.equal(activations([up("touch")]), 0);
});

test("a second pointer pressed elsewhere cannot hijack the first", () => {
  // Multi-touch: pointer 2 goes down and up on the button while pointer 1,
  // the one this button tracked, is still down.
  assert.equal(activations([down("touch", 1), down("touch", 2), up("touch", 2)]), 0);
  // The original press released afterwards still activates once.
  assert.equal(
    activations([down("touch", 1), down("touch", 2), up("touch", 2), up("touch", 1)]),
    1,
  );
});

test("a second pointer's cancellation does not drop the tracked press", () => {
  // A pinch or a second finger cancelled elsewhere must not swallow a real
  // tap that is still in flight on the button.
  assert.equal(
    activations([down("touch", 1), cancel(2), up("touch", 1)]),
    1,
  );
});

test("a cancelled press leaves no stale state behind", () => {
  assert.equal(
    activations([down("touch"), cancel(), down("touch"), up("touch")]),
    1,
  );
});

test("repeated taps each activate once", () => {
  assert.equal(
    activations([
      down("touch"), up("touch"), click,
      down("touch"), up("touch"), click,
      down("touch"), up("touch"), click,
    ]),
    3,
  );
  // Reflow variant: no click at all, three taps.
  assert.equal(
    activations([down("touch"), up("touch"), down("touch"), up("touch")]),
    2,
  );
});

test("every pointer event leaves the state reusable for the next tap", () => {
  // No reachable sequence may wedge the machine: a finger must always be
  // able to tap again. Checked over the event vocabulary.
  const vocabulary: TapEvent[] = [
    down("touch"), down("mouse"), up("touch"), up("mouse"), cancel(), click,
  ];
  let state: TapState = INITIAL_TAP_STATE;
  for (const first of vocabulary) {
    for (const second of vocabulary) {
      for (const third of vocabulary) {
        state = INITIAL_TAP_STATE;
        for (const event of [first, second, third]) {
          state = reduceTap(state, event).state;
        }
        // Whatever happened, one clean tap afterwards must still work.
        const after = reduceTap(
          reduceTap(state, down("touch")).state,
          up("touch"),
        );
        assert.equal(
          after.activate,
          true,
          `wedged after ${JSON.stringify([first, second, third])}`,
        );
      }
    }
  }
});
