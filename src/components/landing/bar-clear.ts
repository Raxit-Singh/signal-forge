/**
 * Whether a flying copy of the bar's logo is clear of the bar's logo and name, with room to spare, so the name can
 * slide over into the logo's place without landing on the copy. Used by both flights (mention-flight.tsx out of
 * the bar, process.tsx back into it).
 */
export const BAR_CLEARANCE = 90; // px around the logo and the name

export function clearOfBar(flying: DOMRect, logo: DOMRect, name: DOMRect | undefined): boolean {
  const left = logo.left - BAR_CLEARANCE;
  const right = (name ? name.right : logo.right) + BAR_CLEARANCE;
  const top = Math.min(logo.top, name?.top ?? logo.top) - BAR_CLEARANCE;
  const bottom = Math.max(logo.bottom, name?.bottom ?? logo.bottom) + BAR_CLEARANCE;
  return flying.right < left || flying.left > right || flying.bottom < top || flying.top > bottom;
}
