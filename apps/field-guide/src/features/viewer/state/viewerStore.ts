import { createStore, type StoreApi } from 'zustand/vanilla';
import { LearnMode, SessionEventType, type SessionEvent } from '../../guide';
import type { Instructor, TurnEvent } from '../../instructor';
import type { ReadyGuide } from '../../pack/catalog';
import type { Pack, PartId, ProcedureId } from '../../pack/pack';
import { Capability } from '../domain/capability';
import { PanelMode } from '../domain/panelMotion';
import { displayFor, type ViewerDisplay } from '../domain/viewerDisplay';
import {
  answeredExchanges,
  initialViewerState,
  reduceViewer,
  ViewerActionType,
  type ViewerAction,
  type ViewerState,
} from '../domain/viewerState';

/** What the store needs of the voice hook, which the screen owns and attaches. */
export interface VoicePort {
  /** True when an active voice conversation took the question. */
  ask(question: string): boolean;
  interrupt(): void;
  stop(): void;
}

export interface ViewerOpening {
  readonly guide: ReadyGuide;
  readonly procedureId: ProcedureId;
  readonly stepIndex: number;
  readonly mode: LearnMode;
  readonly instructor: Instructor;
}

/** How the viewer is laid out, apart from the session it shows. */
export interface ViewerLayout {
  readonly instructorOpen: boolean;
  readonly panelMode: PanelMode;
  readonly instructorDockExpanded: boolean;
  /** The iPad drawer is closed, so the picture has the whole stage. */
  readonly fullView: boolean;
  readonly labelsOn: boolean;
  /** Recentering frames the step again without asking the instructor to repeat it. */
  readonly recenterRequest: number;
  readonly pickerVisible: boolean;
}

export interface ViewerStatus extends ViewerLayout {
  readonly guide: ReadyGuide | null;
  readonly pack: Pack | null;
  readonly viewer: ViewerState | null;
  readonly display: ViewerDisplay | null;
  readonly instructor: Instructor | null;
  readonly voice: VoicePort | null;
}

export interface ViewerActions {
  open(opening: ViewerOpening): void;
  close(): void;
  dispatch(event: SessionEvent): void;
  /** True when this was the last step, so the procedure finished. */
  next(): boolean;
  back(): void;
  repeat(): void;
  goTo(stepIndex: number): void;
  select(partId: PartId | null): void;
  chooseProcedure(procedureId: ProcedureId): void;
  explore(): void;
  /** Back to the procedure left for exploring, or the picker when there is none. */
  resumeGuide(): void;
  chooseCapability(capability: Capability): void;
  ask(text: string): void;
  cancelAnswer(): void;
  receiveTurn(event: TurnEvent): void;
  applyAgentAction(event: SessionEvent): void;
  toggleInstructor(): void;
  setPanelMode(mode: PanelMode): void;
  setInstructorDockExpanded(expanded: boolean): void;
  toggleLabels(): void;
  toggleFullView(): void;
  closeDrawer(): void;
  recenter(): void;
  openPicker(): void;
  closePicker(): void;
  attachVoice(voice: VoicePort | null): void;
  reset(): void;
}

export type ViewerStoreState = ViewerStatus & ViewerActions;
export type ViewerStore = StoreApi<ViewerStoreState>;

const VIEWER_CLOSED = 'The viewer must be open';

/** The open viewer's display; reading it before the viewer opens is a programming error. */
export function selectDisplay(state: ViewerStatus): ViewerDisplay {
  if (state.display === null) {
    throw new Error(VIEWER_CLOSED);
  }
  return state.display;
}
export function selectViewer(state: ViewerStatus): ViewerState {
  if (state.viewer === null) {
    throw new Error(VIEWER_CLOSED);
  }
  return state.viewer;
}

const INITIAL_LAYOUT: ViewerLayout = {
  instructorOpen: false,
  panelMode: PanelMode.expanded,
  instructorDockExpanded: false,
  fullView: false,
  labelsOn: true,
  recenterRequest: 0,
  pickerVisible: false,
};

const INITIAL_STATUS: ViewerStatus = {
  ...INITIAL_LAYOUT,
  guide: null,
  pack: null,
  viewer: null,
  display: null,
  instructor: null,
  voice: null,
};

