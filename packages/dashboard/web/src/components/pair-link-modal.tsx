import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Link } from "lucide-react-native";
import type { HostProfile } from "@/types/host-connection";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { dashboardHostToProfile } from "@/runtime/dashboard-host-profile";
import {
  pairDashboardHost,
  parseDashboardPairingLink,
  useDashboardSessionStore,
} from "@/dashboard";
import { normalizeHostPort } from "@/utils/daemon-endpoints";
import { connectToDaemon } from "@/utils/test-daemon-connection";
import { AdaptiveModalSheet, AdaptiveTextInput, type SheetHeader } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

const FLEX_ONE_STYLE = { flex: 1 } as const;

const styles = StyleSheet.create((theme) => ({
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
}));

export interface PairLinkModalProps {
  visible: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onSaved?: (result: {
    profile: HostProfile;
    serverId: string;
    hostname: string | null;
    isNewHost: boolean;
  }) => void;
}

export function PairLinkModal({ visible, onClose, onCancel, onSaved }: PairLinkModalProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const dashboardSession = useDashboardSessionStore();
  const runtime = getHostRuntimeStore();
  const isMobile = useIsCompactFormFactor();

  const offerUrlRef = useRef("");
  const inputRef = useRef<TextInput>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const clearInput = useCallback(() => {
    offerUrlRef.current = "";
    inputRef.current?.clear();
  }, []);

  const pairIcon = useMemo(
    () => <Link size={16} color={theme.colors.accentForeground} />,
    [theme.colors.accentForeground],
  );

  const handleClose = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    onClose();
  }, [isSaving, clearInput, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    clearInput();
    setErrorMessage("");
    (onCancel ?? onClose)();
  }, [isSaving, clearInput, onCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const raw = offerUrlRef.current.trim();
    if (!raw) {
      setErrorMessage(t("pairing.link.errors.required"));
      return;
    }
    if (!raw.includes("#offer=")) {
      setErrorMessage(t("pairing.link.errors.missingOffer"));
      return;
    }

    const normalizedOffer = (() => {
      try {
        return parseDashboardPairingLink(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("pairing.link.errors.invalid");
        setErrorMessage(message);
        if (!isMobile) {
          Alert.alert(t("pairing.link.alert.failedTitle"), message);
        }
        return null;
      }
    })();

    if (!normalizedOffer) {
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { client, hostname, serverId } = await connectToDaemon(
        {
          id: "probe",
          type: "relay",
          relayEndpoint: normalizeHostPort(normalizedOffer.connection.relayEndpoint),
          useTls: normalizedOffer.connection.useTls,
          daemonPublicKeyB64: normalizedOffer.connection.daemonPublicKeyB64,
        },
        { serverId: normalizedOffer.connection.serverId },
      );
      const serverVersion = client.getLastServerInfoMessage()?.version ?? "unknown";
      await client.close().catch(() => undefined);

      if (serverId !== normalizedOffer.connection.serverId) {
        throw new Error("Pairing Host identity did not match the offer");
      }

      const previousHosts = dashboardSession.getSnapshot().hosts;
      const isNewHost = !previousHosts.some(
        (host) => host.connection.serverId === normalizedOffer.connection.serverId,
      );
      const host = await pairDashboardHost({
        session: dashboardSession,
        pairing: { pairingLink: raw, label: hostname ?? undefined },
        verify: async () => ({
          verifiedAt: new Date().toISOString(),
          serverVersion,
        }),
      });
      const currentByServerId = new Map(
        runtime.getHosts().map((candidate) => [candidate.serverId, candidate]),
      );
      const accountProfiles = dashboardSession
        .getSnapshot()
        .hosts.map((accountHost) =>
          dashboardHostToProfile(
            accountHost,
            currentByServerId.get(accountHost.connection.serverId),
          ),
        );
      runtime.replaceDashboardAccountHosts(accountProfiles);
      const profile = accountProfiles.find(
        (candidate) => candidate.serverId === host.connection.serverId,
      );
      if (!profile) {
        throw new Error("Imported Host was not returned by the Dashboard account");
      }
      onSaved?.({ profile, serverId: host.connection.serverId, hostname, isNewHost });
      clearInput();
      setErrorMessage("");
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("pairing.link.errors.unableToPair");
      setErrorMessage(message);
      if (!isMobile) {
        Alert.alert(t("pairing.link.alert.failedTitle"), message);
      }
    } finally {
      setIsSaving(false);
    }
  }, [clearInput, dashboardSession, isMobile, isSaving, onClose, onSaved, runtime, t]);

  const handleChangeOfferUrl = useCallback((next: string) => {
    offerUrlRef.current = next;
  }, []);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.link.title") }), [t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="pair-link-modal"
    >
      <Text style={styles.helper}>{t("pairing.link.helper")}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>{t("pairing.link.label")}</Text>
        <AdaptiveTextInput
          ref={inputRef}
          testID="pair-link-input"
          nativeID="pair-link-input"
          accessibilityLabel={t("pairing.link.label")}
          onChangeText={handleChangeOfferUrl}
          placeholder="https://app.paseo.sh/#offer=..."
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}
          variant="secondary"
          onPress={handleCancel}
          disabled={isSaving}
          testID="pair-link-cancel"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.link.actions.cancel")}
        >
          {t("pairing.link.actions.cancel")}
        </Button>
        <Button
          style={FLEX_ONE_STYLE}
          variant="default"
          onPress={handleSavePress}
          disabled={isSaving}
          testID="pair-link-submit"
          accessibilityRole="button"
          accessibilityLabel={t("pairing.link.actions.pair")}
          leftIcon={pairIcon}
        >
          {isSaving ? t("pairing.link.actions.pairing") : t("pairing.link.actions.pair")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
