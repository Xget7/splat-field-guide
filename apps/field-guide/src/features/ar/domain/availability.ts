import type { PlatformOSType } from 'react-native';

// AR checks require the author's physical engine bay, so shared builds hide them by default.
export const AR_CHECK_ENABLED = false;

// The AR screens run on ARKit, which only iOS provides.
const AR_OS: PlatformOSType = 'ios';

/** Whether the app offers the AR check on the real equipment on this operating system. */
export function offersArCheck(os: PlatformOSType): boolean {
  return AR_CHECK_ENABLED && os === AR_OS;
}

/** Whether the app offers placement and the assembly tour, which share one native view. */
export function offersAssembly(os: PlatformOSType): boolean {
  return os === AR_OS;
}
