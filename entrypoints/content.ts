/**
 * Content Script
 * MV3 架構：只負責注入 TranscriptPanel UI 並接收轉錄結果
 *
 * 音訊捕獲完全由 Offscreen Document 處理，
 * Content Script 只負責顯示結果
 */

import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { TranscriptPanel } from '@/components/TranscriptPanel';
import type { Message } from '@/lib/message-types';

export default defineContentScript({
  matches: ['*://meet.google.com/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Content] === CONTENT SCRIPT LOADED ===');
    console.log('[Content] URL:', window.location.href);

    // 設定訊息監聽器（來自 background）
    setupBackgroundMessageListener();

    // 檢查是否為會議頁面
    if (!isMeetingPage()) {
      console.log('[Content] Not a meeting page, skipping UI injection');
      return;
    }

    // 等待 Meet 頁面載入完成後注入 UI
    console.log('[Content] Waiting for Meet to be ready...');
    waitForMeetReady().then(() => {
      console.log('[Content] Meet is ready, injecting panel...');
      injectTranscriptPanel();
    });
  },
});

/**
 * 監聽來自 background 的訊息
 */
function setupBackgroundMessageListener(): void {
  browser.runtime.onMessage.addListener((message: Message) => {
    console.log('[Content] Received message from background:', message.type);

    switch (message.type) {
      case 'TRANSCRIPT_RESULT':
        // 轉發給頁面的 TranscriptPanel（透過 CustomEvent）
        window.dispatchEvent(new CustomEvent('meet-transcriber-result', {
          detail: message,
        }));
        break;
    }
  });
}

/**
 * 檢查是否為實際的會議頁面
 */
function isMeetingPage(): boolean {
  const path = window.location.pathname;
  // 會議代碼格式：xxx-xxxx-xxx 或 lookup 頁面
  return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(path) || path.startsWith('/lookup/');
}

/**
 * 等待 Meet 頁面主要元素載入
 */
async function waitForMeetReady(): Promise<void> {
  return new Promise((resolve) => {
    const checkReady = () => {
      const meetContainer = document.querySelector('[data-call-active]') ||
                           document.querySelector('[data-meeting-id]') ||
                           document.querySelector('c-wiz[data-view-id]');

      if (meetContainer) {
        resolve();
        return true;
      }
      return false;
    };

    if (checkReady()) return;

    const observer = new MutationObserver(() => {
      if (checkReady()) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // 超時保護
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 10000);
  });
}

/**
 * 注入 TranscriptPanel 到頁面
 */
function injectTranscriptPanel(): void {
  if (document.getElementById('meet-transcriber-root')) {
    console.log('[Content] TranscriptPanel already injected');
    return;
  }

  const container = document.createElement('div');
  container.id = 'meet-transcriber-root';
  document.body.appendChild(container);

  const shadow = container.attachShadow({ mode: 'closed' });

  const reactRoot = document.createElement('div');
  reactRoot.id = 'react-root';
  shadow.appendChild(reactRoot);

  const root = createRoot(reactRoot);
  root.render(createElement(TranscriptPanel));

  console.log('[Content] TranscriptPanel injected successfully');
}
