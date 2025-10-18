// ==== STATE ====
const STATE = {
  running: false,
  runId: 0, // <== ID duy nhất cho mỗi lượt Run
  queue: [],
  index: 0,
  currentTabId: null,
  currentUrl: null,
  waitCloseMin: 0.4, // chạy 30 giây
  waitGapMin: 0.2, // nghỉ 1 phút rồi mở link kế
  model: "gemini", // <-- mới
  apiKey: "", // <-- mới
  prompt: "", // <-- mới
  actions: { like: true, repost: true, comment: true },
};

async function postToPanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function resetState() {
  STATE.running = false;
  STATE.queue = [];
  STATE.index = 0;
  STATE.currentTabId = null;
  STATE.currentUrl = null;
}

// Xóa TẤT CẢ alarm của extension (an toàn giữa các lượt)
async function clearAllAlarms() {
  const all = await chrome.alarms.getAll();
  await Promise.all(all.map((a) => chrome.alarms.clear(a.name)));
}

// Tạo tên alarm duy nhất theo runId
function alarmNameClose(runId) {
  return `xrunner-close-${runId}`;
}
function alarmNameNext(runId) {
  return `xrunner-next-${runId}`;
}

// Chờ tab load xong (hoặc hết 3s fallback) — tránh kẹt do sự kiện đã đến trước khi addListener

// Chờ tab ready (status === 'complete') với fallback
function waitForNavReady(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    chrome.tabs.get(tabId, (t) => {
      if (!chrome.runtime.lastError && t && t.status === "complete") finish();
    });

    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      finish();
    }, timeoutMs);
  });
}

async function getTweetText(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      try {
        await new Promise((r) => setTimeout(r, 2000));
        const signInBtn = document.querySelector(
          'a[data-testid="login"][href="/login"]'
        );
        if (signInBtn) {
          signInBtn.click();
          await new Promise((r) => setTimeout(r, 2000));
          const closeBtn = document.querySelector(
            'button[data-testid="app-bar-close"]'
          );
          if (closeBtn) closeBtn.click();
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (_) {}
      const el = document.querySelector('[data-testid="tweetText"]');
      const text = (el?.innerText || el?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return text || "";
    },
  });
  return (Array.isArray(results) && results[0]?.result) || "";
}

