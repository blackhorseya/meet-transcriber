import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Meet Transcriber',
    description: 'Google Meet 即時逐字稿，支援說話者辨識',
    minimum_chrome_version: '116', // tabCapture + offscreen 需要 Chrome 116+
    permissions: [
      'tabCapture',
      'offscreen',
      'storage',
      'activeTab',
    ],
    host_permissions: [
      'https://meet.google.com/*',
      'https://api.groq.com/*',
    ],
  },
});
