import { describe, it, expect } from "vitest";
import {
  parseAndNormalizeOffer,
  clearOfferFragmentFromLocation,
} from "../../../web/src/paseo/offer";

function encodeOfferUrl(offer: object): string {
  const json = JSON.stringify(offer);
  const base64 = Buffer.from(json, "utf8").toString("base64url");
  return `https://app.paseo.sh/#offer=${base64}`;
}

describe("Pairing offer parser", () => {
  const validOfferUrl = encodeOfferUrl({
    v: 2,
    serverId: "srv_test",
    daemonPublicKeyB64: "ZHVtbXlwdWJrZXk=",
    relay: { endpoint: "relay.paseo.sh:443", useTls: true },
  });

  it("parses v=2 relay offer and normalizes to HostConnection", () => {
    const result = parseAndNormalizeOffer(validOfferUrl);

    expect(result.offer.v).toBe(2);
    expect(result.offer.serverId).toBe("srv_test");
    expect(result.offer.daemonPublicKeyB64).toBe("ZHVtbXlwdWJrZXk=");
    expect(result.offer.relay.endpoint).toBe("relay.paseo.sh:443");
    expect(result.offer.relay.useTls).toBe(true);

    expect(result.connection).toEqual({
      type: "relay",
      serverId: "srv_test",
      relayEndpoint: "relay.paseo.sh:443",
      useTls: true,
      daemonPublicKeyB64: "ZHVtbXlwdWJrZXk=",
    });
  });

  it("rejects URL without #offer= fragment", () => {
    expect(() => parseAndNormalizeOffer("https://app.paseo.sh/")).toThrow(
      "未找到 #offer= pairing fragment",
    );
  });

  it("clears fragment by calling replaceState with pathname only", () => {
    const mockLocation = {
      hash: "#offer=abc",
      pathname: "/hosts",
      href: "https://app.paseo.sh/hosts#offer=abc",
    };
    const calls: unknown[][] = [];
    const mockHistory = { replaceState: (...args: unknown[]) => calls.push(args) };
    // @ts-expect-error - test mock
    globalThis.location = mockLocation;
    // @ts-expect-error - test mock
    globalThis.history = mockHistory;

    clearOfferFragmentFromLocation();

    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe("/hosts");
  });
});
