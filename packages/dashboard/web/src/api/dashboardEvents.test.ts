import { describe, expect, it, vi } from "vitest";
import type { ConfigEvent } from "@getpaseo/dashboard-shared";
import {
  DashboardEventsUnauthorizedError,
  SseParser,
  createConfigEventStream,
} from "./dashboardEvents";

function configEvent(revision: number): ConfigEvent {
  return {
    type: "host.upserted",
    revision,
    timestamp: "2026-08-12T00:00:00.000Z",
    data: { hostId: `host-${revision}` },
  };
}

describe("SseParser", () => {
  it("keeps fields across arbitrary chunk boundaries", () => {
    const parser = new SseParser();

    expect(parser.push('event: config\ndata: {"type":"host.')).toEqual([]);
    expect(parser.push('upserted"}\n')).toEqual([]);
    expect(parser.push("data: second-line\r")).toEqual([]);
    expect(parser.push("\n\n")).toEqual([
      { event: "config", data: '{"type":"host.upserted"}\nsecond-line' },
    ]);
  });

  it("ignores comments and dispatches data only at an event separator", () => {
    const parser = new SseParser();
    expect(parser.push(': connected\n\ndata: {"ok":true}\n')).toEqual([]);
    expect(parser.finish()).toEqual([{ data: '{"ok":true}' }]);
  });
});

describe("createConfigEventStream", () => {
  it("sends the bearer token and can be closed through unsubscribe", async () => {
    let unblock!: () => void;
    const pending = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const cancel = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async (_input) => {
      await pending;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(configEvent(7))}\n\n`),
          );
        },
        cancel,
      });
      return new Response(body, { status: 200 });
    });
    const onEvent = vi.fn();
    const onClose = vi.fn();

    const subscription = createConfigEventStream({
      accessToken: "access-token",
      fetch: fetchMock,
      onEvent,
      onClose,
    });
    unblock();
    await subscription.ready;
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(configEvent(7)));

    subscription.unsubscribe();
    subscription.close();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers;
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("reports 401 and rejects ready without starting an event stream", async () => {
    const unauthorized = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    const subscription = createConfigEventStream({
      fetch: fetchMock,
      onEvent: vi.fn(),
      onUnauthorized: unauthorized,
    });

    await expect(subscription.ready).rejects.toBeInstanceOf(DashboardEventsUnauthorizedError);
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
