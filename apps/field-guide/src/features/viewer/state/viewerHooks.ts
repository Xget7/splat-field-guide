import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ViewerDisplay } from '../domain/viewerDisplay';
import type { ViewerState } from '../domain/viewerState';
import {
  viewerStore,
  type ViewerLayout,
  type ViewerStoreState,
} from './viewerStore';

const VIEWER_CLOSED = 'The viewer must be open';

function displayOf(state: ViewerStoreState): ViewerDisplay {
  if (state.display === null) {
    throw new Error(VIEWER_CLOSED);
  }
  return state.display;
}
function viewerOf(state: ViewerStoreState): ViewerState {
  if (state.viewer === null) {
    throw new Error(VIEWER_CLOSED);
  }
  return state.viewer;
}

export function useDisplayedSession() {
  return useStore(viewerStore, state => displayOf(state).session);
}
export function useCard() {
  return useStore(viewerStore, state => displayOf(state).card);
}
export function useThread() {
  return useStore(viewerStore, state => viewerOf(state).thread);
}
export function useExchange() {
  return useStore(viewerStore, state => viewerOf(state).exchange);
}
export function useStepRows() {
  return useStore(viewerStore, state => displayOf(state).steps);
}
export function usePartTrail() {
  return useStore(viewerStore, state => displayOf(state).trail);
}
export function useCardPart() {
  return useStore(viewerStore, state => displayOf(state).cardPart);
}
export function useShownText() {
  return useStore(viewerStore, state => displayOf(state).shownText);
}
export function useExploring() {
  return useStore(viewerStore, state => displayOf(state).exploring);
}
export function useCanResume() {
  return useStore(viewerStore, state => displayOf(state).canResume);
}
/** Bumped by Repeat and by Recenter, either of which frames the step again. */
export function useFrameRequest() {
  return useStore(
    viewerStore,
    state => viewerOf(state).frameRequest + state.recenterRequest,
  );
}
export function useUtterance() {
  return useStore(viewerStore, state => displayOf(state).utterance);
}
export function useVoiceContext() {
  return useStore(viewerStore, state => displayOf(state).voiceContext);
}
export function useViewerLayout(): ViewerLayout {
  return useStore(
    viewerStore,
    useShallow(state => ({
      instructorOpen: state.instructorOpen,
      panelMode: state.panelMode,
      instructorDockExpanded: state.instructorDockExpanded,
      fullView: state.fullView,
      labelsOn: state.labelsOn,
      recenterRequest: state.recenterRequest,
      pickerVisible: state.pickerVisible,
    })),
  );
}
