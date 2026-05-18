(function () {
  function findAndStartClock() {
    const el = document.getElementById("clock");
    
    // Wenn das Element noch nicht da ist (weil navbar.js noch nicht fertig ist),
    // versuche es in 50ms erneut.
    if (!el) {
      setTimeout(findAndStartClock, 50);
      return;
    }

    // Funktion zum Aktualisieren der Zeit
    function formatDateTime(date) {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const mi = String(date.getMinutes()).padStart(2, "0");
      return `${yyyy}.${mm}.${dd} – ${hh}:${mi}`;
    }

    function update() {
      const now = new Date();
      el.textContent = formatDateTime(now);
    }

    window.getCurrentDateTimeString = () => formatDateTime(new Date());

    update(); // Sofort aktualisieren
    setInterval(update, 60000); // Dann jede Minute
  }

  findAndStartClock();
})();
