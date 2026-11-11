import { useEffect, useRef, useState } from 'react';
import type { SplatViewSpec } from 'react-native-splat';
import { directionFor, framingFor, type SessionState } from '../../../guide';
import type { FrameDirection, Pack } from '../../../pack/pack';
import {
  guideFrameBounds,
  FRAME_SECONDS,
  homeDirectionInRadians,
} from '../../domain/camera';
import {
  measureFraming,
  FRAMING_GRID_SIZE,
  FRAMING_VISIBILITY_THRESHOLD,
} from '../../domain/framingAudit';
import type { Size } from '../../domain/screenGeometry';
import {
  measureCandidateSets,
  type CandidateInput,
  type CandidateReport,
} from '../../domain/candidateAudit';

const SETTLE_MARGIN_MS = 500;
const HIGHLIGHT_COMMIT_MS = 100;
const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
type AuditRow = Awaited<ReturnType<typeof measureFraming>> & {
  procedure: string;
  procedureId: string;
  stepIndex: number;
  partId: string;
  label: number;
  viewDirection: FrameDirection;
  drawnDirection?: FrameDirection;
};
interface FramingAuditDebug {
  measureCandidates: (input: CandidateInput) => Promise<void>;
  candidateReport?: CandidateReport;
  run: (directionMode?: 'prepared' | 'home') => Promise<void>;
  showStep: (procedureId: string, stepIndex: number) => Promise<void>;
  restore: () => void;
  report: {
    directionMode: 'prepared' | 'home';
    packId: string;
    packVersion: number;
    splatCount: number;
    viewport: Size;
    threshold: number;
    gridSize: number;
    steps: AuditRow[];
    complete: boolean;
    error?: string;
  };
}
export const framingAuditDebug = () =>
  (globalThis as { fieldGuideFraming?: FramingAuditDebug }).fieldGuideFraming;

/** Active only in development; an audit temporarily owns framing and highlighting. */
export function useFramingAudit(
  view: SplatViewSpec | null,
  pack: Pack,
  size: Size,
) {
  const [session, setSession] = useState<SessionState | null>(null);
  const running = useRef(false);
  useEffect(() => {
    if (!__DEV__ || view === null || size.width <= 0 || size.height <= 0) {
      return;
    }
    let cancelled = false;
    const check = () => {
      if (cancelled) {
        throw new Error(
          'Framing audit cancelled: viewport changed or unmounted',
        );
      }
    };
    let directionMode: 'prepared' | 'home' = 'prepared';
    const showStep = async (procedureId: string, stepIndex: number) => {
      check();
      const state = { procedureId, stepIndex, selectedPart: null };
      const bounds = framingFor(state, pack);
      if (bounds === null) {
        throw new Error(`No framing bounds for ${procedureId}:${stepIndex}`);
      }
      setSession(state);
      // Let React commit the same highlight as the guide before reading the label buffer.
      await wait(HIGHLIGHT_COMMIT_MS);
      check();
      view.frame(
        guideFrameBounds(bounds),
        FRAME_SECONDS,
        homeDirectionInRadians(
          directionMode === 'home'
            ? pack.camera.home
            : directionFor(state, pack),
        ),
      );
      await wait(FRAME_SECONDS * 1000 + SETTLE_MARGIN_MS);
      check();
      const drawn = view.drawnDirection();
      console.log(
        `FRAMING_AUDIT_POSE ${JSON.stringify({
          requested:
            directionMode === 'home'
              ? pack.camera.home
              : directionFor(state, pack),
          drawn,
        })}`,
      );
      return state;
    };
    const debug: FramingAuditDebug = {
      measureCandidates: async input => {
        if (running.current) throw new Error('Framing audit already running');
        running.current = true;
        const report: CandidateReport = {
          packId: pack.packId,
          packVersion: pack.packVersion,
          geometry: input.geometry,
          viewport: size,
          sets: [],
          complete: false,
        };
        debug.candidateReport = report;
        try {
          await measureCandidateSets(
            view,
            pack,
            size,
            input,
            setSession,
            check,
            report,
          );
          console.log(`FRAMING_CANDIDATE_REPORT ${JSON.stringify(report)}`);
        } catch (error) {
          report.error = String(error);
          console.log(`FRAMING_CANDIDATE_ERROR ${JSON.stringify(report)}`);
          throw error;
        } finally {
          running.current = false;
          if (!cancelled) setSession(null);
        }
      },
      report: {
        directionMode: 'prepared',
        packId: pack.packId,
        packVersion: pack.packVersion,
        splatCount: pack.tiers[0].splatCount,
        viewport: size,
        threshold: FRAMING_VISIBILITY_THRESHOLD,
        gridSize: FRAMING_GRID_SIZE,
        steps: [],
        complete: false,
      },
      showStep: async (procedureId, stepIndex) => {
        await showStep(procedureId, stepIndex);
      },
      restore: () => setSession(null),
      run: async (mode = 'prepared') => {
        if (running.current) {
          throw new Error('Framing audit already running');
        }
        running.current = true;
        directionMode = mode;
        debug.report.directionMode = mode;
        debug.report.steps = [];
        debug.report.complete = false;
        delete debug.report.error;
        try {
          for (const procedure of pack.procedures) {
            for (
              let stepIndex = 0;
              stepIndex < procedure.steps.length;
              stepIndex++
            ) {
              const state = await showStep(procedure.id, stepIndex);
              for (const partId of procedure.steps[stepIndex].parts) {
                check();
                const part = pack.parts.find(
                  candidate => candidate.id === partId,
                )!;
                // Multi-target steps share the guide framing, but each target gets its own score.
                const measurement = await measureFraming(
                  view,
                  part.bounds,
                  { ...state, selectedPart: partId },
                  pack,
                );
                check();
                const direction =
                  directionMode === 'home'
                    ? pack.camera.home
                    : directionFor(state, pack);
                const drawn = view.drawnDirection();
                const row = {
                  drawnDirection:
                    drawn === undefined
                      ? undefined
                      : {
                          azimuth: (drawn.azimuth * 180) / Math.PI,
                          elevation: (drawn.elevation * 180) / Math.PI,
                        },
                  viewDirection: {
                    azimuth: direction.azimuth,
                    elevation: direction.elevation,
                  },
                  procedure: procedure.title,
                  procedureId: procedure.id,
                  stepIndex,
                  partId,
                  label: part.label,
                  ...measurement,
                };
                debug.report.steps.push(row);
                console.log(`FRAMING_AUDIT ${JSON.stringify(row)}`);
              }
            }
          }
          debug.report.complete = true;
          console.log(`FRAMING_AUDIT_REPORT ${JSON.stringify(debug.report)}`);
        } catch (error) {
          debug.report.error = String(error);
          throw error;
        } finally {
          running.current = false;
          if (!cancelled) {
            setSession(null);
          }
        }
      },
    };
    const target = globalThis as { fieldGuideFraming?: FramingAuditDebug };
    target.fieldGuideFraming = debug;
    return () => {
      cancelled = true;
      if (target.fieldGuideFraming === debug) {
        delete target.fieldGuideFraming;
      }
    };
  }, [view, pack, size]);
  return session;
}
