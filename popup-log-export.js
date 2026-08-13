"use strict";

const popup = window.SubToVoicePopup;
popup.downloadButton.addEventListener("click", async () => {
  popup.downloadButton.disabled = true;
  try {
    const log = await popup.getLog();
    const payload = { exportedAt: new Date().toISOString(), extensionVersion: chrome.runtime.getManifest().version, ...log };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `SubToVoice-log-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    popup.setState(`Đã tải log · ${(log.entries || []).length.toLocaleString("vi-VN")} event`);
  } catch (error) {
    popup.setState(`Lỗi tải log: ${error?.message || error}`);
  } finally {
    popup.downloadButton.disabled = false;
  }
});
