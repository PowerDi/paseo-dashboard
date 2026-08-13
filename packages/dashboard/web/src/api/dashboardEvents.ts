import type { ConfigEvent } from "@getpaseo/dashboard-shared";

export interface SseMessage {
  event?: string;
  id?: string;
  data: string;
  retry?: number;
}

/**
 * Incremental parser for the SSE wire format.
 *
 * A ReadableStream chunk is not a line or event boundary. Keep the incomplete
 * suffix between calls and dispatch an event only after the blank separator.
 */
export class SseParser {
  private buffer = "";
  private dataLines: string[] = [];
  private eventName: string | undefined;
  private eventId: string | undefined;
  private retry: number | undefined;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];

    for (;;) {
      const lineEnd = findLineEnd(this.buffer);
      if (lineEnd === -1) break;
      // A CR at the end of a chunk may be the first half of CRLF. Keep it
      // until the next chunk so it cannot become a spurious empty line.
      if (this.buffer[lineEnd] === "\r" && lineEnd + 1 === this.buffer.length) break;

      const { line, nextOffset } = lineAt(this.buffer, lineEnd);
      this.buffer = this.buffer.slice(nextOffset);
      const message = this.consumeLine(line);
      if (message) messages.push(message);
    }

    return messages;
  }

  /** Dispatch a final event when a stream ends without a trailing blank line. */
  finish(): SseMessage[] {
    const messages: SseMessage[] = [];
    if (this.buffer.length > 0) {
      const message = this.consumeLine(this.buffer.replace(/\r$/, ""));
      this.buffer = "";
      if (message) messages.push(message);
    }

    const message = this.dispatch();
    if (message) messages.push(message);
    return messages;
  }

  private consumeLine(line: string): SseMessage | undefined {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return undefined;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        this.eventName = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        // The server does not currently send ids. Preserve the SSE rule that
        // an id containing a NUL is ignored rather than exposed to callers.
        if (!value.includes("\u0000")) this.eventId = value;
        break;
      case "retry": {
        const retry = Number.parseInt(value, 10);
        if (Number.isInteger(retry) && retry >= 0) this.retry = retry;
        break;
      }
      default:
        break;
    }

    return undefined;
  }

  private dispatch(): SseMessage | undefined {
    if (this.dataLines.length === 0) {
      this.eventName = undefined;
      this.eventId = undefined;
      this.retry = undefined;
      return undefined;
    }

    const message: SseMessage = {
      data: this.dataLines.join("\n"),
      ...(this.eventName !== undefined ? { event: this.eventName } : {}),
      ...(this.eventId !== undefined ? { id: this.eventId } : {}),
      ...(this.retry !== undefined ? { retry: this.retry } : {}),
    };

    this.dataLines = [];
    this.eventName = undefined;
    this.eventId = undefined;
    this.retry = undefined;
    return message;
  }
}

export interface ConfigEventStreamOptions {
  /** Defaults to `/api/v1/events`. */
  url?: string;
  accessToken?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  onEvent: (event: ConfigEvent) => void;
  onError?: (error: unknown) => void;
  onUnauthorized?: (error: DashboardEventsUnauthorizedError) => void;
  onClose?: () => void;
  signal?: AbortSignal;
}

export interface ConfigEventSubscription {
  /** Resolves after the HTTP stream has returned a successful response. */
  readonly ready: Promise<void>;
  close: () => void;
  /** Alias for close(), convenient for store subscriptions. */
  unsubscribe: () => void;
}

export class DashboardEventsUnauthorizedError extends Error {
  readonly status = 401;

  constructor() {
    super("Dashboard events request failed: 401");
    this.name = "DashboardEventsUnauthorizedError";
  }
}

/**
 * Open the authenticated Dashboard configuration event stream.
 *
 * This stream carries notifications only. Callers should use the event's
 * revision to trigger host-sync polling; daemon data never passes through it.
 * There is no implicit reconnect loop: close the subscription and create a new
 * one when the login/session lifecycle says it is appropriate.
 */
export function createConfigEventStream(
  options: ConfigEventStreamOptions,
): ConfigEventSubscription {
  const controller = new AbortController();
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = options.url ?? "/api/v1/events";
  let closed = false;
  let settled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closeNotified = false;

  let resolveReady!: () => void;
  let rejectReady!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const notifyClose = () => {
    if (closeNotified) return;
    closeNotified = true;
    options.onClose?.();
  };

  const notifyError = (error: unknown) => {
    if (!closed) options.onError?.(error);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (!settled) {
      settled = true;
      resolveReady();
    }
    controller.abort();
    void reader?.cancel();
    notifyClose();
  };

  if (options.signal) {
    if (options.signal.aborted) close();
    else options.signal.addEventListener("abort", close, { once: true });
  }

  const run = async () => {
    try {
      const headers = new Headers({ Accept: "text/event-stream" });
      if (options.accessToken) headers.set("Authorization", `Bearer ${options.accessToken}`);

      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        credentials: options.credentials ?? "include",
        signal: controller.signal,
      });

      if (response.status === 401) {
        const error = new DashboardEventsUnauthorizedError();
        options.onUnauthorized?.(error);
        throw error;
      }
      if (!response.ok) throw new Error(`Dashboard events request failed: ${response.status}`);
      if (closed) return;
      if (!response.body) throw new Error("Dashboard events response has no body");

      settled = true;
      resolveReady();
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();

      while (!closed) {
        const result = await reader.read();
        if (result.done) break;
        for (const message of parser.push(decoder.decode(result.value, { stream: true }))) {
          dispatchConfigMessage(message, options, notifyError);
        }
      }

      if (!closed) {
        for (const message of parser.push(decoder.decode())) {
          dispatchConfigMessage(message, options, notifyError);
        }
        for (const message of parser.finish()) {
          dispatchConfigMessage(message, options, notifyError);
        }
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        if (closed && error instanceof DOMException && error.name === "AbortError") resolveReady();
        else rejectReady(error);
      }
      if (!(closed && isAbortError(error))) notifyError(error);
    } finally {
      reader?.releaseLock();
      reader = undefined;
      if (options.signal) options.signal.removeEventListener("abort", close);
      notifyClose();
    }
  };

  void run();
  return { ready, close, unsubscribe: close };
}

function dispatchConfigMessage(
  message: SseMessage,
  options: ConfigEventStreamOptions,
  onError: (error: unknown) => void,
): void {
  try {
    options.onEvent(JSON.parse(message.data) as ConfigEvent);
  } catch (error) {
    onError(new Error("Invalid Dashboard config event", { cause: error }));
  }
}

function findLineEnd(value: string): number {
  const lf = value.indexOf("\n");
  const cr = value.indexOf("\r");
  if (lf === -1) return cr;
  if (cr === -1) return lf;
  return Math.min(lf, cr);
}

function lineAt(value: string, end: number): { line: string; nextOffset: number } {
  if (value[end] === "\r" && value[end + 1] === "\n") {
    return { line: value.slice(0, end), nextOffset: end + 2 };
  }
  return { line: value.slice(0, end), nextOffset: end + 1 };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
