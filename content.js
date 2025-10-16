// Panel 400px bên phải, đẩy trang sang trái bằng padding-right trên <html>
// Chỉ bật khi nhận 'TOGGLE_PANEL' (không auto mở).

const PANEL_WIDTH = 400;
const PANEL_ID = "xrunner-right-panel";
const STYLE_ID = "xrunner-right-style";
const SHIFT_ID = "xrunner-right-shift";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = `
    :root { --xrunner-width: ${PANEL_WIDTH}px; }
    #${PANEL_ID}{
      position: fixed; top:0; right:0; width:var(--xrunner-width); height:100vh;
      background:#101114; color:#e6e6e6; z-index:2147483647;
      box-shadow:-2px 0 12px rgba(0,0,0,.4);
      display:flex; flex-direction:column; font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    }
    .xr-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#15171c;border-bottom:1px solid #2a2e36;font-weight:600;}
    .xr-x{border:none;background:transparent;color:#9aa4b2;font-size:18px;cursor:pointer;}
    .xr-bd{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px;}
    .xr-lb{font-size:12px;color:#9aa4b2;margin-bottom:6px;}
    .xr-ta{width:100%;min-height:120px;resize:vertical;background:#0f1218;border:1px solid #2a2e36;color:#d9e1ee;border-radius:8px;padding:8px;outline:none;}
    .xr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    .xr-inp{flex:1;min-width:0;background:#0f1218;border:1px solid #2a2e36;color:#d9e1ee;border-radius:8px;padding:8px;outline:none;}
    .xr-rd{display:flex;align-items:center;gap:6px;margin-right:10px;}
    .xr-act{display:flex;gap:8px;}
    .xr-btn{padding:8px 12px;border-radius:8px;border:1px solid #2a2e36;background:#1b1f27;color:#e6e6e6;cursor:pointer;font-weight:600;}
    .xr-btn:disabled{opacity:.6;cursor:not-allowed;}
    .xr-run{background:#2563eb;border-color:#2563eb;}
    .xr-stop{background:#ef4444;border-color:#ef4444;}
    .xr-log{padding:8px 10px;background:#0f1218;border:1px solid #2a2e36;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;white-space:pre-wrap;max-height:160px;overflow:auto;}
    .xr-ct{font-size:28px;font-weight:700;letter-spacing:.5px;}
    .xr-badge{display:inline-block;padding:2px 8px;background:#0ea5e9;border-radius:999px;font-size:11px;font-weight:700;color:#081018;}
  `;
  document.documentElement.appendChild(st);
}
function applyShift() {
  if (document.getElementById(SHIFT_ID)) return;
  const st = document.createElement("style");
  st.id = SHIFT_ID;
  st.textContent = `
    /* Đẩy toàn trang sang trái bằng padding-right (ổn hơn margin) */
    html { padding-right: var(--xrunner-width) !important; width: auto !important; }
    body { width: auto !important; }
    html { overflow-y: scroll; }
  `;
  document.documentElement.appendChild(st);
}
function removeShift() {
  document.getElementById(SHIFT_ID)?.remove();
}

