/**
 * Offscreen Document
 * MV3 架構：負責音訊捕獲和即時轉錄
 *
 * 流程：
 * 1. 接收 START_CAPTURE 訊息（包含 streamId, apiKey, language）
 * 2. 使用 getUserMedia + chromeMediaSource: 'tab' 取得 Tab 音訊
 * 3. 如果啟用麥克風，用 AudioContext 混合兩個音源
 * 4. 建立 AudioContext 回放（讓使用者能聽到對方聲音）
 * 5. 每隔 N 秒重啟 MediaRecorder，產生完整的音訊檔
 * 6. 將音訊送到 Groq Whisper API 進行轉錄
 * 7. 將轉錄結果透過 message 傳回 background → content script
 */

import type { StartCapture, TranscriptResult } from '@/lib/message-types';
import { transcribeAudio, isTranscriptionError } from '@/lib/transcription';

console.log('[Offscreen] === OFFSCREEN DOCUMENT LOADED ===');

// ============================================
// 狀態
// ============================================

let mediaRecorder: MediaRecorder | null = null;
let tabStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let mixingContext: AudioContext | null = null;
let playbackContext: AudioContext | null = null;
let streamToRecord: MediaStream | null = null;

// 轉錄相關狀態
let apiKey: string = '';
let language: string = 'zh';
let sequenceNumber: number = 0;
let isCapturing: boolean = false;

// 錄製循環狀態
let recordingTimer: ReturnType<typeof setTimeout> | null = null;
let currentChunks: Blob[] = [];

// ============================================
// 設定
// ============================================

// 每隔多少毫秒重啟錄製並送出轉錄（2-5 秒）
const RECORDING_DURATION_MS = 3000;

// ============================================
// Message Handling
// ============================================

chrome.runtime.onMessage.addListener((msg: unknown) => {
  const message = msg as { type: string };
  console.log('[Offscreen] Received message:', message.type);

  switch (message.type) {
    case 'START_CAPTURE':
      handleStartCapture(msg as StartCapture);
      break;
    case 'STOP_CAPTURE':
      handleStopCapture();
      break;
  }

  return false;
});

// ============================================
// 錄製循環
// ============================================

/**
 * 開始一個錄製週期
 */
function startRecordingCycle(): void {
  if (!streamToRecord || !isCapturing) {
    console.log('[Offscreen] Cannot start recording cycle - no stream or not capturing');
    return;
  }

  currentChunks = [];

  mediaRecorder = new MediaRecorder(streamToRecord, { mimeType: 'audio/webm;codecs=opus' });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      currentChunks.push(event.data);
      console.log(`[Offscreen] Chunk: ${event.data.size} bytes`);
    }
  };

  mediaRecorder.onstop = async () => {
    if (currentChunks.length === 0) {
      console.log('[Offscreen] No chunks recorded in this cycle');
      return;
    }

    // 🔑 合併 chunks 成完整的 WebM 檔案（因為是單次錄製，所以有完整 header）
    const audioBlob = new Blob(currentChunks, { type: 'audio/webm' });
    console.log('[Offscreen] Recording cycle complete:', audioBlob.size, 'bytes');

    // 非同步處理轉錄，不阻塞下一個週期
    processAudioBlob(audioBlob);
  };

  mediaRecorder.onerror = (event) => {
    console.error('[Offscreen] MediaRecorder error:', event);
  };

  // 開始錄製
  mediaRecorder.start();
  console.log('[Offscreen] Recording cycle started');

  // 設定定時器，在 N 秒後停止並開始下一個週期
  recordingTimer = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();

      // 如果還在捕獲中，啟動下一個週期
      if (isCapturing) {
        startRecordingCycle();
      }
    }
  }, RECORDING_DURATION_MS);
}

/**
 * 處理音訊並送到 API 轉錄
 */
async function processAudioBlob(audioBlob: Blob): Promise<void> {
  // 過濾太小的音訊
  if (audioBlob.size < 5000) {
    console.log('[Offscreen] Audio too small, skipping:', audioBlob.size, 'bytes');
    return;
  }

  // 檢查 apiKey
  if (!apiKey) {
    console.log('[Offscreen] No API key, skipping transcription');
    return;
  }

  console.log('[Offscreen] Sending to API:', audioBlob.size, 'bytes');

  const result = await transcribeAudio(audioBlob, apiKey, language);

  if (isTranscriptionError(result)) {
    console.warn('[Offscreen] Transcription failed:', result.error);
    return;
  }

  // 過濾空白結果
  if (!result.text || result.text.trim().length === 0) {
    console.log('[Offscreen] Empty transcription, skipping');
    return;
  }

  console.log('[Offscreen] Transcription result:', result.text);

  // 發送轉錄結果到 background
  const transcriptMsg: TranscriptResult = {
    type: 'TRANSCRIPT_RESULT',
    text: result.text,
    timestamp: Date.now(),
    sequenceNumber: sequenceNumber++,
    isFinal: true,
  };

  chrome.runtime.sendMessage(transcriptMsg).catch((err) => {
    console.warn('[Offscreen] Failed to send transcript:', err);
  });
}

// ============================================
// Capture Control
// ============================================

