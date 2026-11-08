/*
 * Imported by the generated service worker (vite.config.ts → workbox.importScripts) before Workbox runs.
 *
 * The Worker answers a missing file with index.html and status 200 (single page app fallback). During a
 * deploy, a precache fetch for /assets/index-<hash>.js can land on the other version and get that HTML.
 * Workbox would store it under the .js URL and the installed app would open to a blank screen until the
 * next deploy. This turns "HTML for a file that is not HTML" into a 404, so the install fails cleanly,
 * the old service worker keeps serving, and the browser tries again later.
 */
(function () {
  var nativeFetch = self.fetch.bind(self);

  function urlOf(input) {
    try {
      return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, self.location.href);
    } catch (e) {
      return null;
    }
  }

  /** A same origin path that names a file (has an extension) other than an HTML page. */
  function expectsNonHtml(url) {
    if (!url || url.origin !== self.location.origin) return false;
    var last = url.pathname.split("/").pop() || "";
    var dot = last.lastIndexOf(".");
    if (dot <= 0) return false;
    var ext = last.slice(dot + 1).toLowerCase();
    return ext !== "html" && ext !== "htm";
  }

  self.fetch = function (input, init) {
    return nativeFetch(input, init).then(function (res) {
      var mode = input && typeof input === "object" && "mode" in input ? input.mode : init && init.mode;
      if (mode === "navigate" || !res.ok) return res;
      var type = (res.headers.get("content-type") || "").toLowerCase();
      if (type.indexOf("text/html") === -1 || !expectsNonHtml(urlOf(input))) return res;
      return new Response(null, { status: 404, statusText: "Not Found" });
    });
  };
})();
