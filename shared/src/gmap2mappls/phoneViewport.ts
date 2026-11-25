/**
 * Phone viewport helpers for GoogleMaps2Mappls / Pinway.
 * Android WebView often ignores `width=device-width` and lays out ~980px then
 * shrink-to-fits — making the UI look like a tiny desktop page. We lock the
 * meta viewport to the real screen CSS width instead.
 */

export function isPhoneLikeDevice(opts: {
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
  noHover: boolean;
}): boolean {
  const sw = Math.min(opts.screenWidth || 0, opts.screenHeight || 0);
  // Phones are typically ≤480 CSS px on the short edge; keep headroom for large phones.
  return (opts.coarsePointer && opts.noHover) || (sw > 0 && sw < 700);
}

/** Portrait phone CSS width to put in the viewport meta `width=` attribute. */
export function phoneCssWidth(opts: {
  screenWidth: number;
  screenHeight: number;
  innerWidth?: number;
  visualWidth?: number;
}): number {
  const sw = Math.min(opts.screenWidth || 0, opts.screenHeight || 0);
  if (sw > 0 && sw < 700) return Math.round(sw);
  const vv = opts.visualWidth ?? 0;
  if (vv > 0 && vv < 700) return Math.round(vv);
  return Math.round(Math.min(opts.innerWidth || 390, 430));
}

export function phoneViewportMetaContent(cssWidth: number): string {
  const w = Math.max(320, Math.round(cssWidth));
  return `width=${w}, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content`;
}

/**
 * Corrective zoom when layout clientWidth is still much wider than the phone
 * screen (Chrome/Android WebView shrink-to-fit). Returns 1 when no correction.
 */
export function shrinkToFitZoom(layoutClientWidth: number, targetCssWidth: number): number {
  if (!(targetCssWidth > 0) || !(layoutClientWidth > 0)) return 1;
  if (layoutClientWidth <= targetCssWidth * 1.12) return 1;
  const z = targetCssWidth / layoutClientWidth;
  return Math.max(0.35, Math.min(1, Number(z.toFixed(4))));
}
