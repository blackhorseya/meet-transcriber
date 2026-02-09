/**
 * Popup UI
 * API Key 設定 + 開始/停止錄製 + 語言選擇
 *
 * MV3 架構：tabCapture 不需要額外的權限請求
 */

import { useState, useEffect } from 'react';
import { getSettings, updateSettings, type ExtensionSettings } from '@/lib/storage';
import type { StatusResponse } from '@/lib/message-types';
import './App.css';

// 支援的語言選項
const LANGUAGES = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
];

// 麥克風設備資訊
interface MicDevice {
  label: string;
  deviceId: string;
}

function App() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);

  // 載入設定和狀態
  useEffect(() => {
    const init = async () => {
      const savedSettings = await getSettings();
      setSettings(savedSettings);

      // 取得目前錄製狀態
      try {
        const response = await browser.runtime.sendMessage({
          type: 'GET_STATUS_REQUEST',
        }) as StatusResponse;
        setIsCapturing(response.isCapturing);
      } catch {
        // Ignore errors when getting status
      }

      // 列舉可用的麥克風設備
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices
          .filter(d => d.kind === 'audioinput' && d.label)
          .map(d => ({ label: d.label, deviceId: d.deviceId }));
        setMicDevices(mics);
        console.log('[Popup] Found microphones:', mics.length);
      } catch (err) {
        console.warn('[Popup] Failed to enumerate devices:', err);
      }
    };
    init();
  }, []);

  // 更新單一設定值
  const handleSettingChange = async <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K]
  ) => {
    if (!settings) return;

    const updated = { ...settings, [key]: value };
    setSettings(updated);
    await updateSettings({ [key]: value });
  };

  // 開始/停止錄製
  const toggleCapture = async () => {
    setError(null);
    setLoading(true);

    try {
      if (!settings?.groqApiKey) {
        setError('請先設定 Groq API Key');
        setLoading(false);
        return;
      }

      const messageType = isCapturing ? 'STOP_CAPTURE_REQUEST' : 'START_CAPTURE_REQUEST';
      const response = await browser.runtime.sendMessage({
        type: messageType,
      }) as StatusResponse;

      setIsCapturing(response.isCapturing);

      if (response.error) {
        setError(response.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '發生錯誤');
    } finally {
      setLoading(false);
    }
  };

  if (!settings) {
    return <div className="popup loading">載入中...</div>;
  }

  return (
    <div className="popup">
      <header className="header">
        <h1 className="title">Meet Transcriber</h1>
        <span className={`status ${isCapturing ? 'recording' : ''}`}>
          {isCapturing ? '● 錄製中' : '○ 已停止'}
        </span>
      </header>

      <main className="main">
        {/* API Key 設定 */}
        <section className="section">
          <label className="label">Groq API Key</label>
          <div className="input-group">
            <input
              type={showApiKey ? 'text' : 'password'}
              className="input"
              placeholder="gsk_xxxxxxxx..."
              value={settings.groqApiKey}
              onChange={(e) => handleSettingChange('groqApiKey', e.target.value)}
            />
            <button
              className="icon-button"
              onClick={() => setShowApiKey(!showApiKey)}
              title={showApiKey ? '隱藏' : '顯示'}
            >
              {showApiKey ? '🙈' : '👁️'}
            </button>
          </div>
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            取得 API Key →
          </a>
        </section>

        {/* 語言選擇 */}
        <section className="section">
          <label className="label">轉錄語言</label>
          <select
            className="select"
            value={settings.language}
            onChange={(e) => handleSettingChange('language', e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </section>

        {/* 麥克風設定 */}
        <section className="section">
          <label className="label checkbox-label">
            <input
              type="checkbox"
              checked={settings.includeMicrophone}
              onChange={(e) => handleSettingChange('includeMicrophone', e.target.checked)}
            />
            <span>錄製我的聲音（麥克風）</span>
          </label>
          
          {/* 麥克風設備選擇 - 只在啟用麥克風時顯示 */}
          {settings.includeMicrophone && micDevices.length > 0 && (
            <select
              className="select"
              value={settings.microphoneDeviceLabel}
              onChange={(e) => handleSettingChange('microphoneDeviceLabel', e.target.value)}
            >
              <option value="">預設麥克風</option>
              {micDevices.map((mic) => (
                <option key={mic.deviceId} value={mic.label}>
                  {mic.label}
                </option>
              ))}
            </select>
          )}
          
          <p className="hint">
            開啟後會同時錄製你的聲音和對方的聲音
          </p>
        </section>

        {/* 錯誤訊息 */}
        {error && <div className="error">{error}</div>}

        {/* 開始/停止按鈕 */}
        <button
          className={`button ${isCapturing ? 'stop' : 'start'}`}
          onClick={toggleCapture}
          disabled={loading}
        >
          {loading ? '處理中...' : isCapturing ? '停止錄製' : '開始錄製'}
        </button>
      </main>

      <footer className="footer">
        <span>請在 Google Meet 頁面使用</span>
      </footer>
    </div>
  );
}

export default App;
