// Toolbar icon click toggles the same drawer as the on-page pill.
chrome.action.onClicked.addListener(tab => {
  if (tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, {type: 'consentcart:toggle'}).catch(() => {});
});
