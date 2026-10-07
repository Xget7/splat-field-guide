import type { Pack } from '../../../apps/field-guide/src/features/pack/pack.ts';
import { agentToolSpecs } from '../../../apps/field-guide/src/features/instructor/agent/agentTools.ts';

export const TOOL_TIMEOUT_SECONDS = 5;
const CLIENT_TOOL_TYPE = 'client';

export function buildToolConfigs(pack: Pack) {
  return agentToolSpecs(pack).map(spec => ({
    ...spec,
    type: CLIENT_TOOL_TYPE,
    expects_response: true,
    response_timeout_secs: TOOL_TIMEOUT_SECONDS,
  }));
}
export type ClientToolConfig = ReturnType<typeof buildToolConfigs>[number];
