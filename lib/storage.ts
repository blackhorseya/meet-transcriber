/**
 * chrome.storage.local 的 type-safe 封裝
 */

// Lazy getter for storage API (在 offscreen document 中需要延遲取得)
function getStorage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const api = g.chrome?.storage?.local ?? g.browser?.storage?.local;
  if (!api) {
    throw new Error('Storage API not available');
  }
  return api;
}

// ============================================
// 設定結構定義
// ============================================

export interface ExtensionSettings {
  groqApiKey: string;
  language: string;
  chunkDuration: number;
  autoStart: boolean;
  includeMicrophone: boolean; // 是否同時錄製麥克風（自己的聲音）
  microphoneDeviceLabel: string; // 麥克風設備名稱（用於跨 origin 匹配）
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  groqApiKey: '',
  language: 'zh',
  chunkDuration: 3000,
  autoStart: false,
  includeMicrophone: true, // 預設開啟，錄製自己+對方聲音
  microphoneDeviceLabel: '', // 空字串表示使用預設設備
};

// ============================================
// Storage API
// ============================================

/**
 * 取得所有設定
 */
export async function getSettings(): Promise<ExtensionSettings> {
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof ExtensionSettings>;
  const result = await getStorage().get(keys);

  // 合併預設值
  return {
    ...DEFAULT_SETTINGS,
    ...result,
  } as ExtensionSettings;
}

/**
 * 更新部分設定
 */
export async function updateSettings(
  partial: Partial<ExtensionSettings>
): Promise<void> {
  await getStorage().set(partial);
}

/**
 * 取得單一設定值
 */
export async function getSetting<K extends keyof ExtensionSettings>(
  key: K
): Promise<ExtensionSettings[K]> {
  const result = await getStorage().get(key);
  return (result[key] ?? DEFAULT_SETTINGS[key]) as ExtensionSettings[K];
}

/**
 * 設定單一值
 */
export async function setSetting<K extends keyof ExtensionSettings>(
  key: K,
  value: ExtensionSettings[K]
): Promise<void> {
  await getStorage().set({ [key]: value });
}

// ============================================
// Convenience Functions
// ============================================

/**
 * 取得 Groq API Key
 */
export async function getApiKey(): Promise<string> {
  return getSetting('groqApiKey');
}

/**
 * 設定 Groq API Key
 */
export async function setApiKey(key: string): Promise<void> {
  return setSetting('groqApiKey', key);
}

/**
 * 檢查 API Key 是否已設定
 */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return key.length > 0;
}

/**
 * 取得語言設定
 */
export async function getLanguage(): Promise<string> {
  return getSetting('language');
}

/**
 * 監聽設定變化
 */
export function onSettingsChange(
  callback: (changes: Partial<ExtensionSettings>) => void
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const storageApi = g.chrome?.storage ?? g.browser?.storage;
  if (!storageApi) {
    console.warn('Storage API not available for change listener');
    return () => {};
  }

  const listener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;

    const settingChanges: Partial<ExtensionSettings> = {};
    for (const key of Object.keys(changes) as Array<keyof ExtensionSettings>) {
      if (key in DEFAULT_SETTINGS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (settingChanges as any)[key] = changes[key].newValue;
      }
    }

    if (Object.keys(settingChanges).length > 0) {
      callback(settingChanges);
    }
  };

  storageApi.onChanged.addListener(listener);
  return () => storageApi.onChanged.removeListener(listener);
}
