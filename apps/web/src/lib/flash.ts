/**
 * A brief full screen tint, used when the rest timer ends (iPhone has no vibration API).
 * Pointer events pass through. Reduced motion gets a softer tint with no fade.
 */
export function flashScreen(durationMs = 140): void {
  if (typeof document === "undefined" || !document.body) return;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = document.createElement("div");
  el.className = "gym-flash";
  el.setAttribute("aria-hidden", "true");
  if (reduce) el.style.opacity = "0.18";
  document.body.appendChild(el);
  window.setTimeout(() => {
    if (reduce) {
      el.remove();
      return;
    }
    el.style.opacity = "0";
    window.setTimeout(() => el.remove(), 150);
  }, durationMs);
}
