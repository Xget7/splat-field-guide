import type { SessionState } from '../../guide';
import type { Pack } from '../../pack/pack';
import type { Size } from './screenGeometry';

/** What a pick was asked against; the renderer answers later, so any of it may have moved on. */
export interface PickInputs<View> {
  /** Counts every pick and view change, so only the latest answer applies. */
  readonly generation: number;
  readonly session: SessionState;
  readonly pack: Pack;
  readonly view: View;
  readonly frameRequest: number;
  readonly closeUp: boolean;
  readonly size: Size;
}

/**
 * True when a pick answer still describes what is on screen.
 * The session counts by its fields, since each step builds a new one; the rest by identity.
 */
export function isCurrentPick<View>(
  before: PickInputs<View>,
  now: PickInputs<View>,
): boolean {
  return (
    now.generation === before.generation &&
    now.session.procedureId === before.session.procedureId &&
    now.session.stepIndex === before.session.stepIndex &&
    now.session.selectedPart === before.session.selectedPart &&
    now.frameRequest === before.frameRequest &&
    now.closeUp === before.closeUp &&
    now.size === before.size &&
    now.pack === before.pack &&
    now.view === before.view
  );
}
