// inpage_runner.js
(() => {
  // Đợi DOM load xong
  function domReady() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return Promise.resolve();
    return new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }

  async function run() {
    await domReady();

    const totalHeight = document.body.scrollHeight;
    const targetScroll = totalHeight * 0.2; // cuộn 20%
    const stepPx = 400; // mỗi lần cuộn
    const stepMs = 700; // thời gian giữa mỗi bước
    const maxMs = 30_000; // tối đa 30s

    let scrolled = 0;
    const start = Date.now();

    const interval = setInterval(() => {
      window.scrollBy({ top: stepPx, behavior: 'smooth' });
      scrolled += stepPx;

      // Điều kiện dừng: cuộn đạt >=20% hoặc quá 30s hoặc chạm đáy
      const reached20 = window.scrollY >= targetScroll;
      const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 2);
      const timeout = (Date.now() - start) > maxMs;

      if (reached20 || atBottom || timeout) {
        clearInterval(interval);
        chrome.runtime.sendMessage({
          type: 'INPAGE_SCROLLED',
          reached20,
          atBottom,
          timeout,
          scrollY: window.scrollY,
          totalHeight
        }).catch(() => {});
      }
    }, stepMs);
  }

  run().catch(()=>{});
})();
