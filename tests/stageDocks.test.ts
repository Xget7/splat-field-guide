import { stageDocksFor } from '../apps/field-guide/src/screens/viewer/stage/stageDocks';
import { Space } from '../apps/field-guide/src/ui/theme';

// The stage beside the open drawer on a 13 inch iPad in landscape, and the six-tool row.
const STAGE_WIDTH = 983;
const TOOLS_WIDTH = 368;

describe('stage docks', () => {
  test('centres the tool row between the stage edge and the collapsed assistant', () => {
    const docks = stageDocksFor(STAGE_WIDTH, TOOLS_WIDTH);
    // The viewer centres the row in the stage minus toolsRight, and pins the assistant Space.lg from the right.
    const toolsLeft = (STAGE_WIDTH - docks.toolsRight - TOOLS_WIDTH) / 2;
    const assistantLeft = STAGE_WIDTH - Space.lg - docks.assistantWidth;
    expect(assistantLeft - (toolsLeft + TOOLS_WIDTH)).toBe(toolsLeft);
  });
});
