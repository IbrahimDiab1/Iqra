interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/**
 * True inside the Android app (Capacitor's WebView). The native shell injects `window.Capacitor` before the page
 * loads, so no Capacitor code is needed in the web bundle to ask this; the browser and the installed PWA get false.
 */
export function isNativeApp(): boolean {
  try {
    return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}
