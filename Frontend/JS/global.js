(function () {
  // Fallback bis der Backend-Endpoint antwortet
  window.APP_VERSION = "...";

  // Version vom Backend laden und Footer aktualisieren
  fetch("/version")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.version) {
        window.APP_VERSION = data.version;
        // Footer-Versionsnummer aktualisieren falls bereits gerendert
        var el = document.getElementById("footer-version");
        if (el) el.textContent = "v" + data.version;
      }
    })
    .catch(function () { /* Backend nicht erreichbar, Fallback bleibt */ });
})();
