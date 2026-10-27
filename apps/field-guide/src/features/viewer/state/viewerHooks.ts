import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  selectDisplay,
  selectViewer,
  viewerStore,
  type ViewerLayout,
} from './viewerStore';

export function useDisplayedSession() {
  return useStore(viewerStore, state => selectDisplay(state).session);
}
export function useCard() {
  return useStore(viewerStore, state => selectDisplay(state).card);
}
export function useThread() {
  return useStore(viewerStore, state => selectViewer(state).thread);
}
export function useExchange() {
  return useStore(viewerStore, state => selectViewer(state).exchange);
}
export function useStepRows() {
  return useStore(viewerStore, state => selectDisplay(state).steps);
}
export function usePartTrail() {
  return useStore(viewerStore, state => selectDisplay(state).trail);
}
export function useCardPart() {
  return useStore(viewerStore, state => selectDisplay(state).cardPart);
}
export function useShownText() {
  return useStore(viewerStore, state => selectDisplay(state).shownText);
}
export function useExploring() {
  return useStore(viewerStore, state => selectDisplay(state).exploring);
}
export function useCanResume() {
  return useStore(viewerStore, state => selectDisplay(state).canResume);
}
/** Bumped by Repeat and by Recenter, either of which frames the step again. */
export function useFrameRequest() {
  return useStore(
    viewerStore,
    state => selectViewer(state).frameRequest + state.recenterRequest,
  );
}
export function useUtterance() {
  return useStore(viewerStore, state => selectDisplay(state).utterance);
}
export function useVoiceContext() {
  return useStore(viewerStore, state => selectDisplay(state).voiceContext);
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
