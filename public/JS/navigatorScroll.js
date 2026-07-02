import { functions } from "./SDK.js";
import { httpsCallable } from
  "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

const setNavigatorScroll = httpsCallable(functions, "setNavigatorScroll");
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
