import { Space } from '../../../ui/theme';
import {
  DOCK_COLLAPSED,
  DOCK_EXPANDED_WIDTH,
} from '../assistant/AssistantDock';
import { TOOL_DIAMETER } from './ToolDock';

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

/** Places the tool row beside the collapsed assistant when both fit, else above it. */
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
  const toolsEnd = (stageWidth - toolsRight + toolsWidth) / 2;
  return {
    assistantWidth: besideWidth,
    assistantExpandedWidth,
    toolsRight,
    toolsLift: (DOCK_COLLAPSED.height - TOOL_DIAMETER) / 2,
    toolsCovered:
      toolsEnd + Space.lg > stageWidth - Space.lg - assistantExpandedWidth,
  };
}
