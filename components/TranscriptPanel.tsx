/**
 * TranscriptPanel - 逐字稿顯示面板
 * 浮動視窗，可拖曳移動位置
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { TranscriptEntry, OffscreenMessage } from '@/lib/message-types';

// ============================================
// Styles (inline to avoid CSS conflicts with Meet)
// ============================================

const styles = {
  container: {
    position: 'fixed' as const,
    width: '320px',
    maxHeight: 'calc(100vh - 120px)',
    backgroundColor: '#1e1e1e',
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    color: '#e0e0e0',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 9999,
  },
  header: {
    padding: '12px 16px',
    backgroundColor: '#2d2d2d',
    borderBottom: '1px solid #3d3d3d',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'grab',
    userSelect: 'none' as const,
  },
  headerDragging: {
    cursor: 'grabbing',
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: '#ffffff',
  },
  status: {
    fontSize: '12px',
    color: '#8ab4f8',
  },
  statusRecording: {
    color: '#f28b82',
  },
  transcriptList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px 16px',
  },
  transcriptItem: {
    marginBottom: '12px',
  },
  speakerName: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#8ab4f8',
    marginBottom: '2px',
  },
  transcriptText: {
    fontSize: '14px',
    lineHeight: 1.5,
    color: '#e0e0e0',
    wordBreak: 'break-word' as const,
  },
  timestamp: {
    fontSize: '11px',
    color: '#9aa0a6',
    marginLeft: '8px',
  },
  empty: {
    padding: '24px 16px',
    textAlign: 'center' as const,
    color: '#9aa0a6',
  },
  footer: {
    padding: '8px 16px',
    backgroundColor: '#2d2d2d',
    borderTop: '1px solid #3d3d3d',
    display: 'flex',
    gap: '8px',
  },
  button: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#3c4043',
    border: 'none',
    borderRadius: '6px',
    color: '#e0e0e0',
    fontSize: '12px',
    cursor: 'pointer',
  },
};

// ============================================
// Component
// ============================================

export function TranscriptPanel() {
  console.log('[TranscriptPanel] === COMPONENT MOUNTED ===');

  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [currentSpeaker, _setCurrentSpeaker] = useState('未知');
  const listRef = useRef<HTMLDivElement>(null);

  // 拖曳相關狀態
  const [position, setPosition] = useState({ top: 60, right: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, top: 0, right: 0 });

  // 拖曳事件處理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      top: position.top,
      right: position.right,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = dragStart.current.x - e.clientX;
      const deltaY = e.clientY - dragStart.current.y;
      
      const newRight = Math.max(0, dragStart.current.right + deltaX);
      const newTop = Math.max(0, dragStart.current.top + deltaY);
      
      setPosition({ top: newTop, right: newRight });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 自動捲動到最新內容
  const scrollToBottom = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, []);

  // 監聽來自 background 的訊息
  useEffect(() => {
    console.log('[TranscriptPanel] Setting up message listener...');

    const handleMessage = (message: OffscreenMessage) => {
      console.log('[TranscriptPanel] Received message:', message.type);

      switch (message.type) {
        case 'CAPTURE_STARTED':
          setIsCapturing(true);
          break;

        case 'CAPTURE_STOPPED':
          setIsCapturing(false);
          break;

        case 'TRANSCRIPT_RESULT':
          const entry: TranscriptEntry = {
            id: `${message.timestamp}-${message.sequenceNumber}`,
            speaker: currentSpeaker,
            text: message.text,
            timestamp: message.timestamp,
            sequenceNumber: message.sequenceNumber,
          };
          setTranscripts((prev) => {
            const updated = [...prev, entry].sort(
              (a, b) => a.sequenceNumber - b.sequenceNumber
            );
            return updated;
          });
          break;

        case 'CAPTURE_ERROR':
          console.error('[TranscriptPanel] Capture error:', message.error);
          setIsCapturing(false);
          break;
      }
    };

    try {
      browser.runtime.onMessage.addListener(handleMessage);
      console.log('[TranscriptPanel] Message listener added successfully');
    } catch (err) {
      console.error('[TranscriptPanel] Failed to add message listener:', err);
    }
    return () => {
      try {
        browser.runtime.onMessage.removeListener(handleMessage);
      } catch (err) {
        console.error('[TranscriptPanel] Failed to remove message listener:', err);
      }
    };
  }, [currentSpeaker]);

  // 新增 transcript 時自動捲動
  useEffect(() => {
    scrollToBottom();
  }, [transcripts, scrollToBottom]);

  // 匯出功能
  const handleExport = (format: 'txt' | 'md') => {
    const content = transcripts
      .map((t) => {
        const time = new Date(t.timestamp).toLocaleTimeString('zh-TW');
        if (format === 'md') {
          return `**[${t.speaker}]** (${time})\n${t.text}\n`;
        }
        return `[${t.speaker}] (${time}) ${t.text}`;
      })
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meet-transcript-${new Date().toISOString().split('T')[0]}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 清除功能
  const handleClear = () => {
    setTranscripts([]);
  };

  // 格式化時間
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // 合併相同 speaker 的連續發言
  const groupedTranscripts = transcripts.reduce<TranscriptEntry[]>((acc, curr) => {
    const last = acc[acc.length - 1];
    if (last && last.speaker === curr.speaker) {
      last.text += ' ' + curr.text;
    } else {
      acc.push({ ...curr });
    }
    return acc;
  }, []);

  return (
    <div
      style={{
        ...styles.container,
        top: `${position.top}px`,
        right: `${position.right}px`,
      }}
    >
      <div
        style={{
          ...styles.header,
          ...(isDragging ? styles.headerDragging : {}),
        }}
        onMouseDown={handleMouseDown}
      >
        <h3 style={styles.title}>逐字稿</h3>
        <span
          style={{
            ...styles.status,
            ...(isCapturing ? styles.statusRecording : {}),
          }}
        >
          {isCapturing ? '● 錄製中' : '○ 已停止'}
        </span>
      </div>

      <div style={styles.transcriptList} ref={listRef}>
        {groupedTranscripts.length === 0 ? (
          <div style={styles.empty}>
            {isCapturing
              ? '等待語音輸入...'
              : '點擊 Extension 圖示開始錄製'}
          </div>
        ) : (
          groupedTranscripts.map((entry) => (
            <div key={entry.id} style={styles.transcriptItem}>
              <div style={styles.speakerName}>
                {entry.speaker}
                <span style={styles.timestamp}>{formatTime(entry.timestamp)}</span>
              </div>
              <div style={styles.transcriptText}>{entry.text}</div>
            </div>
          ))
        )}
      </div>

      {transcripts.length > 0 && (
        <div style={styles.footer}>
          <button style={styles.button} onClick={() => handleExport('txt')}>
            匯出 TXT
          </button>
          <button style={styles.button} onClick={() => handleExport('md')}>
            匯出 MD
          </button>
          <button style={styles.button} onClick={handleClear}>
            清除
          </button>
        </div>
      )}
    </div>
  );
}
