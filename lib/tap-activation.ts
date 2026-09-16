// Tap activation for plugin buttons that sit under the on-screen keyboard.
//
// The composer action row lives directly above the keyboard, so the tap that
// runs an action is also the tap that dismisses the keyboard. On a phone the
// release of that tap therefore arrives into a viewport that has just changed
// shape: the keyboard retracts, the composer slides back down, and the button
// moves out from under the finger between the press and the release.
//
// The browser only synthesizes `click` when the press and the release resolve
// to a usable target under the finger. Once the layout has reflowed, the
// release no longer does, so no `click` is emitted at all — while the press
// and the release themselves both still arrive, because a touch pointer is
// implicitly captured to whatever it went down on. The net effect is exactly
// the reported symptom: the keyboard is dismissed and nothing else happens.
//
// So for a non-mouse pointer, run the action from the press/release pair
// instead of waiting for a `click` the browser may never send.
//
// Mouse keeps the plain `click` path on purpose. Desktop has no keyboard
// reflow to survive, and a real `click` is the browser's own activation —
// it carries middle-click, double-click, and the Enter/Space activation that
// keyboard and assistive-technology users depend on. Routing the mouse
// through a synthetic activation would replace all of that with a guess.
//
// A scroll that merely begins on the button needs no special handling: the
// browser claims the gesture and reports it as `pointercancel`, which this
// reducer treats as "no activation". Movement is deliberately not compared
// between press and release — after the reflow, the coordinates of a
// stationary finger have changed too, so a slop threshold measured in client
// pixels would reject exactly the taps this exists to rescue.

/** A press is tracked only for pointers that go down here. */
export interface TapState {
  /** Pointer id of the press in flight; null when there is none. */
  origin: number | null;
  /**
   * The release already ran the action, so the `click` that may follow it is
   * the browser's own compatibility duplicate and must not run it twice.
   */
  handledByPointer: boolean;
}

export const INITIAL_TAP_STATE: TapState = {
  origin: null,
  handledByPointer: false,
};

export type TapEvent =
  | { kind: "pointerdown"; pointerId: number; pointerType: string }
  | { kind: "pointerup"; pointerId: number; pointerType: string }
  | { kind: "pointercancel"; pointerId: number }
  | { kind: "click" };

export interface TapTransition {
  state: TapState;
  activate: boolean;
}

/**
 * Advance the tap state machine. Pure, so the pointer-pair path and the click
 * path can be covered without a DOM.
 */
export function reduceTap(state: TapState, event: TapEvent): TapTransition {
  switch (event.kind) {
    case "pointerdown":
      if (state.origin !== null) {
        // A press is already in flight. A second finger landing on the button
        // while the first is still down is part of a multi-touch gesture, not
        // a tap of its own — and letting it take over would both lose the
        // original press and fire on a release that was never a tap.
        return { state, activate: false };
      }
      return {
        state: {
          // Only a non-mouse pointer needs the press/release pair. A mouse
          // press records no origin, so it can never activate on release.
          origin: event.pointerType === "mouse" ? null : event.pointerId,
          handledByPointer: false,
        },
        activate: false,
      };

    case "pointerup": {
      if (state.origin === null || state.origin !== event.pointerId) {
        // A release from a pointer this button never tracked — a gesture that
        // started elsewhere, or a second finger in a multi-touch gesture. It
        // says nothing about the press in flight, which stays in flight.
        return { state, activate: false };
      }
      return { state: { origin: null, handledByPointer: true }, activate: true };
    }

    case "pointercancel":
      if (state.origin !== event.pointerId) {
        // Another pointer was cancelled; the tracked press is unaffected.
        return { state, activate: false };
      }
      // The browser took this gesture over (a scroll, a pinch, a system
      // interruption). The press no longer belongs to this button.
      return { state: { ...state, origin: null }, activate: false };

    case "click":
      if (state.handledByPointer) {
        return { state: { ...state, handledByPointer: false }, activate: false };
      }
      // No release activated this button, so this is the browser's own
      // activation: a mouse click, or Enter/Space on the focused button.
      return { state, activate: true };
  }
}