function createPanel() {
  ensureStyle();
  if (document.getElementById(PANEL_ID)) return;

  const root = document.createElement("div");
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="xr-hd">
      <div>X Post Runner <span class="xr-badge">v1.2.1</span></div>
      <button class="xr-x" title="Đóng panel">✕</button>
    </div>
    <div class="xr-bd">
      <div>
        <div class="xr-lb">Dán link X (mỗi dòng 1 link)</div>
        <textarea id="xr-links" class="xr-ta" placeholder="https://x.com/username/status/123
https://x.com/another/status/456"></textarea>
      </div>

      <div>
        <div class="xr-lb">Chọn API</div>
        <div class="xr-row">
          <label class="xr-rd"><input type="radio" name="xr-model" value="gemini" checked /><span>Gemini</span></label>
          <label class="xr-rd"><input type="radio" name="xr-model" value="chatgpt" /><span>ChatGPT</span></label>
          <input id="xr-apikey" class="xr-inp" type="password" placeholder="API Key (tuỳ chọn)" />
        </div>
      </div>
      <div>
  <div class="xr-lb">Prompt gửi AI</div>
  <textarea id="xr-prompt" class="xr-ta" placeholder="Viết một phản hồi ngắn, thân thiện, có lý lẽ..."></textarea>
</div>
 <div>
    <div class="xr-lb">Chọn hành động</div>
    <div class="xr-row">
      <label class="xr-rd"><input type="checkbox" id="xr-act-like" checked /><span>Like (Tym)</span></label>
      <label class="xr-rd"><input type="checkbox" id="xr-act-repost" checked /><span>Repost</span></label>
      <label class="xr-rd"><input type="checkbox" id="xr-act-comment" checked /><span>Comment</span></label>
    </div>
  </div>

      <div class="xr-act">
        <button id="xr-run" class="xr-btn xr-run">Run</button>
        <button id="xr-stop" class="xr-btn xr-stop">Stop</button>
      </div>

      <div>
        <div class="xr-lb">Đếm ngược</div>
        <div id="xr-ctdown" class="xr-ct">—</div>
      </div>

      <div>
        <div class="xr-lb">Log</div>
        <div id="xr-log" class="xr-log"></div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(root);
  applyShift();

  // --- UI logic ---
  const $ = (s) => root.querySelector(s);
  const linksEl = $("#xr-links");
  const runBtn = $("#xr-run");
  const stopBtn = $("#xr-stop");
  const ctEl = $("#xr-ctdown");
  const logEl = $("#xr-log");
  const promptEl = $("#xr-prompt");
  const actLikeEl = $("#xr-act-like");
  const actRepostEl = $("#xr-act-repost");
  const actCommentEl = $("#xr-act-comment");

  root.querySelector(".xr-x").addEventListener("click", () => {
    root.remove();
    removeShift();
  });

  chrome.storage.local.get(
    [
      "xrunner_lastModel",
      "xrunner_lastKey",
      "xrunner_lastPrompt",
      "xrunner_lastActions",
    ],
    (d) => {
      const lastModel = d?.xrunner_lastModel || "gemini";
      const lastKey = d?.xrunner_lastKey || "";
      const lastPrompt = d?.xrunner_lastPrompt || "";
      const a = d?.xrunner_lastActions || {
        like: true,
        repost: true,
        comment: true,
      };
      root
        .querySelectorAll('input[name="xr-model"]')
        .forEach((r) => (r.checked = r.value === lastModel));
      $("#xr-apikey").value = lastKey;
      promptEl.value = lastPrompt;

      if (actLikeEl) actLikeEl.checked = !!a.like;
      if (actRepostEl) actRepostEl.checked = !!a.repost;
      if (actCommentEl) actCommentEl.checked = !!a.comment;
    }
  );

  let tmr = null;
  function render(sec) {
    const m = Math.floor(sec / 60),
      s = sec % 60;
    ctEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
  }
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
  function stopCountdown() {
    clearInterval(tmr);
    ctEl.textContent = "—";
  }
  function log(line) {
    const ts = new Date().toLocaleTimeString();
    logEl.textContent += `[${ts}] ${line}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  chrome.runtime.sendMessage({ type: "REGISTER_UI" }, (resp) => {
    if (resp?.running) log("Đang chạy trong nền...");
  });

  runBtn.addEventListener("click", () => {
    const urls = (linksEl.value || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const model =
      root.querySelector('input[name="xr-model"]:checked')?.value || "gemini";
    const apiKey = $("#xr-apikey").value || "";
    const prompt = promptEl.value || "";
    const actions = {
      like: actLikeEl?.checked !== false,
      repost: actRepostEl?.checked !== false,
      comment: actCommentEl?.checked !== false,
    };
    chrome.runtime.sendMessage(
      { type: "START", urls, model, apiKey, prompt, actions },
      (resp) => {
        if (resp?.ok) {
          log("Đã bắt đầu.");
          runBtn.disabled = true;
        } else {
          log("Không thể bắt đầu. Kiểm tra danh sách link.");
        }
      }
    );
  });
  stopBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "STOP" }, (resp) => {
      if (resp?.ok) log("Đã gửi lệnh dừng.");
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg?.type) {
      case "STARTED":
        log(`Bắt đầu xử lý ${msg.total} link...`);
        break;
      case "PROCESSING":
        log(`Đang xử lý (${msg.index + 1}/${msg.total}): ${msg.url}`);
        startCountdown(msg.waitSeconds);
        break;
      case "LOG":
        log(msg.message);
        break;
      case "STOPPED":
        log("Đã dừng. Đóng mọi tab đã mở.");
        stopCountdown();
        runBtn.disabled = false;
        break;
      case "FINISHED":
        log("Hoàn tất tất cả link.");
        stopCountdown();
        runBtn.disabled = false;
        break;
    }
  });
}

function togglePanel() {
  const exist = document.getElementById(PANEL_ID);
  if (exist) {
    exist.remove();
    removeShift();
  } else {
    createPanel();
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "TOGGLE_PANEL") togglePanel();
});
