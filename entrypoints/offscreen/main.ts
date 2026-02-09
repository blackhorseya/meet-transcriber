/**
 * Offscreen Document
 * MV3 架構：負責音訊捕獲和錄製
 *
 * 流程：
 * 1. 接收 START_CAPTURE 訊息（包含 streamId）
 * 2. 使用 getUserMedia + chromeMediaSource: 'tab' 取得 Tab 音訊
 * 3. 如果啟用麥克風，用 AudioContext 混合兩個音源
 * 4. 建立 AudioContext 回放（讓使用者能聽到對方聲音）
 * 5. 使用 MediaRecorder 錄製（混合後的）音訊
 * 6. 停止時合併所有 chunks 並開啟音訊檔
 */

import type { StartCapture } from '@/lib/message-types';

console.log('[Offscreen] === OFFSCREEN DOCUMENT LOADED ===');

// ============================================
// 狀態
// ============================================

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let tabStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let mixingContext: AudioContext | null = null;
let playbackContext: AudioContext | null = null;

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
// Capture Control
// ============================================

async function handleStartCapture(message: StartCapture): Promise<void> {
  if (mediaRecorder?.state === 'recording') {
    console.log('[Offscreen] Already recording, ignoring start request');
    return;
  }

  const { streamId, includeMicrophone, microphoneDeviceLabel } = message;

  console.log('[Offscreen] Starting capture:', {
    streamId: streamId.substring(0, 20) + '...',
    includeMicrophone,
    microphoneDeviceLabel,
  });

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
    let streamToRecord: MediaStream;

    if (includeMicrophone) {
      console.log('[Offscreen] Attempting to get microphone...');
      try {
        // 🔑 根據 label 找到對應的 deviceId
        let micDeviceId: string | undefined;
        if (microphoneDeviceLabel) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const micDevice = devices.find(
            d => d.kind === 'audioinput' && d.label === microphoneDeviceLabel
          );
          if (micDevice) {
            micDeviceId = micDevice.deviceId;
            console.log('[Offscreen] Found microphone device:', {
              label: micDevice.label,
              deviceId: micDeviceId.substring(0, 20) + '...',
            });
          } else {
            console.warn('[Offscreen] Microphone device not found by label:', microphoneDeviceLabel);
          }
        }

        // 取得麥克風（使用指定的 deviceId 或預設）
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
            echoCancellation: false,  // 不要消除回音，我們想錄到自己的聲音
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
        console.log('[Offscreen] Mixing AudioContext sampleRate:', mixingContext.sampleRate);

        const mixedDest = mixingContext.createMediaStreamDestination();

        // 連接 Tab 音訊到混音目標（加入 GainNode 方便調整）
        const tabSource = mixingContext.createMediaStreamSource(tabStream);
        const tabGain = mixingContext.createGain();
        tabGain.gain.value = 1.0;  // Tab 音量正常
        tabSource.connect(tabGain);
        tabGain.connect(mixedDest);

        // 連接麥克風到混音目標（加入 GainNode 放大）
        const micSource = mixingContext.createMediaStreamSource(micStream);
        const micGain = mixingContext.createGain();
        micGain.gain.value = 2.0;  // 🔑 放大麥克風音量
        micSource.connect(micGain);
        micGain.connect(mixedDest);

        console.log('[Offscreen] Audio nodes connected with gain:', {
          tabGain: tabGain.gain.value,
          micGain: micGain.gain.value,
        });

        streamToRecord = mixedDest.stream;
        
        console.log('[Offscreen] Audio mixing complete:', {
          mixedTracks: streamToRecord.getAudioTracks().length,
          mixedTrackEnabled: streamToRecord.getAudioTracks()[0]?.enabled,
          mixedTrackMuted: streamToRecord.getAudioTracks()[0]?.muted,
        });

      } catch (micErr) {
        console.warn('[Offscreen] Microphone access failed, falling back to tab-only:', micErr);
        streamToRecord = tabStream;
      }
    } else {
      console.log('[Offscreen] Microphone disabled, using tab-only');
      streamToRecord = tabStream;
    }

    // 🔑 Step 5: 開始錄製
    recordedChunks = [];
    
    // Debug: 確認使用的是哪個 stream
    const isMixedStream = streamToRecord !== tabStream;
    console.log('[Offscreen] Recording stream:', {
      isMixedStream,
      streamId: streamToRecord.id,
      audioTracks: streamToRecord.getAudioTracks().map(t => ({
        id: t.id,
        label: t.label,
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
      })),
    });
    
    mediaRecorder = new MediaRecorder(streamToRecord, { mimeType: 'audio/webm;codecs=opus' });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log(`[Offscreen] Chunk: ${event.data.size} bytes, total: ${recordedChunks.length}`);
      }
    };

    mediaRecorder.onstop = () => {
      console.log('[Offscreen] MediaRecorder stopped, processing chunks...');

      if (recordedChunks.length === 0) {
        console.log('[Offscreen] No chunks recorded');
        return;
      }

      const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      console.log(`[Offscreen] Created audio blob: ${audioBlob.size} bytes`);

      window.open(URL.createObjectURL(audioBlob), '_blank');
      console.log('[Offscreen] Opened audio file in new tab');

      recordedChunks = [];
    };

    mediaRecorder.onerror = (event) => {
      console.error('[Offscreen] MediaRecorder error:', event);
    };

    mediaRecorder.start();
    console.log('[Offscreen] MediaRecorder started');

    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED' }).catch(console.error);
    window.location.hash = 'recording';

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

  // 停止錄製（會觸發 onstop 事件）
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

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

  mediaRecorder = null;
  window.location.hash = '';

  chrome.runtime.sendMessage({ type: 'CAPTURE_STOPPED' }).catch(console.error);
}

console.log('[Offscreen] Ready to receive capture commands');
