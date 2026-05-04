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
    function update() {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      el.textContent = `${yyyy}.${mm}.${dd} – ${hh}:${mi}`;
    }

    update(); // Sofort aktualisieren
    setInterval(update, 60000); // Dann jede Minute
  }

  findAndStartClock();
})();
