/**
 * Shared utilities for user colour resolution.
 *
 * Priority (highest → lowest):
 *   1. Guild role colour  (handled in AppContext.getMemberColor)
 *   2. User's own colour  (stored on their profile, hex string)
 *   3. Deterministic hue  (seeded from username)
 */

/** Deterministic hue (0–359) seeded from a name string. */
export function nameHue(name) {
  if (!name) return 200;
  return (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360;
}

/**
 * Background colour for an avatar circle.
 * Uses the user's profile colour when set, otherwise a hue derived from name.
 */
export function avatarBg(name, userColor) {
  if (userColor && userColor !== '') return userColor;
  return `hsl(${nameHue(name)},45%,40%)`;
}

/**
 * Colour for a username label in chat / member lists.
 * Uses the user's profile colour when set, otherwise a lighter hue from name.
 */
export function nameTextColor(name, userColor) {
  if (userColor && userColor !== '') return userColor;
  return `hsl(${nameHue(name)},60%,72%)`;
}

/**
 * Banner background for the user popout.
 * Uses a darkened version of the user's colour, or the usual dark hue.
 */
export function bannerBg(name, userColor) {
  if (userColor && userColor !== '') {
    // Overlay the chosen colour at low opacity on a very dark base so the banner
    // stays readable regardless of what colour was picked.
    return `linear-gradient(135deg, ${userColor}cc 0%, ${userColor}66 100%)`;
  }
  return `hsl(${nameHue(name)},35%,22%)`;
}
