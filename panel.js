const $ = (s) => document.querySelector(s);

const linksEl = $('#links');
const runBtn  = $('#run');
const stopBtn = $('#stop');
const countEl = $('#countdown');
const logEl   = $('#log');
const promptEl = $('#prompt');
const actLikeEl    = $('#act-like');
const actRepostEl  = $('#act-repost');
const actCommentEl = $('#act-comment'); 

let tmr = null;
function startCountdown(sec) {
  clearInterval(tmr);
  let r = sec;
  render(r);
  tmr = setInterval(() => {
    r -= 1;
    if (r <= 0) { clearInterval(tmr); render(0); }
    else render(r);
  }, 1000);
}
function render(s) { const m = Math.floor(s/60), ss = s%60; countEl.textContent = `${m}:${String(ss).padStart(2,'0')}`; }
function stopCountdown(){ clearInterval(tmr); countEl.textContent = '—'; }
function log(line){ const ts=new Date().toLocaleTimeString(); logEl.textContent += `[${ts}] ${line}\n`; logEl.scrollTop = logEl.scrollHeight; }

function removeLineByUrl(textarea, url) {
  const lines = textarea.value.split(/\r?\n/);
  const idx = lines.findIndex(l => l.trim() === (url || '').trim());
  if (idx >= 0) { lines.splice(idx, 1); textarea.value = lines.join('\n'); }
}

chrome.runtime.sendMessage({ type: 'PANEL_READY' }, (resp) => {
  if (!resp?.ok) return;
  const lastModel = resp.xrunner_lastModel || 'gemini';
  document.querySelectorAll('input[name="model"]').forEach(r => r.checked = (r.value === lastModel));
  $('#apikey').value = resp.xrunner_lastKey || '';
   promptEl.value = resp.xrunner_lastPrompt || '';

     const a = resp.xrunner_lastActions || { like:true, repost:true, comment:true };
  if (actLikeEl)    actLikeEl.checked    = !!a.like;
  if (actRepostEl)  actRepostEl.checked  = !!a.repost;
  if (actCommentEl) actCommentEl.checked = !!a.comment;

  if (resp.running) log('Đang chạy trong nền...');
});

runBtn.addEventListener('click', () => {
  const urls = (linksEl.value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const model = (document.querySelector('input[name="model"]:checked')?.value) || 'gemini';
  const apiKey = $('#apikey').value || '';
   const prompt = promptEl.value || '';

    const actions = {
    like:    actLikeEl?.checked !== false,
    repost:  actRepostEl?.checked !== false,
    comment: actCommentEl?.checked !== false,
  };

  chrome.runtime.sendMessage({ type: 'START', urls, model, apiKey, prompt, actions }, (resp) => {
    if (resp?.ok) { log('Đã bắt đầu.'); runBtn.disabled = true; }
    else { log('Không thể bắt đầu. Kiểm tra danh sách link.'); }
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP' }, (resp) => {
    if (resp?.ok) log('Đã gửi lệnh dừng.');
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case 'STARTED':
      log(`🚀 Bắt đầu xử lý ${msg.total} link...`);
      break;

    case 'PROCESSING':
      log(`▶️ Đang xử lý (${msg.index + 1}/${msg.total}): ${msg.url}`);
      startCountdown(msg.waitSeconds);   // 3 phút
      break;

    case 'FINISHED_ONE':
      log(`✅ Đã hoàn thành (${msg.index + 1}/${msg.total}): ${msg.url}`);
      removeLineByUrl(linksEl, msg.url); // xóa dòng đã chạy
      // lúc này background sẽ tự đặt hẹn 1 phút để mở link kế
      startCountdown(10);                // hiển thị đếm 1 phút nghỉ
      break;

    case 'FINISHED_ALL':
      log(`🎉 Đã chạy hoàn tất ${msg.total} link.`);
      stopCountdown();
      runBtn.disabled = false;
      break;

    case 'LOG':
      log(msg.message);
      break;

    case 'STOPPED':
      log('⛔ Đã dừng. Đóng mọi tab đã mở.');
      stopCountdown();
      runBtn.disabled = false;
      break;
  }
});