async function callGemini({ apiKey, prompt }) {
  if (!apiKey) throw new Error("Thiếu API key cho Gemini");
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

async function callChatGPT({ apiKey, prompt }) {
  if (!apiKey) throw new Error("Thiếu API key cho ChatGPT");
  const url = "https://api.openai.com/v1/chat/completions";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o", // có thể đổi
      messages: [
        {
          role: "system",
          content: "Bạn là trợ lý viết phản hồi ngắn gọn, rõ ràng, lịch sự.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 30,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return text.trim();
}

async function askAI({ model, apiKey, userPrompt, tweetText }) {
  const prompt = (input) =>
    userPrompt
      ? `${userPrompt} Here's the post content: "${input}"`
      : `
Create content for my comment on an X post—brief, under 100 characters; return only the content, no extra sentences; focus on the post and keep it on point.
Here's the post content: "${input}"
`;

  try {
    if ((model || "").toLowerCase() === "gemini") {
      return await callGemini({ apiKey, prompt: prompt(tweetText) });
    } else {
      return await callChatGPT({ apiKey, prompt: prompt(tweetText) });
    }
  } catch (e) {
    await postToPanel({
      type: "LOG",
      message: `⚠️ AI lỗi: ${e?.message || e}`,
    });
    return "";
  }
}

// Thay TOÀN BỘ runUserScriptOnTab() bằng phiên bản này
async function runUserScriptOnTab(tabId, aiText, actions) {
  if (!chrome.scripting?.executeScript) {
    await postToPanel({ type: "LOG", message: "🧩 scripting API unavailable" });
    return { ok: false, error: "scripting API unavailable" };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [aiText, actions], // <-- truyền text vào
    func: async (textToType, actions) => {
      const waitFor = (sel, ms = 20000) =>
        new Promise((res) => {
          const t0 = Date.now();
          (function tick() {
            const el = document.querySelector(sel);
            if (el) return res(el);
            if (Date.now() - t0 > ms) return res(null);
            requestAnimationFrame(tick);
          })();
        });

      try {
        try {
          await new Promise((r) => setTimeout(r, 2000));
          const signInBtn = await waitFor(
            'a[data-testid="login"][href="/login"]',
            2000
          );
          if (signInBtn) {
            signInBtn.click();
            await new Promise((r) => setTimeout(r, 2000));
            const closeBtn = await waitFor(
              'button[data-testid="app-bar-close"]',
              1000
            );
            if (closeBtn) closeBtn.click();
            await new Promise((r) => setTimeout(r, 2000));
          }
        } catch (_) {}
        // 1) Like nếu có
        let reposted = false,
          liked = false,
          commented = false;
        if (actions?.like) {
          const likeBtn = await waitFor('button[data-testid="like"]');
          if (likeBtn) {
            try {
              likeBtn.click();
              liked = true;
              await new Promise((r) => setTimeout(r, 2000));
            } catch (_) {}
          }
        }
        if (actions?.repost) {
          const btnRtw = document.querySelector(
            `button[data-testid="retweet"]`
          );
          if (btnRtw) btnRtw.click();
          reposted = true;
          await new Promise((r) => setTimeout(r, 2000));
          const btnRtwConfirm = document.querySelector(
            '[data-testid="retweetConfirm"][role="menuitem"]'
          );
          if (btnRtwConfirm) btnRtwConfirm.click();
          await new Promise((r) => setTimeout(r, 2000));
        }

        // 2) Tìm ô reply & gõ text AI
        if (actions?.comment) {
          const editor = await waitFor(
            '[data-testid="tweetTextarea_0"][contenteditable="true"]',
            15000
          );

          const toType = textToType.trim() || "";

          if (editor && toType) {
            editor.focus();
            for (const ch of toType) {
              editor.dispatchEvent(
                new KeyboardEvent("keydown", { key: ch, bubbles: true })
              );
              editor.dispatchEvent(
                new InputEvent("beforeinput", {
                  inputType: "insertText",
                  data: ch,
                  bubbles: true,
                  cancelable: true,
                })
              );
              try {
                document.execCommand("insertText", false, ch);
              } catch (_) {}
              editor.dispatchEvent(
                new InputEvent("input", {
                  inputType: "insertText",
                  data: ch,
                  bubbles: true,
                })
              );
              editor.dispatchEvent(
                new KeyboardEvent("keyup", { key: ch, bubbles: true })
              );
              await new Promise((r) => setTimeout(r, 40));
            }
          }
          const btn = document.querySelector(
            'button[data-testid="tweetButtonInline"][role="button"]'
          );
          if (btn) btn.click();
          commented = true;
        }

        return { ok: true, liked, commented, reposted, len: toType.length };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
  });

  const res =
    Array.isArray(results) && results.length ? results[0].result : null;

  await postToPanel({
    type: "LOG",
    message: `🧩 Script result: ${JSON.stringify(res)}`,
  });

  return res || { ok: false, error: "no result from injected script" };
}

async function waitForSelectorInPage(tabId, selector, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (sel) => !!document.querySelector(sel),
        args: [selector],
      });
      if (result) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

//check splash + reload/skip
async function isStuckSplash(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const hasTweet = !!document.querySelector('[data-testid="retweet"]');
        const hasLike = !!document.querySelector('button[data-testid="like"]');
        const hasReply = !!document.querySelector(
          '[data-testid="tweetTextarea_0"]'
        );
        const bodyChildrenFew =
          document.body && document.body.children.length <= 2;
        const isBlackBg =
          getComputedStyle(document.body).backgroundColor === "rgb(0, 0, 0)" ||
          getComputedStyle(document.body).backgroundColor ===
            "rgb(255, 255, 255)";
        const maybeLogo = !!document.querySelector('svg[aria-label="X"]');
        return !hasTweet && !hasLike && !hasReply && bodyChildrenFew;
      },
    });
    return !!result;
  } catch {
    return false;
  }
}

async function ensureTweetDOMReady(tabId, maxReload = 2) {
  const okFirst =
    (await waitForSelectorInPage(tabId, '[data-testid="retweet"]', 8000)) ||
    (await waitForSelectorInPage(tabId, 'button[data-testid="like"]', 2500)) ||
    (await waitForSelectorInPage(
      tabId,
      '[data-testid="tweetTextarea_0_label"]',
      2500
    ));

  if (okFirst) return true;

  for (let i = 0; i < maxReload; i++) {
    const stuck = await isStuckSplash(tabId);
    if (!stuck) break;

    await postToPanel({
      type: "LOG",
      message: `⚠️ Trang X kẹt splash. Reload ${i + 1}/${maxReload}...`,
    });
    try {
      await chrome.tabs.reload(tabId, { bypassCache: true });
    } catch {}
    try {
      await waitForNavReady(tabId, 20000);
    } catch {}
    await new Promise((r) => setTimeout(r, 1200));

    const ok =
      (await waitForSelectorInPage(tabId, '[data-testid="retweet"]', 8000)) ||
      (await waitForSelectorInPage(
        tabId,
        'button[data-testid="like"]',
        2500
      )) ||
      (await waitForSelectorInPage(
        tabId,
        '[data-testid="tweetTextarea_0_label"]',
        2500
      ));

    if (ok) return true;
  }
  return false; // vẫn kẹt
}

