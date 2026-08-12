import { useEffect, useMemo, useState } from "react";
import type { Host, HostConnection } from "@getpaseo/dashboard-shared";
import { importHost, listHosts, login, register, syncHosts } from "./api/dashboardApi";
import { DefaultPaseoConnectionManager } from "./paseo/connectionManager";
import { clearOfferFragmentFromLocation, parseAndNormalizeOffer } from "./paseo/offer";
import { createClientConfig } from "./paseo/connectionManager";

const installationKey = "paseo-board.installation-id";

function getInstallationId(): string {
  const existing = globalThis.localStorage?.getItem(installationKey);
  if (existing) return existing;
  const next = globalThis.crypto.randomUUID();
  globalThis.localStorage?.setItem(installationKey, next);
  return next;
}

export function App() {
  const manager = useMemo(() => new DefaultPaseoConnectionManager(), []);
  // Expose for E2E test access
  if (typeof globalThis !== "undefined" && process.env.NODE_ENV !== "production") {
    (globalThis as Record<string, unknown>).__paseoTestConnectionManager = { createClientConfig };
  }
  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("password123");
  const [label, setLabel] = useState("My Paseo Host");
  const [offerInput, setOfferInput] = useState("");
  const [connection, setConnection] = useState<HostConnection | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [syncRevision, setSyncRevision] = useState(0);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const normalized = parseAndNormalizeOffer(globalThis.location.href);
      setOfferInput(globalThis.location.href);
      setConnection(normalized.connection);
      clearOfferFragmentFromLocation();
    } catch {
      clearOfferFragmentFromLocation();
    }
  }, []);

  async function authenticate(mode: "login" | "register") {
    setMessage("");
    const device = {
      installationId: getInstallationId(),
      name: navigator.userAgent.slice(0, 80),
      platform: "web" as const,
    };
    const payload = { email, password, device };
    await (mode === "login" ? login(payload) : register(payload));
    const nextHosts = await listHosts();
    setHosts(nextHosts);
    setSelectedHostId(nextHosts[0]?.id ?? null);
    setMessage(`${mode === "login" ? "登录" : "注册"}成功，已加载 Host`);
  }

  async function parseOffer() {
    setMessage("");
    const normalized = parseAndNormalizeOffer(offerInput);
    setConnection(normalized.connection);
    setMessage("pairing offer 格式有效，可继续连接验证");
  }

  async function verifyAndImport() {
    if (!connection) return;
    setMessage("");
    const provisionalHost: Host = {
      id: `pending-${connection.serverId}`,
      label,
      version: 0,
      connection,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await manager.connect(provisionalHost);
    const client = manager.getDaemonClient(provisionalHost.id);
    const serverInfo = client?.getLastServerInfoMessage();
    if (!serverInfo || serverInfo.serverId !== connection.serverId) {
      await manager.disconnect(provisionalHost.id);
      throw new Error("daemon server_info 与 pairing offer 不匹配");
    }

    const result = await importHost({
      label,
      connection,
      clientVerification: {
        verifiedAt: new Date().toISOString(),
        serverVersion: serverInfo.version ?? "unknown",
      },
      idempotencyKey: globalThis.crypto.randomUUID(),
    });

    await manager.disconnect(provisionalHost.id);
    setHosts((current) => [result.host, ...current.filter((host) => host.id !== result.host.id)]);
    setSelectedHostId(result.host.id);
    setSyncRevision(result.syncRevision);
    setMessage("Host 已验证并导入 Dashboard");
  }

  async function sync() {
    setMessage("");
    const result = await syncHosts(syncRevision);
    const upserts = result.changes
      .filter((change) => change.operation === "upsert")
      .map((change) => change.host);
    setHosts((current) => {
      const byId = new Map(current.map((host) => [host.id, host]));
      for (const host of upserts) byId.set(host.id, host);
      return Array.from(byId.values());
    });
    setSyncRevision(result.toRevision);
    setSelectedHostId((current) => current ?? upserts[0]?.id ?? null);
    setMessage("Host sync 完成");
  }

  async function connectSelectedHost() {
    const host = hosts.find((item) => item.id === selectedHostId);
    if (!host) return;
    setMessage("");
    const unsubscribe = manager.subscribe(host.id, (state) => setConnectionStatus(state.status));
    try {
      await manager.connect(host);
      const serverInfo = manager.getDaemonClient(host.id)?.getLastServerInfoMessage();
      setMessage(`daemon 已连接：${serverInfo?.version ?? "version unknown"}`);
    } finally {
      unsubscribe();
    }
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <main className="app">
      <section className="hero">
        <h1>Paseo Dashboard</h1>
        <p>
          控制面只保存和同步 Host capability；daemon 数据由浏览器直接通过 Paseo Relay/E2EE 获取。
        </p>
      </section>

      <section className="grid">
        <form className="card stack" onSubmit={(event) => event.preventDefault()}>
          <h2>账号</h2>
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="row">
            <button type="button" onClick={() => void run(() => authenticate("login"))}>
              登录
            </button>
            <button type="button" onClick={() => void run(() => authenticate("register"))}>
              注册
            </button>
          </div>
        </form>

        <section className="card stack">
          <h2>导入 Host</h2>
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
          <textarea
            value={offerInput}
            onChange={(event) => setOfferInput(event.target.value)}
            placeholder="粘贴 https://app.paseo.sh/#offer=..."
          />
          <div className="row">
            <button type="button" onClick={() => void run(parseOffer)}>
              校验 offer
            </button>
            <button type="button" disabled={!connection} onClick={() => void run(verifyAndImport)}>
              验证并导入
            </button>
          </div>
          {connection ? (
            <p className="muted">已解析 relay endpoint，完整 capability 不在页面日志中展示。</p>
          ) : null}
        </section>

        <section className="card stack">
          <h2>Host 同步与连接</h2>
          <button type="button" onClick={() => void run(sync)}>
            同步 Host
          </button>
          <div className="stack">
            {hosts.map((host) => (
              <label className="host row" key={host.id}>
                <input
                  checked={selectedHostId === host.id}
                  name="host"
                  onChange={() => setSelectedHostId(host.id)}
                  type="radio"
                />
                <span>{host.label}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={!selectedHostId}
            onClick={() => void run(connectSelectedHost)}
          >
            连接选中 Host
          </button>
          <span className="status">连接状态：{connectionStatus}</span>
        </section>
      </section>

      {message ? (
        <p className={message.includes("失败") || message.includes("failed") ? "error" : "success"}>
          {message}
        </p>
      ) : null}
    </main>
  );
}
