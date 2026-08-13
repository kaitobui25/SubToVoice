"use strict";

const checkbox = document.getElementById("debugLogging");
const downloadButton = document.getElementById("downloadLog");
const clearButton = document.getElementById("clearLog");
const logState = document.getElementById("logState");

function setState(text) { logState.textContent = text; }

async function getLog() {
  const response = await chrome.runtime.sendMessage({ type: "SUBTOVOICE_LOG_GET" });
  if (!response?.ok) throw new Error(response?.error || "Không đọc được log");
  return response.log || { entries: [] };
}

async function refreshState() {
  const stored = await chrome.storage.local.get({ debugLogging: true });
  checkbox.checked = stored.debugLogging !== false;
  const log = await getLog();
  const count = Array.isArray(log.entries) ? log.entries.length : 0;
  setState(`${checkbox.checked ? "Đang thu log" : "Đã tắt thu log"} · ${count.toLocaleString("vi-VN")} event`);
}

checkbox.addEventListener("change", async () => {
  await chrome.storage.local.set({ debugLogging: checkbox.checked });
  await refreshState();
});

clearButton.addEventListener("click", async () => {
  clearButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "SUBTOVOICE_LOG_CLEAR" });
    if (!response?.ok) throw new Error(response?.error || "Không xóa được log");
    await refreshState();
  } catch (error) {
    setState(`Lỗi xóa log: ${error?.message || error}`);
  } finally {
    clearButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debugLogging) void refreshState();
});

chrome.storage.local.set({ enabled: true }).then(refreshState).catch((error) => {
  setState(`Lỗi: ${error?.message || error}`);
});

window.SubToVoicePopup = { getLog, refreshState, setState, downloadButton };
