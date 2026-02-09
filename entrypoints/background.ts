/**
 * Background Service Worker
 * MV3 架構：使用 tabCapture.getMediaStreamId + Offscreen Document
 *
 * 流程：
 * 1. Popup 點擊開始 → 發送 START_CAPTURE_REQUEST
 * 2. Background 呼叫 tabCapture.getMediaStreamId（在 user gesture context 內）
 * 3. Background 建立 offscreen document
 * 4. Background 將 streamId 傳給 offscreen
 * 5. Offscreen 用 getUserMedia + chromeMediaSource: 'tab' 取得音訊
 * 6. Offscreen 錄製並轉錄，結果傳回 background → content script
 */

import { getLanguage, getApiKey, getSetting } from '@/lib/storage';
import type {
  Message,
  PopupMessage,
  OffscreenMessage,
  StatusResponse,
} from '@/lib/message-types';

export default defineBackground(() => {
  console.log('[Background] Service Worker started');

  // ============================================
  // State
  // ============================================

  let isCapturing = false;
  let currentTabId: number | null = null;

  // ============================================
  // Message Handling
  // ============================================

  browser.runtime.onMessage.addListener(
    (message: Message, sender, sendResponse) => {
      console.log('[Background] Received message:', message.type, 'from:', sender.url || sender.id);

      // 處理來自 Popup 的訊息
      if (isPopupMessage(message)) {
        handlePopupMessage(message, sendResponse);
        return true; // Will respond asynchronously
      }

      // 處理來自 Offscreen 的訊息
      if (isOffscreenMessage(message)) {
        handleOffscreenMessage(message);
        return false;
      }

      return false;
    }
  );

  // ============================================
  // Popup Message Handlers
  // ============================================

  async function handlePopupMessage(
    message: PopupMessage,
    sendResponse: (response: StatusResponse) => void
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'START_CAPTURE_REQUEST':
          await startCapture();
          sendResponse({ type: 'STATUS_RESPONSE', isCapturing: true });
          break;

        case 'STOP_CAPTURE_REQUEST':
          await stopCapture();
          sendResponse({ type: 'STATUS_RESPONSE', isCapturing: false });
          break;

        case 'GET_STATUS_REQUEST':
          sendResponse({ type: 'STATUS_RESPONSE', isCapturing });
          break;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : '未知錯誤';
      console.error('[Background] Error handling popup message:', err);
      sendResponse({ type: 'STATUS_RESPONSE', isCapturing, error });
    }
  }

  // ============================================
  // Offscreen Message Handlers
  // ============================================

  function handleOffscreenMessage(message: OffscreenMessage): void {
    switch (message.type) {
      case 'TRANSCRIPT_RESULT':
        // 轉發轉錄結果給 content script
        forwardToContentScript(message);
        break;

      case 'CAPTURE_STARTED':
        isCapturing = true;
        console.log('[Background] Capture started (from offscreen)');
        break;

      case 'CAPTURE_STOPPED':
        isCapturing = false;
        console.log('[Background] Capture stopped (from offscreen)');
        break;

      case 'CAPTURE_ERROR':
        isCapturing = false;
        console.error('[Background] Capture error:', message.error);
        break;
    }
  }

  // ============================================
  // Capture Control (MV3 tabCapture 流程)
  // ============================================

  async function startCapture(): Promise<void> {
    // 取得目前 active tab
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('無法取得目前分頁');
    }

    // 檢查是否在 Google Meet
    if (!tab.url?.includes('meet.google.com')) {
      throw new Error('請在 Google Meet 頁面使用');
    }

    currentTabId = tab.id;

    // 取得設定
    const language = await getLanguage();
    const apiKey = await getApiKey();
    const chunkDuration = await getSetting('chunkDuration');
    const includeMicrophone = await getSetting('includeMicrophone');
    const microphoneDeviceLabel = await getSetting('microphoneDeviceLabel');

    if (!apiKey) {
      throw new Error('請先設定 Groq API Key');
    }

    console.log('[Background] Getting streamId for tab:', tab.id);

    // 🔑 關鍵：在 user gesture context 內呼叫 getMediaStreamId
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });

    console.log('[Background] Got streamId:', streamId.substring(0, 20) + '...');

    // 確保 offscreen document 存在
    await ensureOffscreenDocument();

    // 發送開始錄製指令給 Offscreen（包含 streamId）
    console.log('[Background] Sending START_CAPTURE to offscreen');
    await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      streamId,
      language,
      apiKey,
      chunkDuration,
      includeMicrophone,
      microphoneDeviceLabel,
    });

    console.log('[Background] Start capture request sent to offscreen');
  }

  async function stopCapture(): Promise<void> {
    // 發送停止錄製指令給 Offscreen
    console.log('[Background] Sending STOP_CAPTURE to offscreen');
    await chrome.runtime.sendMessage({
      type: 'STOP_CAPTURE',
    });

    currentTabId = null;
    console.log('[Background] Stop capture request sent to offscreen');
  }

  // ============================================
  // Offscreen Document Management
  // ============================================

  async function ensureOffscreenDocument(): Promise<void> {
    // 檢查是否已存在
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
      console.log('[Background] Offscreen document already exists');
      return;
    }

    // 建立 offscreen document
    // WXT 會將 entrypoints/offscreen/index.html 建置為 offscreen.html
    console.log('[Background] Creating offscreen document...');
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Recording audio from tab for transcription',
    });

    console.log('[Background] Offscreen document created');
  }

  // ============================================
  // Content Script Communication
  // ============================================

  function forwardToContentScript(message: OffscreenMessage): void {
    if (!currentTabId) return;

    browser.tabs.sendMessage(currentTabId, message).catch((err) => {
      console.error('[Background] Failed to forward to content script:', err);
    });
  }

  // ============================================
  // Type Guards
  // ============================================

  function isPopupMessage(msg: Message): msg is PopupMessage {
    return (
      msg.type === 'START_CAPTURE_REQUEST' ||
      msg.type === 'STOP_CAPTURE_REQUEST' ||
      msg.type === 'GET_STATUS_REQUEST'
    );
  }

  function isOffscreenMessage(msg: Message): msg is OffscreenMessage {
    return (
      msg.type === 'TRANSCRIPT_RESULT' ||
      msg.type === 'CAPTURE_STARTED' ||
      msg.type === 'CAPTURE_STOPPED' ||
      msg.type === 'CAPTURE_ERROR'
    );
  }
});
