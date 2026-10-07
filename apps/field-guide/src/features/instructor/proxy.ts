import config from '../../../instructor.config.json';

/** A null proxy URL runs with on-device answers and voice only. */
export const INSTRUCTOR_PROXY_URL: string | null = config.proxyUrl;
