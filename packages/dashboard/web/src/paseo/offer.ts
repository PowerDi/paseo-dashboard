import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@getpaseo/protocol/connection-offer";
import { shouldUseTlsForDefaultHostedRelay } from "@getpaseo/protocol/daemon-endpoints";
import type { HostConnection } from "@getpaseo/dashboard-shared";

export interface NormalizedOffer {
  offer: ConnectionOffer;
  connection: HostConnection;
}

export function parseAndNormalizeOffer(input: string): NormalizedOffer {
  const offer = parseConnectionOfferFromUrl(input);
  if (!offer) {
    throw new Error("未找到 #offer= pairing fragment");
  }

  return {
    offer,
    connection: {
      type: "relay",
      serverId: offer.serverId,
      relayEndpoint: offer.relay.endpoint,
      useTls: offer.relay.useTls ?? shouldUseTlsForDefaultHostedRelay(offer.relay.endpoint),
      daemonPublicKeyB64: offer.daemonPublicKeyB64,
    },
  };
}

export function clearOfferFragmentFromLocation(): void {
  if (globalThis.location?.hash?.startsWith("#offer=")) {
    globalThis.history.replaceState(
      null,
      globalThis.document?.title ?? "",
      globalThis.location.pathname,
    );
  }
}
