(function () {
  const footerContainer = document.getElementById("footer-container");
  if (!footerContainer) return;

  const footer = document.createElement("footer");
  footer.className = "footer";

  const clock = document.createElement("div");
  clock.id = "clock";
  clock.className = "footer-clock";

  const brand = document.createElement("span");
  brand.className = "footer-brand";
  brand.textContent = "© ASKÖ Piberbach – Tennis";

  const leftSeparator = document.createElement("span");
  leftSeparator.className = "footer-separator";
  leftSeparator.textContent = "|";

  const rightSeparator = document.createElement("span");
  rightSeparator.className = "footer-separator";
  rightSeparator.textContent = "|";

  const version = document.createElement("span");
  version.id = "footer-version";
  version.textContent = `v${window.APP_VERSION}`;

  footer.append(clock, leftSeparator, brand, rightSeparator, version);
  footerContainer.replaceChildren(footer);

  const el = clock;

  function update() {
    el.textContent = window.getCurrentDateTimeString();
  }

  update();
  //setInterval(update, 60000);
  
})();
