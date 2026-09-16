import { useCallback, useRef } from "react";
import {
  INITIAL_TAP_STATE,
  reduceTap,
  type TapEvent,
  type TapState,
} from "@/lib/tap-activation";

/**
 * Handlers to spread onto the button. `onClick` must stay wired alongside the
 * pointer handlers: it is the mouse and keyboard activation path.
 */
export interface TapActivationHandlers {
  onClick: () => void;
  onPointerDown: (event: { pointerId: number; pointerType: string }) => void;
  onPointerUp: (event: { pointerId: number; pointerType: string }) => void;
  onPointerCancel: (event: { pointerId: number }) => void;
}

/**
 * Runs `onActivate` once per tap, whichever way the browser reports it.
 *
 * A touch tap is activated by its press/release pair rather than by `click`,
 * because the keyboard-dismiss reflow can stop the browser from ever emitting
 * a `click` — see `lib/tap-activation.ts`. Mouse and keyboard still activate
 * through `click`, so desktop behaviour is unchanged.
 *
 * Prefer this over a bare `onClick` for any button a phone reaches while the
 * soft keyboard is up.
 */
export function useTapActivation(onActivate: () => void): TapActivationHandlers {
  // The action closes over live props/state, so it is read through a ref: the
  // handlers below then never need to be rebuilt and never go stale.
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;

  const stateRef = useRef<TapState>(INITIAL_TAP_STATE);

  const dispatch = useCallback((event: TapEvent) => {
    const { state, activate } = reduceTap(stateRef.current, event);
    stateRef.current = state;
    if (activate) activateRef.current();
  }, []);

  return {
    onClick: useCallback(() => dispatch({ kind: "click" }), [dispatch]),
    onPointerDown: useCallback(
      (event: { pointerId: number; pointerType: string }) =>
        dispatch({
          kind: "pointerdown",
          pointerId: event.pointerId,
          pointerType: event.pointerType,
        }),
      [dispatch],
    ),
    onPointerUp: useCallback(
      (event: { pointerId: number; pointerType: string }) =>
        dispatch({
          kind: "pointerup",
          pointerId: event.pointerId,
          pointerType: event.pointerType,
        }),
      [dispatch],
    ),
    onPointerCancel: useCallback(
      (event: { pointerId: number }) =>
        dispatch({ kind: "pointercancel", pointerId: event.pointerId }),
      [dispatch],
    ),
  };
}
