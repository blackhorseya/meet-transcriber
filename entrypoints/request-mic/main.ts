/**
 * 麥克風權限請求頁面
 * 
 * Offscreen document 無法彈出權限提示，
 * 所以需要這個獨立頁面來請求麥克風權限。
 * 一旦授權成功，offscreen 就能使用 getUserMedia({ audio: true })。
 */

const contentDiv = document.getElementById('content')!;
const requestBtn = document.getElementById('request-btn')!;

requestBtn.addEventListener('click', async () => {
  requestBtn.textContent = '請求中...';
  (requestBtn as HTMLButtonElement).disabled = true;

  try {
    // 請求麥克風權限
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // 成功後立即停止 stream（只是要拿權限）
    stream.getTracks().forEach(track => track.stop());

    // 顯示成功訊息
    contentDiv.innerHTML = `
      <div class="icon">✅</div>
      <h1 class="success">已授權麥克風</h1>
      <p>
        你可以關閉此頁面了。<br>
        現在可以開始使用 Meet Transcriber 錄製你的聲音。
      </p>
    `;

    // 通知 background（可選）
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' }).catch(() => {});

  } catch (err) {
    console.error('麥克風權限請求失敗:', err);

    // 顯示錯誤訊息
    contentDiv.innerHTML = `
      <div class="icon">❌</div>
      <h1 class="error">授權失敗</h1>
      <p>
        無法取得麥克風權限。請確保你的瀏覽器允許此擴充功能存取麥克風。<br>
        你可以在 chrome://settings/content/microphone 查看設定。
      </p>
      <button id="retry-btn">重試</button>
    `;

    // 重試按鈕
    document.getElementById('retry-btn')?.addEventListener('click', () => {
      location.reload();
    });
  }
});
