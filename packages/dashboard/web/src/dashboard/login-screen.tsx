import { Button } from "@/components/ui/button";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useDashboardSession } from "./session-provider";

type AuthMode = "login" | "register";

const ThemedActivityIndicator = withUnistyles(ActivityIndicator, (theme) => ({
  color: theme.colors.accent,
}));

const styles = StyleSheet.create((theme) => ({
  screen: {
    flexGrow: 1,
    minHeight: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[8],
    backgroundColor: theme.colors.surface0,
  },
  shell: {
    width: "100%",
    maxWidth: 392,
    gap: theme.spacing[6],
  },
  heading: {
    alignItems: "center",
    gap: theme.spacing[3],
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  markText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
  },
  card: {
    gap: theme.spacing[4],
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.md,
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
    minHeight: 44,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  error: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.surface2,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  switchButton: {
    alignSelf: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  switchText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  switchLink: {
    color: theme.colors.accentBright,
    fontWeight: theme.fontWeight.medium,
  },
  statusScreen: {
    flex: 1,
    minHeight: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  statusTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  },
  statusMessage: {
    maxWidth: 440,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
  },
  retryButton: {
    minWidth: 128,
  },
}));

export function DashboardLoginScreen() {
  const session = useDashboardSession();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const submitting = session.authAction === "login" || session.authAction === "register";

  const submit = useCallback(async () => {
    if (submitting) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setLocalError("请输入邮箱");
      return;
    }
    if (password.length < 8) {
      setLocalError("密码至少需要 8 个字符");
      return;
    }

    Keyboard.dismiss();
    setLocalError(null);
    session.clearAuthError();
    try {
      if (mode === "login") await session.login(normalizedEmail, password);
      else await session.register(normalizedEmail, password);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "登录失败，请重试");
    }
  }, [mode, password, session, submitting, email]);

  const changeMode = useCallback(() => {
    setMode((current) => (current === "login" ? "register" : "login"));
    setLocalError(null);
    session.clearAuthError();
  }, [session]);

  const error = localError ?? session.authError;

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      testID="dashboard-auth-screen"
    >
      <View style={styles.shell}>
        <View style={styles.heading}>
          <View style={styles.mark} accessibilityElementsHidden>
            <Text style={styles.markText}>P</Text>
          </View>
          <Text style={styles.title}>
            {mode === "login" ? "登录 Paseo Dashboard" : "创建 Dashboard 账号"}
          </Text>
          <Text style={styles.subtitle}>
            登录后才会加载账号中的 Host，并允许导入新的 pairing link。
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>邮箱</Text>
            <TextInput
              accessibilityLabel="邮箱"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!submitting}
              inputMode="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="you@example.com"
              returnKeyType="next"
              style={styles.input}
              testID="dashboard-auth-email"
              value={email}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>密码</Text>
            <TextInput
              accessibilityLabel="密码"
              autoCapitalize="none"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              editable={!submitting}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              placeholder="至少 8 个字符"
              returnKeyType="go"
              secureTextEntry
              style={styles.input}
              testID="dashboard-auth-password"
              value={password}
            />
          </View>

          {error ? (
            <View accessibilityRole="alert" style={styles.error} testID="dashboard-auth-error">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            loading={submitting}
            onPress={submit}
            testID="dashboard-auth-submit"
            variant="default"
          >
            {mode === "login" ? "登录" : "创建账号"}
          </Button>

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={changeMode}
            style={styles.switchButton}
            testID="dashboard-auth-switch-mode"
          >
            <Text style={styles.switchText}>
              {mode === "login" ? "还没有账号？" : "已经有账号？"}{" "}
              <Text style={styles.switchLink}>{mode === "login" ? "注册" : "返回登录"}</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

export function DashboardSessionLoadingScreen() {
  return (
    <View style={styles.statusScreen} testID="dashboard-session-loading">
      <ThemedActivityIndicator size="small" />
      <Text style={styles.statusMessage}>正在检查 Dashboard 登录状态…</Text>
    </View>
  );
}

export function DashboardSessionErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.statusScreen} testID="dashboard-session-error">
      <Text style={styles.statusTitle}>无法连接 Dashboard</Text>
      <Text style={styles.statusMessage}>{message}</Text>
      <Button onPress={onRetry} style={styles.retryButton} variant="default">
        重试
      </Button>
    </View>
  );
}
