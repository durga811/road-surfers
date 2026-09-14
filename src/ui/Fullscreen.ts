/**
 * Fullscreen, with the vendor-prefixed fallbacks that still matter.
 *
 * Support is genuinely absent on iPhone Safari — the Fullscreen API is
 * implemented for iPad and for `<video>`, but not for arbitrary elements
 * on the phone. Everything here degrades to "unsupported" rather than
 * throwing, and the caller hides the control when `isSupported()` is
 * false instead of offering a button that does nothing.
 */

interface PrefixedElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}
interface PrefixedDocument extends Document {
  webkitExitFullscreen?: () => Promise<void>;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
}

interface LockableOrientation extends ScreenOrientation {
  lock?: (orientation: string) => Promise<void>;
}

const doc = document as PrefixedDocument;
const root = document.documentElement as PrefixedElement;

export function isSupported(): boolean {
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

export function isActive(): boolean {
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/**
 * Must be called from a user gesture, or the browser will refuse.
 * @returns whether we ended up in fullscreen.
 *
 * `document.fullscreenEnabled` is not trustworthy on its own: embedded
 * browser views and some kiosk wrappers report it true and then reject
 * the request with "Permissions check failed". The caller uses the
 * return value to hide a control that provably does nothing.
 */
export async function enter(): Promise<boolean> {
  if (isActive()) return true;
  if (!isSupported()) return false;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else await root.webkitRequestFullscreen?.();
    return isActive();
  } catch {
    return false;
  }
}

export async function exit(): Promise<void> {
  if (!isActive()) return;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else await doc.webkitExitFullscreen?.();
  } catch {
    // Already leaving, or the browser took it away first.
  }
}

/** @returns whether we ended up in fullscreen. */
export async function toggle(): Promise<boolean> {
  if (isActive()) {
    await exit();
    return false;
  }
  return enter();
}

export function onChange(listener: () => void): void {
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
}

/**
 * Ask the OS to stay in landscape. Only meaningful inside fullscreen on
 * Android; everywhere else this rejects and the rotate prompt remains
 * the fallback.
 */
export async function lockLandscape(): Promise<void> {
  const orientation = screen.orientation as LockableOrientation | undefined;
  try {
    await orientation?.lock?.('landscape');
  } catch {
    // Unsupported or refused — the rotate prompt covers it.
  }
}
