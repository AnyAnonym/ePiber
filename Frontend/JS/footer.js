(function () {
  const footerContainer = document.getElementById("footer-container");
  if (!footerContainer) return;

  footerContainer.innerHTML = `
  <footer class="footer">
    <div id="clock" class="footer-clock"></div>
    |&emsp;© ASKÖ Piberbach – Tennis&emsp;|&emsp;<span id="footer-version">v${window.APP_VERSION}</span>
  </footer>
  `;

  const el = document.getElementById("clock");

  function update() {
    el.textContent = window.getCurrentDateTimeString();
  }

  update();
  //setInterval(update, 60000);
  
})();