async function openCurrent() {
  if (!STATE.running) return;

  if (STATE.index >= STATE.queue.length) {
    await postToPanel({ type: "FINISHED_ALL", total: STATE.queue.length });
    await clearAllAlarms();
    resetState();
    return;
  }

  const url = STATE.queue[STATE.index];
  const thisRun = STATE.runId;

  // B1) MỞ TAB (nếu fail bước này mới coi là "Không thể mở tab")
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: true });
    STATE.currentTabId = tab.id;
    STATE.currentUrl = url;
  } catch (e) {
    await postToPanel({
      type: "LOG",
      message: `Không thể mở tab: ${url} (${e?.message || e})`,
    });
    STATE.index += 1;
    await openCurrent();
    return;
  }

  // B2) ĐỢI LOAD (không fail tổng thể nếu timeout)
  try {
    await waitForNavReady(tab.id, 25000);
    // đệm thêm để SPA render xong
    await new Promise((r) => setTimeout(r, 1200));
  } catch (_) {
    // bỏ qua, vẫn tiếp tục
  }

  // const ready = await ensureTweetDOMReady(tab.id, 2);
  // if (!ready) {
  //   await postToPanel({
  //     type: "LOG",
  //     message: "⏭️ Trang X kẹt splash, bỏ qua link này.",
  //   });

  //   try {
  //     await chrome.tabs.remove(tab.id);
  //   } catch {}
  //   await postToPanel({
  //     type: "FINISHED_ONE",
  //     index: STATE.index,
  //     url: STATE.currentUrl,
  //     total: STATE.queue.length,
  //   });

  //   STATE.index += 1;
  //   STATE.currentTabId = null;
  //   STATE.currentUrl = null;

  //   await chrome.alarms.create(alarmNameNext(STATE.runId), {
  //     delayInMinutes: STATE.waitGapMin,
  //   });
  //   return; // dừng xử lý link hiện tại
  // }

  // Lấy text tweet (nếu fail thì vẫn tiếp tục)
  await postToPanel({
    type: "LOG",
    message: `Actions: ${JSON.stringify(STATE.actions)}`,
  });

  let tweetText = "";
  try {
    tweetText = await getTweetText(tab.id);
    await postToPanel({
      type: "LOG",
      message: `📝 Tweet text: ${tweetText.slice(0, 120)}${
        tweetText.length > 120 ? "..." : ""
      }`,
    });
  } catch (e) {
    await postToPanel({
      type: "LOG",
      message: `⚠️ Không lấy được tweet text: ${e?.message || e}`,
    });
  }

  let aiReply = "";

  aiReply = await askAI({
    model: STATE.model,
    apiKey: STATE.apiKey,
    userPrompt: STATE.prompt,
    tweetText,
  });
  if (!aiReply) {
    await postToPanel({
      type: "LOG",
      message: "⚠️ AI trả về trống. Sẽ không gõ gì.",
    });
  } else {
    await postToPanel({
      type: "LOG",
      message: `✅ AI reply (${aiReply.length} ký tự)`,
    });
  }

  // B4) ĐẶT ALARM ĐÓNG + GỬI PROCESSING (luôn luôn làm, kể cả inject fail)
  try {
    await chrome.alarms.create(alarmNameClose(thisRun), {
      delayInMinutes: STATE.waitCloseMin,
    });
    try {
      const res = await runUserScriptOnTab(tab.id, aiReply, STATE.actions);
      if (res && res.ok) {
        await postToPanel({
          type: "LOG",
          message: `🧩 Script đã chạy: like=${
            res.liked ? "ok" : "no"
          }, commented=${res.commented ? "ok" : "no"}, reposted=${
            res.reposted ? "ok" : "no"
          }, len=${res.len || 0}`,
        });
      } else {
        await postToPanel({
          type: "LOG",
          message: `⚠️ Script chạy lỗi hoặc không hoàn tất.`,
        });
      }
    } catch (e) {
      await postToPanel({
        type: "LOG",
        message: `⚠️ Không inject/không chạy được script: ${e?.message || e}`,
      });
    }
  } catch (_) {}
  await postToPanel({
    type: "PROCESSING",
    url,
    index: STATE.index,
    total: STATE.queue.length,
    waitSeconds: Math.round(
      (Math.random() * (STATE.waitCloseMin - 0.1) + 0.1) * 60
    ),
  });
}

