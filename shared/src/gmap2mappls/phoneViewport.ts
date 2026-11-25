/**
 * Phone viewport helpers for GoogleMaps2Mappls / Pinway.
 *
 * Android WebView / Chrome sometimes reports a wide layout (~980 CSS px) or
 * physical pixel screen sizes. We lock the viewport meta to a real phone CSS
 * width (≈360–430). Never use document `zoom` — it leaves a dead band under
 * the shell and makes the UI look like a shrunk desktop page.
 */

export function isPhoneLikeDevice(opts: {
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
  noHover: boolean;
}): boolean {
  if (opts.coarsePointer && opts.noHover) return true;
  const sw = Math.min(opts.screenWidth || 0, opts.screenHeight || 0);
  // CSS-px short edge (phones ≈360–430). Physical px without coarse pointer
  // are treated as desktop — DPR conversion lives in phoneCssWidth only.
  return sw > 0 && sw < 700;
}

function inPhoneCssRange(n: number): boolean {
  return n >= 280 && n <= 520;
}

/** Portrait phone CSS width to put in the viewport meta `width=` attribute. */
export function phoneCssWidth(opts: {
  screenWidth: number;
  screenHeight: number;
  innerWidth?: number;
  visualWidth?: number;
  devicePixelRatio?: number;
}): number {
  const dpr = opts.devicePixelRatio && opts.devicePixelRatio > 0 ? opts.devicePixelRatio : 1;
  const prefer = [opts.visualWidth, opts.innerWidth];
  for (const c of prefer) {
    if (typeof c === "number" && inPhoneCssRange(c)) return Math.round(c);
  }

  const short = Math.min(opts.screenWidth || 0, opts.screenHeight || 0);
  if (inPhoneCssRange(short)) return Math.round(short);

  // Some WebViews expose physical px on screen.* — convert via DPR.
  if (short > 520 && dpr >= 1.5) {
    const css = short / dpr;
    if (inPhoneCssRange(css)) return Math.round(css);
  }

  for (const c of prefer) {
    if (typeof c === "number" && c > 0) return Math.round(Math.min(c, 430));
  }
  return 390;
}

export function phoneViewportMetaContent(cssWidth: number): string {
  const w = Math.max(320, Math.min(520, Math.round(cssWidth)));
  return `width=${w}, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content`;
}

/**
 * @deprecated Do not apply document zoom. Kept for tests / callers that still
 * import the symbol — always returns 1 so nothing scales the shell.
 */
export function shrinkToFitZoom(_layoutClientWidth: number, _targetCssWidth: number): number {
  return 1;
}
