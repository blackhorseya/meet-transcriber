/**
 * Extension 內部訊息型別定義
 * MV3 架構：popup ↔ background ↔ offscreen → content script
 */

// ============================================
// Popup → Background 訊息
// ============================================

export interface StartCaptureRequest {
  type: 'START_CAPTURE_REQUEST';
}

export interface StopCaptureRequest {
  type: 'STOP_CAPTURE_REQUEST';
}

export interface GetStatusRequest {
  type: 'GET_STATUS_REQUEST';
}

// ============================================
// Background → Offscreen 訊息
// ============================================

export interface StartCapture {
  type: 'START_CAPTURE';
  streamId: string;
  language: string;
  apiKey: string;
  chunkDuration: number;
  includeMicrophone: boolean; // 是否同時錄製麥克風
  microphoneDeviceLabel: string; // 麥克風設備名稱
}

export interface StopCapture {
  type: 'STOP_CAPTURE';
}

// ============================================
// Offscreen → Background 訊息
// ============================================

export interface TranscriptResult {
  type: 'TRANSCRIPT_RESULT';
  text: string;
  timestamp: number;
  sequenceNumber: number;
  isFinal: boolean;
}

export interface CaptureStarted {
  type: 'CAPTURE_STARTED';
}

export interface CaptureStopped {
  type: 'CAPTURE_STOPPED';
}

export interface CaptureError {
  type: 'CAPTURE_ERROR';
  error: string;
}

// ============================================
// 狀態回應
// ============================================

export interface StatusResponse {
  type: 'STATUS_RESPONSE';
  isCapturing: boolean;
  error?: string;
}

// ============================================
// Union Types
// ============================================

export type PopupMessage =
  | StartCaptureRequest
  | StopCaptureRequest
  | GetStatusRequest;

export type BackgroundToOffscreenMessage =
  | StartCapture
  | StopCapture;

export type OffscreenMessage =
  | TranscriptResult
  | CaptureStarted
  | CaptureStopped
  | CaptureError;

export type Message =
  | PopupMessage
  | BackgroundToOffscreenMessage
  | OffscreenMessage
  | StatusResponse;

// ============================================
// 逐字稿資料結構
// ============================================

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  sequenceNumber: number;
}

// ============================================
// Type Guards
// ============================================

export function isTranscriptResult(msg: Message): msg is TranscriptResult {
  return msg.type === 'TRANSCRIPT_RESULT';
}

export function isCaptureError(msg: Message): msg is CaptureError {
  return msg.type === 'CAPTURE_ERROR';
}