// ==== Messages từ panel ====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "PANEL_READY": {
        const data = await chrome.storage.local.get([
          "xrunner_lastModel",
          "xrunner_lastKey",
          "xrunner_lastPrompt",
          "xrunner_lastActions",
        ]);
        sendResponse({ ok: true, ...data, running: STATE.running });
        break;
      }

      case "START": {
        // Tăng runId cho lượt mới, dọn sạch alarm & state
        STATE.runId += 1;
        const thisRun = STATE.runId;

        await clearAllAlarms();
        resetState();

        const urls = (Array.isArray(msg.validLinks) ? msg.validLinks : [])
          .map((s) => (s || "").trim())
          .filter(Boolean)
          .map((s) => s.replace(/^twitter\.com/i, "https://twitter.com/"))
          .map((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`));

        STATE.queue = urls;
        STATE.running = urls.length > 0;
        STATE.index = 0;
        STATE.model = msg.model || "gemini"; // <-- mới
        STATE.apiKey = msg.apiKey || ""; // <-- mới
        STATE.prompt = msg.prompt || ""; // <-- mới

        const a = msg.actions || {};
        STATE.actions = {
          like: a.like !== false,
          repost: a.repost !== false,
          comment: a.comment !== false,
        };
        await chrome.storage.local.set({
          xrunner_lastModel: STATE.model || "gemini",
          xrunner_lastKey: STATE.apiKey || "",
          xrunner_lastPrompt: STATE.prompt || "",
          xrunner_lastActions: STATE.actions,
        });

        if (!STATE.running) {
          await postToPanel({
            type: "LOG",
            message: `Danh sách link trống.`,
          });
          sendResponse({ ok: false });
          return;
        }

        await postToPanel({ type: "STARTED", total: urls.length });
        await openCurrent();
        sendResponse({ ok: true });
        break;
      }

      case "STOP": {
        await clearAllAlarms();
        if (STATE.currentTabId != null) {
          try {
            await chrome.tabs.remove(STATE.currentTabId);
          } catch (_) {}
        }
        await postToPanel({ type: "STOPPED" });
        resetState();
        sendResponse({ ok: true });
        break;
      }

      // log cuộn 20% từ inpage_runner.js
      case "INPAGE_SCROLLED": {
        const pct = ((msg.scrollY / msg.totalHeight) * 100).toFixed(1);
        let note = "";
        if (msg.atBottom) note = " (chạm đáy)";
        if (msg.timeout) note = " (quá thời gian)";
        await postToPanel({
          type: "LOG",
          message: `✅ Đã cuộn xuống khoảng ${pct}%${note}`,
        });
        sendResponse?.({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});

// ==== Alarms ====
// 3' hết giờ: đóng tab hiện tại, báo FINISHED_ONE và đặt hẹn 1' để mở link kế
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const name = alarm.name || "";
  // Chỉ xử lý alarm đúng với runId hiện tại
  const closePrefix = "xrunner-close-";
  const nextPrefix = "xrunner-next-";

  if (name.startsWith(closePrefix)) {
    const runFromAlarm = Number(name.slice(closePrefix.length));
    if (!STATE.running || runFromAlarm !== STATE.runId) return;

    // đóng tab hiện tại (nếu còn mở)
    if (STATE.currentTabId != null) {
      try {
        await chrome.tabs.remove(STATE.currentTabId);
      } catch (_) {}
    }

    await postToPanel({
      type: "FINISHED_ONE",
      index: STATE.index,
      url: STATE.currentUrl,
      total: STATE.queue.length,
    });

    STATE.index += 1;
    STATE.currentTabId = null;
    STATE.currentUrl = null;

    await chrome.alarms.create(alarmNameNext(runFromAlarm), {
      delayInMinutes: STATE.waitGapMin,
    });
  }

  if (name.startsWith(nextPrefix)) {
    const runFromAlarm = Number(name.slice(nextPrefix.length));
    if (!STATE.running || runFromAlarm !== STATE.runId) return;

    await openCurrent();
  }
});

// Nếu user tự đóng sớm tab hiện tại: coi như đã xong, chờ 1' mở link kế
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (!STATE.running) return;
  if (STATE.currentTabId == null || tabId !== STATE.currentTabId) return;

  // hủy alarm close hiện tại (nếu có) cho runId hiện hành
  await chrome.alarms.clear(alarmNameClose(STATE.runId));

  await postToPanel({
    type: "FINISHED_ONE",
    index: STATE.index,
    url: STATE.currentUrl,
    total: STATE.queue.length,
  });

  STATE.index += 1;
  STATE.currentTabId = null;
  STATE.currentUrl = null;

  await chrome.alarms.create(alarmNameNext(STATE.runId), {
    delayInMinutes: STATE.waitGapMin,
  });
});

// ==== Side Panel (y như cũ) ====
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (_) {}
});