export function createViewerStore(): ViewerStore {
  return createStore<ViewerStoreState>()((set, get) => {
    function act(action: ViewerAction) {
      const { viewer, display, pack } = get();
      if (viewer === null || display === null || pack === null) {
        return;
      }
      const next = reduceViewer(viewer, action, pack);
      if (next !== viewer) {
        set({
          viewer: next,
          display: displayFor(next, pack, { viewer, display }),
        });
      }
    }
    // Anything the user does replaces the answer and the speech in progress.
    function interrupt() {
      get().cancelAnswer();
      get().voice?.interrupt();
    }
    function changeInstructorOpen(open: boolean) {
      const { instructorOpen, instructor, pack } = get();
      if (instructorOpen === open) {
        return;
      }
      set({ instructorOpen: open });
      instructor?.setInstructorOpen(open);
      if (open && pack !== null) {
        instructor?.turns.prewarm(pack);
      }
    }
    const dispatch = (event: SessionEvent) => {
      interrupt();
      act({ type: ViewerActionType.session, event });
    };
    const explore = () => {
      set({ fullView: false });
      interrupt();
      act({ type: ViewerActionType.explore });
    };
    const resumeGuide = () => {
      set({ fullView: false });
      const { display } = get();
      if (display === null || !display.exploring) {
        return;
      }
      if (display.canResume) {
        interrupt();
        act({ type: ViewerActionType.guide });
      } else {
        set({ pickerVisible: true });
      }
    };

    return {
      ...INITIAL_STATUS,
      open: ({ guide, procedureId, stepIndex, mode, instructor }) => {
        const { pack } = guide;
        const viewer = initialViewerState(procedureId, stepIndex, pack);
        const instructorOpen = mode === LearnMode.instructor;
        set({
          ...INITIAL_LAYOUT,
          instructorOpen,
          guide,
          pack,
          viewer,
          display: displayFor(viewer, pack, null),
          instructor,
          voice: null,
        });
        instructor.setPack(pack);
        instructor.setInstructorOpen(instructorOpen);
        if (instructorOpen) {
          instructor.turns.prewarm(pack);
        }
      },
      close: () => {
        const { instructor } = get();
        instructor?.setInstructorOpen(false);
        instructor?.turns.cancel();
        set({ instructor: null, voice: null });
      },
      dispatch,
      next: () => {
        const { display, voice } = get();
        if (display === null) {
          return false;
        }
        if (!display.card.last) {
          dispatch({ type: SessionEventType.next });
          return false;
        }
        voice?.stop();
        dispatch({ type: SessionEventType.end });
        return true;
      },
      back: () => dispatch({ type: SessionEventType.back }),
      repeat: () => dispatch({ type: SessionEventType.repeat }),
      goTo: stepIndex => dispatch({ type: SessionEventType.goTo, stepIndex }),
      select: partId => dispatch({ type: SessionEventType.select, partId }),
      chooseProcedure: procedureId => {
        dispatch({ type: SessionEventType.start, procedureId });
        set({ pickerVisible: false });
      },
      explore,
      resumeGuide,
      chooseCapability: capability => {
        const { display } = get();
        const current = display?.exploring
          ? Capability.explore
          : Capability.guide;
        if (capability === current) {
          set(state => ({ fullView: !state.fullView }));
        } else if (capability === Capability.explore) {
          explore();
        } else {
          resumeGuide();
        }
      },
      ask: text => {
        const question = text.trim();
        if (question === '' || get().voice?.ask(question)) {
          return;
        }
        get().voice?.interrupt();
        const { viewer, pack, instructor } = get();
        if (viewer === null || pack === null || instructor === null) {
          return;
        }
        instructor.turns.ask(
          {
            question,
            state: viewer.session,
            pack,
            history: answeredExchanges(viewer),
          },
          event => get().receiveTurn(event),
        );
      },
      cancelAnswer: () => get().instructor?.turns.cancel(),
      receiveTurn: event => act({ type: ViewerActionType.turn, event }),
      applyAgentAction: event => act({ type: ViewerActionType.agent, event }),
      toggleInstructor: () => {
        get().voice?.stop();
        changeInstructorOpen(!get().instructorOpen);
      },
      setPanelMode: panelMode => set({ panelMode }),
      setInstructorDockExpanded: expanded => {
        set({ instructorDockExpanded: expanded });
        if (expanded) {
          changeInstructorOpen(true);
        }
      },
      toggleLabels: () => set(state => ({ labelsOn: !state.labelsOn })),
      toggleFullView: () => set(state => ({ fullView: !state.fullView })),
      closeDrawer: () => set({ fullView: true }),
      recenter: () =>
        set(state => ({ recenterRequest: state.recenterRequest + 1 })),
      openPicker: () => set({ pickerVisible: true }),
      closePicker: () => set({ pickerVisible: false }),
      attachVoice: voice => set({ voice }),
      reset: () => set(INITIAL_STATUS),
    };
  });
}

/** The app's one viewer store; only one viewer is mounted at a time. */
export const viewerStore = createViewerStore();
