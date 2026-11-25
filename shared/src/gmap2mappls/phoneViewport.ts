/**
 * Phone viewport lock for JBT (all routes) and Pinway.
 *
 * Android Chrome/WebView often ignores `width=device-width` and lays out
 * ~980 CSS px, then shrink-to-fits → tiny “desktop strip” at the top and a
 * huge empty band below. Lock meta `width=` to a real phone CSS width
 * (≈360–430). Never use document `zoom` (dead band under the shell).
 */

export const JBT_FORCE_PHONE_CLASS = "jbt-force-phone";
/** Pinway CSS still keys off this; set together with JBT_FORCE_PHONE_CLASS. */
export const G2M_FORCE_PHONE_CLASS = "g2m-force-phone";

export function isPhoneLikeDevice(opts: {
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
  noHover: boolean;
}): boolean {
  if (opts.coarsePointer && opts.noHover) return true;
  const sw = Math.min(opts.screenWidth || 0, opts.screenHeight || 0);
  return sw > 0 && sw < 700;
}

function inPhoneCssRange(n: number): boolean {
  return n >= 280 && n <= 520;
}

/** Portrait phone CSS width for the viewport meta `width=` attribute. */
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
 * @deprecated Always returns 1 — document zoom left a dead band on Android.
 */
export function shrinkToFitZoom(_layoutClientWidth: number, _targetCssWidth: number): number {
  return 1;
}

/**
 * Inline script for root / route layouts (runs before paint).
 * Adds jbt-force-phone + g2m-force-phone and rewrites viewport width.
 */
export function buildForcePhoneInlineScript(): string {
  return `(function(){try{var dpr=window.devicePixelRatio||1;var sw=Math.min(screen.width||0,screen.height||0);var c=window.matchMedia("(pointer: coarse)").matches;var n=window.matchMedia("(hover: none)").matches;var edge=sw>700?sw/dpr:sw;var phone=(c&&n)||(edge>0&&edge<700);var root=document.documentElement;if(phone){root.classList.add("${JBT_FORCE_PHONE_CLASS}");root.classList.add("${G2M_FORCE_PHONE_CLASS}");}var m=document.querySelector('meta[name="viewport"]');if(!m){m=document.createElement("meta");m.setAttribute("name","viewport");document.head.appendChild(m);}var vvW=window.visualViewport&&window.visualViewport.width;var iw=window.innerWidth;var w=390;if(vvW>=280&&vvW<=520)w=Math.round(vvW);else if(iw>=280&&iw<=520)w=Math.round(iw);else if(sw>=280&&sw<=520)w=Math.round(sw);else if(sw>520&&dpr>=1.5){var css=sw/dpr;if(css>=280&&css<=520)w=Math.round(css);}w=Math.max(320,Math.min(520,w));m.setAttribute("content",phone?("width="+w+", initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content"):"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content");root.style.zoom="";root.style.removeProperty("zoom");delete root.dataset.g2mZoom;}catch(e){}})();`;
}
