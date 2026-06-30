(function () {
  const URL = 'https://scorer-tennis.b-cdn.net/json/24.voll.json';
  const POLL_MS = 2000;

  function updateCourt(court) {
    const p = court.platz;
    if (p !== '1' && p !== '2') return;
    const prefix = 'p' + p;
    setText(prefix + '-h-s1', court.satz1home);
    setText(prefix + '-h-s2', court.satz2home);
    setText(prefix + '-h-s3', court.satz3home);
    setText(prefix + '-h-p',  court.punktehome);
    setText(prefix + '-g-s1', court.satz1gast);
    setText(prefix + '-g-s2', court.satz2gast);
    setText(prefix + '-g-s3', court.satz3gast);
    setText(prefix + '-g-p',  court.punktegast);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '-';
  }

  async function poll() {
    try {
      const res = await fetch(URL, { cache: 'no-store' });
      const data = await res.json();
      if (data && Array.isArray(data.courts)) {
        data.courts.forEach(updateCourt);
      }
    } catch (err) {
      // silent
    }
    setTimeout(poll, POLL_MS);
  }

  poll();
})();
