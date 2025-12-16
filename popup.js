const ui = {
  words: document.getElementById("words"),
  interval: document.getElementById("interval"),
  intervalLabel: document.getElementById("intervalLabel"),
  randomize: document.getElementById("randomize"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  status: document.getElementById("status"),
  statusText: document.querySelector("#status .status__text"),
  statusDot: document.querySelector("#status .dot"),
  currentItem: document.getElementById("currentItem")
};

let running = false;

function setStatus(state, message) {
  ui.status.classList.remove("status--idle", "status--running", "status--success", "status--error");
  ui.status.classList.add(`status--${state}`);
  ui.statusText.textContent = message;
}

function setRunningState(isRunning) {
  running = isRunning;
  ui.startBtn.disabled = isRunning;
  ui.stopBtn.disabled = !isRunning;
  ui.words.disabled = isRunning;
  ui.interval.disabled = isRunning || ui.randomize.checked;
  ui.randomize.disabled = isRunning;
}

function formatIntervalLabel() {
  if (ui.randomize.checked) {
    ui.intervalLabel.textContent = "1–5 s";
  } else {
    ui.intervalLabel.textContent = `${ui.interval.value}\u00A0s`;
  }
}

function parseWords() {
  return ui.words.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function persistSettings() {
  const data = {
    words: ui.words.value,
    interval: ui.interval.value,
    randomize: ui.randomize.checked
  };
  chrome.storage.local.set({ autoSearchSettings: data });
}

function restoreSettings() {
  chrome.storage.local.get("autoSearchSettings", (result) => {
    const data = result.autoSearchSettings;
    if (!data) return;
    if (typeof data.words === "string") {
      ui.words.value = data.words;
    }
    if (data.interval) {
      ui.interval.value = data.interval;
    }
    if (typeof data.randomize === "boolean") {
      ui.randomize.checked = data.randomize;
    }
    formatIntervalLabel();
  });
}

function startSearch() {
  const words = parseWords();
  if (words.length === 0) {
    setStatus("error", "Add at least one search term");
    return;
  }

  const randomize = ui.randomize.checked;
  const intervalMs = Number(ui.interval.value) * 1000;

  setRunningState(true);
  setStatus("running", "Starting auto search...");

  chrome.runtime.sendMessage(
    {
      type: "start-search",
      payload: {
        words,
        intervalMs,
        randomize
      }
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setRunningState(false);
        setStatus("error", "Extension error. Reopen popup.");
        return;
      }
      if (!response || !response.ok) {
        setRunningState(false);
        setStatus("error", response?.message || "Unable to start");
      } else {
        setStatus("running", "Auto search running...");
      }
    }
  );
}

function stopSearch() {
  chrome.runtime.sendMessage({ type: "stop-search" }, (response) => {
    setRunningState(false);
    if (chrome.runtime.lastError) {
      setStatus("error", "Extension error. Reopen popup.");
      return;
    }
    if (!response || !response.ok) {
      setStatus("error", response?.message || "Unable to stop");
    } else {
      setStatus("idle", "Stopped");
    }
  });
}

function handleStatusUpdate(message) {
  if (message.type !== "search-status") return;

  switch (message.status) {
    case "running":
      setRunningState(true);
      setStatus(
        "running",
        message.message || `Searching (${message.currentIndex}/${message.total})`
      );
      if (ui.currentItem) ui.currentItem.textContent = message.currentWord || "—";
      break;
    case "completed":
      setRunningState(false);
      setStatus("success", message.message || "All searches completed");
      if (ui.currentItem) ui.currentItem.textContent = "—";
      break;
    case "idle":
      setRunningState(false);
      setStatus("idle", message.message || "Idle");
      if (ui.currentItem) ui.currentItem.textContent = "—";
      break;
    case "error":
      setRunningState(false);
      setStatus("error", message.message || "Error occurred");
      if (ui.currentItem) ui.currentItem.textContent = message.currentWord || "—";
      break;
    default:
      break;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  restoreSettings();
  formatIntervalLabel();
  setStatus("idle", "Idle");

  ui.interval.addEventListener("input", () => {
    formatIntervalLabel();
    persistSettings();
  });

  ui.words.addEventListener("input", persistSettings);
  ui.randomize.addEventListener("change", () => {
    ui.interval.disabled = ui.randomize.checked || running;
    formatIntervalLabel();
    persistSettings();
  });

  ui.startBtn.addEventListener("click", startSearch);
  ui.stopBtn.addEventListener("click", stopSearch);
});

chrome.runtime.onMessage.addListener((message) => {
  handleStatusUpdate(message);
});
