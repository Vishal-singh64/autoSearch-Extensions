const searchState = {
  words: [],
  currentIndex: 0,
  intervalMs: 3000,
  randomize: false,
  timerId: null,
  isRunning: false,
  tabId: null
};

function resetState() {
  if (searchState.timerId) {
    clearTimeout(searchState.timerId);
    searchState.timerId = null;
  }

  searchState.words = [];
  searchState.currentIndex = 0;
  searchState.intervalMs = 3000;
  searchState.randomize = false;
  searchState.isRunning = false;
  searchState.tabId = null;
}

function computeDelay() {
  if (searchState.randomize) {
    return 1000 + Math.floor(Math.random() * 4000);
  }
  return searchState.intervalMs;
}

function broadcastStatus(data) {
  const payload = {
    type: "search-status",
    status: data.status,
    message: data.message,
    currentIndex: data.currentIndex,
    total: data.total,
    running: data.running,
    currentWord: data.currentWord
  };

  chrome.runtime.sendMessage(payload, () => {
    // Suppress errors when popup is closed.
    void chrome.runtime.lastError;
  });
}

async function ensureTab() {
  if (searchState.tabId !== null) {
    try {
      const tab = await chrome.tabs.get(searchState.tabId);
      if (tab && !tab.discarded) {
        return searchState.tabId;
      }
    } catch (error) {
      searchState.tabId = null;
    }
  }

  // Check if there is already an active tab we can hijack, otherwise make a new one
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab && activeTab.id !== undefined) {
    searchState.tabId = activeTab.id;
    return searchState.tabId;
  }

  const newTab = await chrome.tabs.create({ url: "about:blank" });
  searchState.tabId = newTab.id ?? null;
  return searchState.tabId;
}

async function navigateToWord(word) {
  const tabId = await ensureTab();
  if (tabId === null) {
    // If we can't get a tab, we can't proceed.
    console.error("Could not secure a tab for searching.");
    return;
  }

  try {
    // The ideal method: Use the browser's default search engine.
    // This requires the "search" permission in manifest.json.
    if (chrome.search && typeof chrome.search.query === 'function') {
      await chrome.search.query({
        text: word,
        tabId: tabId
      });
    } else {
      // Fallback if chrome.search is not available.
      throw new Error("chrome.search API not available.");
    }
  } catch (error) {
    console.warn("chrome.search failed, using fallback mechanism:", error.message);
    // Fallback: Construct a generic search URL and navigate directly.
    const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent(word)}`;
    try {
      await chrome.tabs.update(tabId, { url: fallbackUrl });
    } catch (updateError) {
      console.error("Fallback navigation failed:", updateError);
      // If updating the tab fails, we might need to create a new one.
      const newTab = await chrome.tabs.create({ url: fallbackUrl });
      searchState.tabId = newTab.id ?? null;
    }
  }
}

async function runNextSearch() {
  if (!searchState.isRunning) {
    return;
  }

  if (searchState.currentIndex >= searchState.words.length) {
    broadcastStatus({
      status: "completed",
      message: "All searches completed",
      currentIndex: searchState.words.length,
      total: searchState.words.length,
      running: false
    });
    resetState();
    return;
  }

  const word = searchState.words[searchState.currentIndex];
  const position = searchState.currentIndex + 1;

  broadcastStatus({
    status: "running",
    message: "Running",
    currentIndex: position,
    total: searchState.words.length,
    running: true,
    currentWord: word
  });

  try {
    await navigateToWord(word);
  } catch (error) {
    broadcastStatus({
      status: "error",
      message: "Search failed",
      currentIndex: position,
      total: searchState.words.length,
      running: false,
      currentWord: word
    });
    resetState();
    return;
  }

  searchState.currentIndex += 1;

  // Check completion immediately after incrementing to ensure accurate status update
  if (searchState.currentIndex >= searchState.words.length) {
     // Optional: Add a small delay before finishing so the last tab stays open briefly
     setTimeout(() => {
        broadcastStatus({
          status: "completed",
          message: "All searches completed",
          currentIndex: searchState.words.length,
          total: searchState.words.length,
          running: false
        });
        resetState();
     }, 1000);
     return;
  }

  const delay = computeDelay();
  searchState.timerId = setTimeout(() => {
    searchState.timerId = null;
    void runNextSearch();
  }, delay);
}

async function handleStart(payload) {
  if (searchState.isRunning) {
    throw new Error("Auto search is already running");
  }

  if (!payload || !Array.isArray(payload.words) || payload.words.length === 0) {
    throw new Error("No search terms provided");
  }

  searchState.words = payload.words;
  searchState.intervalMs = Math.max(1000, Number(payload.intervalMs) || 3000);
  searchState.randomize = Boolean(payload.randomize);
  searchState.currentIndex = 0;
  searchState.isRunning = true;

  try {
    await ensureTab();
  } catch (error) {
    // Non-fatal
  }

  void runNextSearch();
}

function handleStop() {
  if (searchState.timerId) {
    clearTimeout(searchState.timerId);
    searchState.timerId = null;
  }

  const wasRunning = searchState.isRunning;
  resetState();

  if (wasRunning) {
    broadcastStatus({
      status: "idle",
      message: "Stopped",
      currentIndex: 0,
      total: 0,
      running: false
    });
  }
}

function getStatusSnapshot() {
  return {
    running: searchState.isRunning,
    status: searchState.isRunning ? "running" : "idle",
    currentIndex: searchState.isRunning ? (searchState.currentIndex + 1) : 0,
    total: searchState.words.length,
    randomize: searchState.randomize,
    intervalMs: searchState.intervalMs,
    message: searchState.isRunning ? "Running" : "Idle",
    currentWord: searchState.words[searchState.currentIndex] || ""
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "start-search") {
    (async () => {
      try {
        await handleStart(message.payload);
        sendResponse({ ok: true });
      } catch (error) {
        resetState();
        sendResponse({ ok: false, message: error.message || "Failed to start" });
      }
    })();
    return true;
  }

  if (message.type === "stop-search") {
    handleStop();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "get-status") {
    sendResponse({ ok: true, ...getStatusSnapshot() });
    return;
  }
});