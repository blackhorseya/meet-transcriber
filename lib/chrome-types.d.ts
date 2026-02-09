/**
 * Chrome-specific API 型別宣告
 * 這些 API 不在標準的 browser namespace 中
 */

declare namespace chrome {
  namespace tabCapture {
    interface GetMediaStreamIdOptions {
      targetTabId?: number;
      consumerTabId?: number;
    }

    // Chrome 116+ 支援 Promise 版本
    function getMediaStreamId(options: GetMediaStreamIdOptions): Promise<string>;
  }

  namespace offscreen {
    enum Reason {
      USER_MEDIA = 'USER_MEDIA',
      AUDIO_PLAYBACK = 'AUDIO_PLAYBACK',
      BLOBS = 'BLOBS',
      CLIPBOARD = 'CLIPBOARD',
      DOM_PARSER = 'DOM_PARSER',
      DOM_SCRAPING = 'DOM_SCRAPING',
      GEOLOCATION = 'GEOLOCATION',
      IFRAME_SCRIPTING = 'IFRAME_SCRIPTING',
      LOCAL_STORAGE = 'LOCAL_STORAGE',
      MATCH_MEDIA = 'MATCH_MEDIA',
      WORKERS = 'WORKERS',
      TESTING = 'TESTING',
    }

    interface CreateParameters {
      url: string;
      reasons: Reason[];
      justification: string;
    }

    function createDocument(parameters: CreateParameters): Promise<void>;
    function closeDocument(): Promise<void>;
  }

  namespace runtime {
    interface ExtensionContext {
      contextType: ContextType;
      documentUrl?: string;
    }

    enum ContextType {
      TAB = 'TAB',
      POPUP = 'POPUP',
      BACKGROUND = 'BACKGROUND',
      OFFSCREEN_DOCUMENT = 'OFFSCREEN_DOCUMENT',
      SIDE_PANEL = 'SIDE_PANEL',
    }

    interface ContextFilter {
      contextTypes?: ContextType[];
    }

    function getContexts(filter: ContextFilter): Promise<ExtensionContext[]>;

    const lastError: { message?: string } | undefined;

    function sendMessage<T = unknown>(message: unknown): Promise<T>;

    interface MessageSender {
      id?: string;
      url?: string;
      tab?: { id?: number };
    }

    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
      removeListener(callback: (...args: unknown[]) => void): void;
    };
  }
}
