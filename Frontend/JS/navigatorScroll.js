import { createEndpoint } from "./dataClient.js";

const setNavigatorScroll = createEndpoint("setNavigatorScroll");
const SCROLL_AMOUNT = 300;

document.getElementById("scroll-up").addEventListener("click", async () => {
  try {
    await setNavigatorScroll({ amount: -SCROLL_AMOUNT });
  } catch (err) {
    console.error("scroll up Fehler:", err);
  }
});

document.getElementById("scroll-down").addEventListener("click", async () => {
  try {
    await setNavigatorScroll({ amount: SCROLL_AMOUNT });
  } catch (err) {
    console.error("scroll down Fehler:", err);
  }
});
