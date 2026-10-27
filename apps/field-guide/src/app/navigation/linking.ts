import type { LinkingOptions } from '@react-navigation/native';
import { Route, type RootStackParamList } from './routes';

export const URL_SCHEME = 'fieldguide';
const PREFIX = `${URL_SCHEME}://`;
const BENCH_PATH = 'bench';

/** Opens only the splat view, so a profiler can launch straight into the wide view without touches. */
export const BENCH_URL = `${PREFIX}${BENCH_PATH}`;

export const LINKING: LinkingOptions<RootStackParamList> = {
  prefixes: [PREFIX],
  config: { screens: { [Route.bench]: BENCH_PATH } },
};
