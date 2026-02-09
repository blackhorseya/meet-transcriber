/**
 * Groq Whisper API 轉錄模組
 *
 * 使用 Groq 的 whisper-large-v3-turbo 模型進行語音轉文字
 * 特點：速度極快（比 OpenAI 快約 10 倍），價格便宜
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// 過濾沒有語音的片段（0-1，越高越嚴格）
const NO_SPEECH_THRESHOLD = 0.5;

// 過濾低信心片段（avg_logprob，越接近 0 越有信心）
// -0.5 較嚴格，可能過濾真實語音；-1.0 較寬鬆，可能有幻覺
const AVG_LOGPROB_THRESHOLD = -0.5;

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export interface TranscriptionError {
  error: string;
  code?: string;
}

// Groq verbose_json 回傳格式
interface GroqSegment {
  text: string;
  start: number;
  end: number;
  no_speech_prob: number;
  avg_logprob: number;
}

interface GroqVerboseResponse {
  text: string;
  segments: GroqSegment[];
  duration: number;
}

/**
 * 將音訊 Blob 送到 Groq Whisper API 進行轉錄
 *
 * @param audioBlob - WebM 格式的音訊資料
 * @param apiKey - Groq API Key
 * @param language - 語言代碼（如 'zh', 'en', 'ja'）
 * @returns 轉錄結果或錯誤
 */
export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  language: string
): Promise<TranscriptionResult | TranscriptionError> {
  // 建立 FormData（Groq API 需要 multipart/form-data）
  const formData = new FormData();

  // Groq 需要有副檔名的檔案名稱
  const audioFile = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });
  formData.append('file', audioFile);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'verbose_json'); // 取得 no_speech_prob
  formData.append('temperature', '0'); // 確定性輸出

  // 如果指定語言，加入 language 參數（可提升準確度）
  if (language && language !== 'auto') {
    formData.append('language', language);
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Transcription] API error:', response.status, errorData);

      return {
        error: errorData.error?.message || `API 錯誤: ${response.status}`,
        code: errorData.error?.code || response.status.toString(),
      };
    }

    const result: GroqVerboseResponse = await response.json();
    console.log('[Transcription] API response:', JSON.stringify(result, null, 2));

    // 過濾掉沒有語音或低信心的片段
    const validSegments = (result.segments || []).filter((seg) => {
      const hasNoSpeech = seg.no_speech_prob > NO_SPEECH_THRESHOLD;
      const isLowConfidence = seg.avg_logprob < AVG_LOGPROB_THRESHOLD;

      if (hasNoSpeech || isLowConfidence) {
        console.log('[Transcription] Filtered segment:', {
          text: seg.text,
          reason: hasNoSpeech ? 'no_speech' : 'low_confidence',
          no_speech_prob: seg.no_speech_prob,
          avg_logprob: seg.avg_logprob.toFixed(3),
        });
        return false;
      }
      return true;
    });

    // 合併有效片段的文字
    const text = validSegments.map((seg) => seg.text).join('').trim();

    console.log('[Transcription] Processed:', {
      totalSegments: result.segments?.length || 0,
      validSegments: validSegments.length,
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
    });

    return {
      text,
      duration: result.duration,
    };
  } catch (err) {
    console.error('[Transcription] Network error:', err);
    return {
      error: err instanceof Error ? err.message : '網路錯誤',
      code: 'NETWORK_ERROR',
    };
  }
}

/**
 * 檢查轉錄結果是否為錯誤
 */
export function isTranscriptionError(
  result: TranscriptionResult | TranscriptionError
): result is TranscriptionError {
  return 'error' in result;
}
