function updateClock() {
  const el = document.getElementById("clock");
  if (!el) return;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");

  el.textContent = `${yyyy}.${mm}.${dd} – ${hh}:${mi}`;
}

updateClock();
setInterval(updateClock, 60000);
