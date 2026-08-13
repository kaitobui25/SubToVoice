"use strict";
const checkbox = document.getElementById("debugLogging");
const logState = document.getElementById("logState");
function render(enabled) {
  checkbox.checked = enabled;
  logState.textContent = enabled ? "Đang tự thu log từ lúc YouTube chạy." : "Đã tắt thu log.";
}
async function init() {
  await chrome.storage.local.set({ enabled: true });
  const stored = await chrome.storage.local.get({ debugLogging: true });
  render(stored.debugLogging !== false);
}
checkbox.addEventListener("change", async () => {
  const enabled = checkbox.checked;
  await chrome.storage.local.set({ debugLogging: enabled });
  render(enabled);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debugLogging) render(changes.debugLogging.newValue !== false);
});
init().catch(() => render(true));
