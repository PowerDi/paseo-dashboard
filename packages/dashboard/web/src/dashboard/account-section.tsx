import type { Host } from "@getpaseo/dashboard-shared";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "../components/ui/button";
import { replaceRuntimeWithDashboardAccountHosts } from "../runtime/dashboard-host-mutations";
import { SettingsSection } from "../screens/settings/settings-section";
import { settingsStyles } from "../styles/settings";
import { confirmDialog, type ConfirmDialogInput } from "../utils/confirm-dialog";
import { useDashboardSession, useDashboardSessionStore } from "./session-provider";

export interface DashboardAccountSectionProps {
  onPairHost: () => void;
  onLoggedOut?: () => void;
}

export type DeleteDashboardAccountHostResult = "cancelled" | "deleted" | "failed";

interface DeleteDashboardAccountHostDependencies {
  confirmDelete: (input: ConfirmDialogInput) => Promise<boolean>;
  deleteHost: (hostId: string) => Promise<void>;
  syncRuntime: () => void;
  reportFailure: (message: string) => void;
}

/**
 * Keeps confirmation and mutation ordering independent from the rendered settings surface.
 * The runtime is updated only after the account API has accepted the deletion.
 */
export async function deleteDashboardAccountHost(
  host: Host,
  dependencies: DeleteDashboardAccountHostDependencies,
): Promise<DeleteDashboardAccountHostResult> {
  const confirmed = await dependencies.confirmDelete({
    title: "删除 Host？",
    message: `“${host.label}”将从当前 Dashboard 账号中删除。其他已登录设备会在下次同步时移除它。`,
    confirmLabel: "删除",
    cancelLabel: "取消",
    destructive: true,
  });
  if (!confirmed) return "cancelled";

  try {
    await dependencies.deleteHost(host.id);
    dependencies.syncRuntime();
    return "deleted";
  } catch (error) {
    dependencies.reportFailure(errorMessage(error));
    return "failed";
  }
}

interface DashboardHostRowProps {
  host: Host;
  bordered: boolean;
  deleting: boolean;
  disabled: boolean;
  onDelete: (host: Host) => void;
}

function DashboardHostRow({ host, bordered, deleting, disabled, onDelete }: DashboardHostRowProps) {
  const handleDelete = useCallback(() => onDelete(host), [host, onDelete]);

  return (
    <View
      style={bordered ? [settingsStyles.row, settingsStyles.rowBorder] : settingsStyles.row}
      testID={`dashboard-account-host-${host.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text selectable style={settingsStyles.rowTitle}>
          {host.label}
        </Text>
        <Text selectable style={settingsStyles.rowHint}>
          Server ID: {host.connection.serverId}
        </Text>
        <Text selectable style={settingsStyles.rowHint}>
          Relay: {host.connection.relayEndpoint}
        </Text>
      </View>
      <Button
        accessibilityLabel={`删除 ${host.label}`}
        disabled={disabled}
        loading={deleting}
        onPress={handleDelete}
        size="xs"
        testID={`dashboard-account-delete-host-${host.id}`}
        variant="destructive"
      >
        删除
      </Button>
    </View>
  );
}

/** Account identity and account-backed pairing management for Dashboard settings. */
export function DashboardAccountSection({ onPairHost, onLoggedOut }: DashboardAccountSectionProps) {
  const session = useDashboardSession();
  const sessionStore = useDashboardSessionStore();
  const [deletingHostId, setDeletingHostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reportFailure = useCallback((title: string, message: string) => {
    setActionError(message);
    Alert.alert(title, message);
  }, []);

  const handleRefresh = useCallback(async () => {
    setActionError(null);
    try {
      await session.refreshHosts();
      replaceRuntimeWithDashboardAccountHosts(sessionStore);
    } catch (error) {
      reportFailure("刷新 Host 失败", errorMessage(error));
    }
  }, [reportFailure, session, sessionStore]);

  const handleRefreshPress = useCallback(() => {
    void handleRefresh();
  }, [handleRefresh]);

  const handleDelete = useCallback(
    (host: Host) => {
      if (deletingHostId) return;

      setActionError(null);
      setDeletingHostId(host.id);
      void deleteDashboardAccountHost(host, {
        confirmDelete: confirmDialog,
        deleteHost: session.deleteHost,
        syncRuntime: () => replaceRuntimeWithDashboardAccountHosts(sessionStore),
        reportFailure: (message) => reportFailure("删除 Host 失败", message),
      }).finally(() => setDeletingHostId(null));
    },
    [deletingHostId, reportFailure, session, sessionStore],
  );

  const handleLogout = useCallback(async () => {
    setActionError(null);
    await session.logout();
    onLoggedOut?.();
  }, [onLoggedOut, session]);

  const handleLogoutPress = useCallback(() => {
    void handleLogout();
  }, [handleLogout]);

  const hostsBusy = session.hostsStatus === "loading";
  const actionsDisabled = hostsBusy || deletingHostId !== null || session.authAction === "logout";
  const visibleError = actionError ?? session.hostsError;
  const hostSectionActions = useMemo(
    () => (
      <View style={styles.sectionActions}>
        <Button
          disabled={actionsDisabled}
          loading={hostsBusy}
          onPress={handleRefreshPress}
          size="xs"
          testID="dashboard-account-refresh-hosts"
          variant="ghost"
        >
          刷新
        </Button>
        <Button
          disabled={actionsDisabled}
          onPress={onPairHost}
          size="xs"
          testID="dashboard-account-open-pairing"
          variant="outline"
        >
          添加 Pairing
        </Button>
      </View>
    ),
    [actionsDisabled, handleRefreshPress, hostsBusy, onPairHost],
  );

  if (session.authStatus !== "authenticated" || !session.user) return null;

  return (
    <View testID="dashboard-account-section">
      <SettingsSection title="Dashboard 账号">
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>当前账号</Text>
              <Text selectable style={settingsStyles.rowHint} testID="dashboard-account-email">
                {session.user.email}
              </Text>
            </View>
            <Button
              disabled={deletingHostId !== null}
              loading={session.authAction === "logout"}
              onPress={handleLogoutPress}
              size="sm"
              testID="dashboard-account-logout"
              variant="outline"
            >
              退出登录
            </Button>
          </View>
        </View>
      </SettingsSection>

      <SettingsSection title="已 Pairing 的 Host" trailing={hostSectionActions}>
        <View style={settingsStyles.card}>
          {session.hosts.length === 0 ? (
            <View style={settingsStyles.row} testID="dashboard-account-hosts-empty">
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {hostsBusy ? "正在加载 Host…" : "还没有已 Pairing 的 Host"}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  登录后添加的 Pairing 会保存在当前账号中。
                </Text>
              </View>
            </View>
          ) : (
            session.hosts.map((host, index) => (
              <DashboardHostRow
                bordered={index > 0}
                deleting={deletingHostId === host.id}
                disabled={actionsDisabled && deletingHostId !== host.id}
                host={host}
                key={host.id}
                onDelete={handleDelete}
              />
            ))
          )}
          {visibleError ? (
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowError} testID="dashboard-account-hosts-error">
                  {visibleError}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </SettingsSection>
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create((theme) => ({
  sectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
