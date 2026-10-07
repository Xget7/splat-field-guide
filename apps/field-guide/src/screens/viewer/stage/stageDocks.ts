import { Space } from '../../../ui/theme';
import {
  DOCK_COLLAPSED,
  DOCK_EXPANDED_WIDTH,
} from '../assistant/AssistantDock';
import type { Size } from '../../../features/viewport/projectedParts';
import type { Clearance } from './cardPlacement';
import { TOOLS_HEIGHT } from './ToolDock';

// Narrower than this, the collapsed assistant's title crowds its mic button.
const MIN_COLLAPSED_WIDTH = 240;

export interface StageDocks {
  assistantWidth: number;
  assistantExpandedWidth: number;
  /** The tool row is centred in the stage minus this room on the right. */
  toolsRight: number;
  /** Raises the tool row above the stage's bottom margin. */
  toolsLift: number;
  /** The expanded assistant would cover the tool row. */
  toolsCovered: boolean;
}

/**
 * Centres the tool row between the stage's left edge and the collapsed
 * assistant, with the same gap on each side; failing that, lifts it above
 * the assistant.
 */
export function stageDocksFor(
  stageWidth: number,
  toolsWidth: number,
): StageDocks {
  const assistantExpandedWidth = Math.min(
    DOCK_EXPANDED_WIDTH,
    stageWidth - Space.lg * 2,
  );
  const besideWidth = Math.min(
    DOCK_COLLAPSED.width,
    stageWidth - toolsWidth - Space.lg * 3,
  );
  if (besideWidth < MIN_COLLAPSED_WIDTH) {
    return {
      assistantWidth: Math.min(DOCK_COLLAPSED.width, stageWidth - Space.lg * 2),
      assistantExpandedWidth,
      toolsRight: 0,
      toolsLift: DOCK_COLLAPSED.height + Space.md,
      toolsCovered: true,
    };
  }
  const toolsRight = besideWidth + Space.lg;
  return {
    assistantWidth: besideWidth,
    assistantExpandedWidth,
    toolsRight,
    toolsLift: (DOCK_COLLAPSED.height - TOOLS_HEIGHT) / 2,
    toolsCovered:
      (stageWidth - toolsRight + toolsWidth) / 2 + Space.lg >
      stageWidth - Space.lg - assistantExpandedWidth,
  };
}

function roomWithin(stage: Size, clear: Clearance) {
  return (
    Math.max(0, stage.width - clear.left - clear.right) *
    Math.max(0, stage.height - clear.top - clear.bottom)
  );
}

/**
 * Room the part card leaves along each stage edge: `top` for the breadcrumb,
 * the docks above `bottomMargin`, and an open assistant as a column on the
 * right or a band along the bottom, whichever leaves the card more room.
 */
export function cardClearanceFor(
  stage: Size,
  docks: StageDocks,
  top: number,
  bottomMargin: number,
  openAssistantHeight: number | null,
): Clearance {
  const docked =
    bottomMargin +
    Math.max(DOCK_COLLAPSED.height, docks.toolsLift + TOOLS_HEIGHT) +
    Space.sm;
  const closed = { top, right: Space.lg, bottom: docked, left: Space.lg };
  if (openAssistantHeight === null) {
    return closed;
  }
  const column = {
    ...closed,
    right: docks.assistantExpandedWidth + Space.lg * 2,
  };
  const band = {
    ...closed,
    bottom: Math.max(docked, bottomMargin + openAssistantHeight + Space.sm),
  };
  return roomWithin(stage, column) >= roomWithin(stage, band) ? column : band;
}
