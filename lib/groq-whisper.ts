/**
 * Groq Whisper API 封裝
 * 使用 whisper-large-v3 模型進行語音轉文字
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

export interface TranscriptionResult {
  text: string;
  success: true;
  noSpeechProb?: number; // 最高的 no_speech_prob，用於判斷是否為靜音
}

export interface TranscriptionError {
  error: string;
  success: false;
  isRetryable: boolean;
}

export type TranscriptionResponse = TranscriptionResult | TranscriptionError;

// Groq Whisper verbose_json 回應格式
interface WhisperSegment {
  text: string;
  start: number;
  end: number;
  no_speech_prob: number;
}

interface WhisperVerboseResponse {
  text: string;
  segments: WhisperSegment[];
}

/**
 * 將音訊 Blob 送到 Groq Whisper API 進行轉錄
 */
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  language: string = 'zh'
): Promise<TranscriptionResponse> {
  let lastError: string = '';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', language);
      formData.append('response_format', 'verbose_json');

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (response.ok) {
        const data: WhisperVerboseResponse = await response.json();

        // 計算最高的 no_speech_prob
        const maxNoSpeechProb = data.segments?.length > 0
          ? Math.max(...data.segments.map(s => s.no_speech_prob))
          : 0;

        return {
          text: data.text?.trim() || '',
          success: true,
          noSpeechProb: maxNoSpeechProb,
        };
      }

      // 處理錯誤回應
      const status = response.status;

      if (status === 401) {
        return {
          error: 'API Key 無效，請檢查設定',
          success: false,
          isRetryable: false,
        };
      }

      if (status === 429) {
        // Rate limit - retry with exponential backoff
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(`Rate limited, retrying in ${delay}ms...`);
        await sleep(delay);
        lastError = 'API 請求過於頻繁';
        continue;
      }

      if (status >= 500) {
        // Server error - retry
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        await sleep(delay);
        lastError = `伺服器錯誤 (${status})`;
        continue;
      }

      // Other client errors - don't retry
      const errorBody = await response.text().catch(() => '');
      return {
        error: `API 錯誤 (${status}): ${errorBody || response.statusText}`,
        success: false,
        isRetryable: false,
      };
    } catch (err) {
      // Network error - retry
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
      await sleep(delay);
      lastError = err instanceof Error ? err.message : '網路錯誤';
    }
  }

  return {
    error: `轉錄失敗：${lastError}`,
    success: false,
    isRetryable: true,
  };
}

/**
 * 驗證 API Key 是否有效
 * 透過發送一個極短的靜音檔案來測試
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey || apiKey.trim().length === 0) {
    return false;
  }

  // 建立一個極短的靜音 WebM 檔案來測試 API
  // 這裡我們只檢查 API Key 格式和連線
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: new FormData(), // Empty form will fail but with 400, not 401
    });

    // 如果是 401，表示 API Key 無效
    // 如果是其他錯誤（如 400 缺少檔案），表示 API Key 有效
    return response.status !== 401;
  } catch {
    // 網路錯誤，無法驗證
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
