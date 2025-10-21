const $ = (s) => document.querySelector(s);

const linksEl = $("#links");
const scrapeDiscordBtn = $("#scrape-discord");
const totalLinksLabel = $("#total-links");
const totalLinksFailLabel = $("#total-links-fail");
const runBtn = $("#run");
const stopBtn = $("#stop");
const countEl = $("#countdown");
const logEl = $("#log");
const promptEl = $("#prompt");
const actLikeEl = $("#act-like");
const actRepostEl = $("#act-repost");
const actCommentEl = $("#act-comment");
const failedLinksEl = $("#failed-links");
const usernameInput = $("#username-input");
const deleteLinksBtn = $("#deleteLinksBtn");
const usernameListEl = $("#username-list");
const crawlUsernameBtn = $("#btn-crawl-username");
const actSpeedEl = $('input[name="speed"]');
const customSpeedEl = $("custom-speed");

let selectedDelay = 0;
let countdown = 3;
let tmr = null;
function startCountdown(sec) {
  clearInterval(tmr);
  let r = sec;
  render(r);
  tmr = setInterval(() => {
    r -= 1;
    if (r <= 0) {
      clearInterval(tmr);
      render(0);
    } else render(r);
  }, 1000);
}
function render(s) {
  const m = Math.floor(s / 60),
    ss = s % 60;
  countEl.textContent = `${m}:${String(ss).padStart(2, "0")}`;
}
function stopCountdown() {
  clearInterval(tmr);
  countEl.textContent = "—";
}
function log(line) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent += `[${ts}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function getRandomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function removeLineByUrl(textarea, url) {
  const lines = textarea.value.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === (url || "").trim());
  if (idx >= 0) {
    lines.splice(idx, 1);
    textarea.value = lines.join("\n");
  }
}

function filterAndCleanLinks() {
  const links = linksEl.value.trim();
  const lines = links.split(/\r?\n/).filter((line) => line.trim() !== "");

  const validLinks = lines.filter((line) =>
    /^https:\/\/x\.com\//.test(line.trim())
  );

  const uniqueLinks = [...new Set(validLinks)];

  const invalidLinks = lines.filter(
    (line) => !/^https:\/\/x\.com\//.test(line.trim())
  );

  const duplicateLinks = lines.filter(
    (line, index, self) => self.indexOf(line) !== index
  );

  return {
    validLinks: uniqueLinks,
    invalidLinks: invalidLinks,
    duplicateLinks: duplicateLinks,
    totalLinkNumber: validLinks.length,
    validLinkNumber: uniqueLinks.length,
  };
}

function scrapeLinksFromDiscord() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab.url.includes("discord.com")) {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: extractLinksFromDiscord,
        },
        (results) => {
          const links = results[0]?.result || [];
          if (links.length > 0) {
            linksEl.value = links.join("\n");
            countLinks();
            log(`Đã cào ${links.length} link từ Discord.`);
          } else {
            log("Không tìm thấy link hợp lệ trong kênh Discord.");
          }
        }
      );
    } else {
      log("Hãy mở kênh Discord để cào link.");
    }
  });
}

function extractLinksFromDiscord() {
  const links = [];
  const messages = document.querySelectorAll(".contents_c19a55");

  messages.forEach((message) => {
    // Lấy tất cả các thẻ <a> trong tin nhắn
    const anchorTags = message.querySelectorAll("a");

    // Duyệt qua từng thẻ <a> và lấy thuộc tính href
    anchorTags.forEach((anchor) => {
      const url = anchor.href;
      const regex = /https:\/\/x\.com\/[^\s]+/g;
      if (regex.test(url)) {
        links.push(url);
      }
    });
  });

  return [...new Set(links)];
}

const countLinks = () => {
  const links = filterAndCleanLinks();
  totalLinksLabel.textContent = `Valid links: ${links.validLinkNumber}`;
  totalLinksFailLabel.textContent = `Invalid links: ${
    links.totalLinkNumber - links.validLinkNumber
  }`;
};

function addFailedLink(url) {
  const failedLinks = failedLinksEl.value.split("\n").filter(Boolean);

  if (!failedLinks.includes(url)) {
    failedLinks.push(url);
    failedLinksEl.value = failedLinks.join("\n");
  }
}

chrome.runtime.sendMessage({ type: "PANEL_READY" }, (resp) => {
  if (!resp?.ok) return;
  const lastModel = resp.xrunner_lastModel || "gemini";
  document
    .querySelectorAll('input[name="model"]')
    .forEach((r) => (r.checked = r.value === lastModel));
  $("#apikey").value = resp.xrunner_lastKey || "";
  promptEl.value = resp.xrunner_lastPrompt || "";

  const a = resp.xrunner_lastActions || {
    like: true,
    repost: true,
    comment: true,
  };
  if (actLikeEl) actLikeEl.checked = !!a.like;
  if (actRepostEl) actRepostEl.checked = !!a.repost;
  if (actCommentEl) actCommentEl.checked = !!a.comment;

  if (resp.running) log("Đang chạy trong nền...");
});

runBtn.addEventListener("click", () => {
  const links = filterAndCleanLinks();
  const validLinks = links.validLinks;

  if (validLinks.length === 0) {
    log("Không có link hợp lệ để chạy.");
    return;
  }

  const model =
    document.querySelector('input[name="model"]:checked')?.value || "gemini";
  const apiKey = $("#apikey").value || "";
  const prompt = promptEl.value || "";

  const actions = {
    like: actLikeEl?.checked !== false,
    repost: actRepostEl?.checked !== false,
    comment: actCommentEl?.checked !== false,
  };

  startCountdown(countdown);

  setTimeout(() => {
    chrome.runtime.sendMessage(
      { type: "START", validLinks, model, apiKey, prompt, actions },
      (resp) => {
        if (resp?.ok) {
          log("Đã bắt đầu.");
          runBtn.disabled = true;
        } else {
          log("Không thể bắt đầu. Kiểm tra danh sách link.");
        }
      }
    );
  }, countdown * 1000);
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP" }, (resp) => {
    if (resp?.ok) log("Đã gửi lệnh dừng.");
  });
  countLinks();
});

linksEl.addEventListener("input", countLinks);
scrapeDiscordBtn.addEventListener("click", scrapeLinksFromDiscord);

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case "STARTED":
      log(`🚀 Bắt đầu xử lý ${msg.total} link...`);
      break;

    case "PROCESSING":
      log(`▶️ Đang xử lý (${msg.index + 1}/${msg.total}): ${msg.url}`);
      randomTimeDelay();
      // startCountdown(msg.waitSeconds);
      break;

    case "FINISHED_ONE":
      log(`✅ Đã hoàn thành (${msg.index + 1}/${msg.total}): ${msg.url}`);
      removeLineByUrl(linksEl, msg.url);
      log(`Delay ${selectedDelay} giây để chạy link tiếp.`);
      startCountdown(selectedDelay);
      break;

    case "FINISHED_ALL":
      log(`🎉 Đã chạy hoàn tất ${msg.total} link.`);
      stopCountdown();
      runBtn.disabled = false;
      break;

    case "LOG":
      log(msg.message);
      break;

    case "STOPPED":
      log("⛔ Đã dừng. Đóng mọi tab đã mở.");
      stopCountdown();
      runBtn.disabled = false;
      break;
  }
});

deleteLinksBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  if (!username) {
    log("Vui lòng nhập username của X.");
    return;
  }

  // Lọc các link bài viết từ người dùng đó
  const links = filterAndCleanLinks();
  const filteredLinks = links.validLinks.filter(
    (link) => !link.includes(`/${username}`)
  );

  linksEl.value = filteredLinks.join("\n");
  countLinks();

  log(`Đã xóa bài viết của người dùng @${username} khỏi danh sách.`);
});

const randomTimeDelay = () => {
  const selectedValue = document.querySelector(
    'input[name="speed"]:checked'
  ).value;

  switch (selectedValue) {
    case "fast":
      selectedDelay = getRandomInRange(15, 20);
      break;
    case "medium":
      selectedDelay = getRandomInRange(30, 40);
      break;
    case "slow":
      selectedDelay = getRandomInRange(60, 80);
      break;
    case "custom":
      if (customSpeedEl.value) {
        selectedDelay = parseInt(customSpeedEl.value);
      }
      break;
  }

  chrome.runtime.sendMessage({
    type: "SET_DELAY",
    selectedDelay: selectedDelay,
  });
};
