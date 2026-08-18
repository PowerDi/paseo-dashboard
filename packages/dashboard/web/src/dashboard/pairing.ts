import type {
  ClientVerification,
  Host,
  HostConnection,
  HostImportRequest,
} from "@getpaseo/dashboard-shared";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@getpaseo/protocol/connection-offer";
import { shouldUseTlsForDefaultHostedRelay } from "@getpaseo/protocol/daemon-endpoints";
import type { DashboardSessionStore } from "./session-store";

export interface NormalizedDashboardOffer {
  offer: ConnectionOffer;
  connection: HostConnection;
}

export interface DashboardPairingVerification extends ClientVerification {}

export interface DashboardPairingInput {
  pairingLink: string;
  label?: string;
  idempotencyKey?: string;
}

export type DashboardPairingVerifier = (
  normalizedOffer: NormalizedDashboardOffer,
) => Promise<DashboardPairingVerification>;

export function parseDashboardPairingLink(input: string): NormalizedDashboardOffer {
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

export function buildDashboardHostImport(input: {
  normalizedOffer: NormalizedDashboardOffer;
  verification: DashboardPairingVerification;
  label?: string;
  idempotencyKey?: string;
}): HostImportRequest {
  return {
    label: input.label?.trim() || input.normalizedOffer.offer.serverId,
    connection: input.normalizedOffer.connection,
    clientVerification: input.verification,
    idempotencyKey: input.idempotencyKey ?? createDashboardIdempotencyKey(),
  };
}

export async function pairDashboardHost(input: {
  session: DashboardSessionStore;
  pairing: DashboardPairingInput;
  verify: DashboardPairingVerifier;
}): Promise<Host> {
  const normalizedOffer = parseDashboardPairingLink(input.pairing.pairingLink);
  const verification = await input.verify(normalizedOffer);
  const request = buildDashboardHostImport({
    normalizedOffer,
    verification,
    label: input.pairing.label,
    idempotencyKey: input.pairing.idempotencyKey,
  });
  return input.session.importHost(request);
}

export function createDashboardIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `pair-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
