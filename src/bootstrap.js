chrome.storage.local.get("enabled").then(({ enabled }) => {
  if (enabled === undefined) chrome.storage.local.set({ enabled: true });
});
