// Small rules for the app's floating chrome, kept out of the components so they can be tested.

// The tab bar folds down to icons while you scroll down through content, and comes back on the
// first scroll up (or at the top). A few pixels of slack either way: a thumb resting on the glass
// jitters by a pixel or two, and a bar that flickers on every touch is worse than one that never
// moves.
export const FOLD_AFTER = 80      // px scrolled before the bar may fold
export const TOP_ZONE = 40        // at or above this the bar is always open
export const SLACK = 6            // px of movement that counts as a direction

/** Should the bar be folded, given where the page is now and where it was a moment ago? */
export function tabBarFolded(folded, y, lastY) {
  if (y < TOP_ZONE) return false
  const dy = y - lastY
  if (dy > SLACK && y > FOLD_AFTER) return true
  if (dy < -SLACK) return false
  return folded
}

// A sheet that has grown to most of the screen stops being a floating panel and anchors to the
// edges on an opaque background, the way system sheets do at full height.
export const TALL_RATIO = 0.82
export const sheetIsTall = (contentHeight, viewportHeight) =>
  viewportHeight > 0 && contentHeight >= viewportHeight * TALL_RATIO