async function handleStartCapture(message: StartCapture): Promise<void> {
  if (isCapturing) {
    console.log('[Offscreen] Already capturing, ignoring start request');
    return;
  }

  const { streamId, includeMicrophone, microphoneDeviceLabel } = message;

  // 儲存 API 設定
  apiKey = message.apiKey;
  language = message.language || 'zh';
  sequenceNumber = 0;

  console.log('[Offscreen] Starting capture:', {
    streamId: streamId.substring(0, 20) + '...',
    includeMicrophone,
    microphoneDeviceLabel,
    language,
    hasApiKey: !!apiKey,
  });

  if (!apiKey) {
    console.error('[Offscreen] No API key provided');
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      error: '請先設定 Groq API Key',
    }).catch(console.error);
    return;
  }

  try {
    // 🔑 Step 1: 取得 Tab 音訊（對方的聲音）
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error - Chrome-specific constraints
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });

    console.log('[Offscreen] Got Tab stream:', {
      tracks: tabStream.getAudioTracks().length,
      enabled: tabStream.getAudioTracks()[0]?.enabled,
    });

    // 🔑 Step 2: 回放 Tab 音訊，讓使用者能聽到對方聲音
    playbackContext = new AudioContext();
    if (playbackContext.state === 'suspended') {
      await playbackContext.resume();
    }
    const playbackSource = playbackContext.createMediaStreamSource(tabStream);
    playbackSource.connect(playbackContext.destination);
    console.log('[Offscreen] Tab audio playback connected, state:', playbackContext.state);

    // 🔑 Step 3: 決定要錄製的 stream
    if (includeMicrophone) {
      console.log('[Offscreen] Attempting to get microphone...');
      try {
        // 🔑 根據 label 找到對應的 deviceId
        let micDeviceId: string | undefined;
        if (microphoneDeviceLabel) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const micDevice = devices.find(
            (d) => d.kind === 'audioinput' && d.label === microphoneDeviceLabel
          );
          if (micDevice) {
            micDeviceId = micDevice.deviceId;
            console.log('[Offscreen] Found microphone device:', {
              label: micDevice.label,
              deviceId: micDeviceId.substring(0, 20) + '...',
            });
          } else {
            console.warn(
              '[Offscreen] Microphone device not found by label:',
              microphoneDeviceLabel
            );
          }
        }

        // 取得麥克風（使用指定的 deviceId 或預設）
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
            echoCancellation: false, // 不要消除回音，我們想錄到自己的聲音
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        console.log('[Offscreen] Got Microphone stream:', {
          tracks: micStream.getAudioTracks().length,
          enabled: micStream.getAudioTracks()[0]?.enabled,
          label: micStream.getAudioTracks()[0]?.label,
        });

        // 🔑 Step 4: 混合 Tab + 麥克風
        mixingContext = new AudioContext();

        // 🔑 關鍵：確保 AudioContext 是 running 狀態
        if (mixingContext.state === 'suspended') {
          await mixingContext.resume();
        }
        console.log('[Offscreen] Mixing AudioContext state:', mixingContext.state);

        const mixedDest = mixingContext.createMediaStreamDestination();

        // 連接 Tab 音訊到混音目標
        const tabSource = mixingContext.createMediaStreamSource(tabStream);
        const tabGain = mixingContext.createGain();
        tabGain.gain.value = 1.0;
        tabSource.connect(tabGain);
        tabGain.connect(mixedDest);

        // 連接麥克風到混音目標
        const micSource = mixingContext.createMediaStreamSource(micStream);
        const micGain = mixingContext.createGain();
        micGain.gain.value = 1.0;
        micSource.connect(micGain);
        micGain.connect(mixedDest);

        console.log('[Offscreen] Audio mixing complete');

        streamToRecord = mixedDest.stream;
      } catch (micErr) {
        console.warn('[Offscreen] Microphone access failed, falling back to tab-only:', micErr);
        streamToRecord = tabStream;
      }
    } else {
      console.log('[Offscreen] Microphone disabled, using tab-only');
      streamToRecord = tabStream;
    }

    // 🔑 Step 5: 開始錄製循環
    isCapturing = true;
    startRecordingCycle();

    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED' }).catch(console.error);
    window.location.hash = 'recording';

    console.log('[Offscreen] Capture started with', RECORDING_DURATION_MS, 'ms cycles');
  } catch (err) {
    console.error('[Offscreen] Failed to start capture:', err);
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      error: err instanceof Error ? err.message : '無法取得音訊',
    }).catch(console.error);
  }
}

function handleStopCapture(): void {
  console.log('[Offscreen] Stopping capture');

  isCapturing = false;

  // 停止定時器
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }

  // 停止當前錄製
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  // 停止 Tab 音軌
  if (tabStream) {
    tabStream.getTracks().forEach((t) => t.stop());
    tabStream = null;
  }

  // 停止麥克風音軌
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  // 關閉 AudioContext
  if (mixingContext && mixingContext.state !== 'closed') {
    mixingContext.close().catch(console.error);
    mixingContext = null;
  }

  if (playbackContext && playbackContext.state !== 'closed') {
    playbackContext.close().catch(console.error);
    playbackContext = null;
  }

  streamToRecord = null;
  apiKey = '';
  currentChunks = [];

  window.location.hash = '';

  chrome.runtime.sendMessage({ type: 'CAPTURE_STOPPED' }).catch(console.error);
}

console.log('[Offscreen] Ready to receive capture commands');
