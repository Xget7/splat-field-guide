import type { Pack } from '../../../apps/field-guide/src/features/pack/pack.ts';
import { agentToolSpecs } from '../../../apps/field-guide/src/features/instructor/agent/agentTools.ts';

export const TOOL_TIMEOUT_SECONDS = 5;
export const CLIENT_TOOL_TYPE = 'client';
const TOOL_ERROR_HANDLING_MODE = 'passthrough';

export function buildToolConfigs(pack: Pack) {
  return agentToolSpecs(pack).map(spec => ({
    ...spec,
    type: CLIENT_TOOL_TYPE,
    expects_response: true,
    tool_error_handling_mode: TOOL_ERROR_HANDLING_MODE,
    response_timeout_secs: TOOL_TIMEOUT_SECONDS,
  }));
}
export type ClientToolConfig = ReturnType<typeof buildToolConfigs>[number];
