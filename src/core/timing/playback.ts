// Whether the clock should actually be running. Ported from oh-my-blog's
// playback.ts.

/**
 * Playback runs only when the viewer wants it, the stage is on screen, and the
 * reader has not asked for reduced motion.
 *
 * Keeping this a named function rather than an inline `&&` is deliberate: it is
 * the one place where an accessibility preference silently overrides an author's
 * `autoplay: true`, and that deserves to be findable.
 */
export function effectivePlayback(
  userPlaying: boolean,
  inView: boolean,
  reducedMotion: boolean,
): boolean {
  return userPlaying && inView && !reducedMotion;
}
