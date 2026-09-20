const backLink = document.querySelector(".scoreboard-back");

function internalReferrer() {
  if (!document.referrer) return null;
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== window.location.origin) return null;
    if (referrer.pathname === window.location.pathname && referrer.search === window.location.search) return null;
    return referrer;
  } catch {
    return null;
  }
}

backLink?.addEventListener("click", (event) => {
  if (!internalReferrer() || window.history.length <= 1) return;
  event.preventDefault();
  window.history.back();
});
