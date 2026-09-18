"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type ConnectionStatus = "disconnected" | "connecting" | "qr" | "connected" | "auth_failed";

interface StatusResponse {
  status: ConnectionStatus;
  number: string | null;
  qr: string | null;
  error: string | null;
}

interface GroupItem {
  id: string;
  name: string;
  participantCount?: number;
}

interface ExportResult {
  groupName: string;
  groupId: string;
  participantCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  outputPath: string;
  downloadUrl: string;
}

type TgLoginStep = "none" | "qr_pending" | "awaiting_phone" | "awaiting_code" | "awaiting_password";

interface TgUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}

interface TgStatusResponse {
  transport: "disconnected" | "connecting" | "connected";
  authorized: boolean;
  loginStep: TgLoginStep;
  qr: string | null;
  user: TgUser | null;
  passwordHint: string | null;
  error: string | null;
}

interface TgGroup {
  id: string;
  title: string;
  kind: "group" | "supergroup";
  participantCount?: number;
}

interface TgParticipant {
  telegramId: string;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  isAdmin: boolean;
  isOwner: boolean;
}

interface TgExportResult {
  groupId: string;
  groupTitle: string;
  participantCount: number;
  filename: string;
  downloadUrl: string;
}

const POLL_INTERVAL_MS = 2000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

function participantLabel(p: TgParticipant): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  if (name && p.username) return `${name} (@${p.username})`;
  if (name) return name;
  if (p.username) return `@${p.username}`;
  return p.telegramId;
}

function connectionBadge(connection: ConnectionStatus) {
  switch (connection) {
    case "connected":
      return (
        <Badge variant="success" dot>
          Conectado
        </Badge>
      );
    case "connecting":
    case "qr":
      return (
        <Badge variant="warning" dot>
          Aguardando conexão
        </Badge>
      );
    case "auth_failed":
      return <Badge variant="destructive">Falha de autenticação</Badge>;
    default:
      return (
        <Badge variant="muted" dot>
          Não conectado
        </Badge>
      );
  }
}

interface MeResponse {
  authenticated: boolean;
  user?: { id: string; username: string };
}

export default function Home(): React.JSX.Element {
  const [me, setMe] = useState<MeResponse | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const data = await fetchJson<MeResponse>("/api/auth/me");
      setMe(data.authenticated ? data : { authenticated: false });
    } catch {
      setMe({ authenticated: false });
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  async function handleLogout(): Promise<void> {
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } catch {
      // logout is best-effort client-side; the gate re-checks anyway
    }
    setMe({ authenticated: false });
  }

  if (!me) {
    return <p className="text-muted-foreground">Carregando…</p>;
  }

  if (!me.authenticated || !me.user) {
    return <LoginScreen onLoggedIn={() => void refreshMe()} />;
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-3">
        <span className="text-sm text-muted-foreground">{me.user.username}</span>
        <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
          Sair
        </Button>
      </div>
      <p className="mb-6 text-muted-foreground">Exporte participantes de grupos para CSV.</p>
      <Tabs defaultValue="whatsapp">
        <TabsList aria-label="Plataforma">
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
        </TabsList>
        <TabsContent value="whatsapp">
          <WhatsAppSection onUnauthorized={() => setMe({ authenticated: false })} />
        </TabsContent>
        <TabsContent value="telegram">
          <TelegramSection onUnauthorized={() => setMe({ authenticated: false })} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }): React.JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">TeleZap</h1>
        <p className="text-sm text-muted-foreground">Group Contacts Exporter</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Entrar</CardTitle>
          <CardDescription>Acesso restrito a usuários autorizados.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-username">Username</Label>
              <Input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" loading={busy} disabled={!username || !password}>
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── WhatsApp (own state; mounted persistently across tab switches) ──────────

function WhatsAppSection({ onUnauthorized }: { onUnauthorized: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchJson<StatusResponse>("/api/whatsapp/status");
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Unauthorized.") {
        onUnauthorized();
        return;
      }
      setStatusError(message);
    }
  }, [onUnauthorized]);

  const refreshGroups = useCallback(async () => {
    try {
      const data = await fetchJson<{ groups: GroupItem[] }>("/api/groups");
      setGroups(data.groups);
      setGroupsError(null);
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Poll connection status; load groups once connected.
  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.status === "connected") {
      void refreshGroups();
    }
  }, [status?.status, refreshGroups]);

  async function handleConnect(): Promise<void> {
    setConnecting(true);
    try {
      await fetchJson("/api/whatsapp/connect", { method: "POST" });
      await refreshStatus();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  async function handleExport(): Promise<void> {
    const selected = groups.find((g) => g.id === selectedId);
    if (!selected || exporting) return;
    setExporting(true);
    setExportResult(null);
    setExportError(null);
    try {
      const result = await fetchJson<ExportResult>("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selected.id }),
      });
      setExportResult(result);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  const connection = status?.status ?? "disconnected";
  const selected = groups.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {connectionBadge(connection)}
          {connection === "connected" && status?.number && (
            <p className="text-2xl font-bold tracking-tight">{status.number}</p>
          )}
          {connection === "qr" && (
            <>
              {status?.qr && (
                <div className="inline-block rounded-lg border bg-white p-3">
                  <QRCode value={status.qr} size={220} />
                </div>
              )}
              <p className="text-sm text-muted-foreground">Escaneie o QR Code usando o WhatsApp.</p>
            </>
          )}
          {connection === "connecting" && (
            <p className="text-sm text-muted-foreground">Iniciando sessão… aguarde o QR Code.</p>
          )}
          {connection === "auth_failed" && (
            <>
              {status?.error && (
                <Alert variant="destructive">
                  <AlertDescription>{status.error}</AlertDescription>
                </Alert>
              )}
              <div>
                <Button onClick={() => void handleConnect()} loading={connecting}>
                  Tentar novamente
                </Button>
              </div>
            </>
          )}
          {connection === "disconnected" && (
            <div>
              <Button onClick={() => void handleConnect()} loading={connecting}>
                Conectar
              </Button>
            </div>
          )}
          {statusError && (
            <Alert variant="destructive">
              <AlertDescription>{statusError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grupos disponíveis</CardTitle>
        </CardHeader>
        <CardContent>
          {connection !== "connected" ? (
            <p className="text-sm text-muted-foreground">Conecte o WhatsApp para listar os grupos.</p>
          ) : groupsError ? (
            <div className="flex flex-col gap-3">
              <Alert variant="destructive">
                <AlertDescription>{groupsError}</AlertDescription>
              </Alert>
              <div>
                <Button variant="secondary" onClick={() => void refreshGroups()}>
                  Recarregar grupos
                </Button>
              </div>
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum grupo encontrado.</p>
          ) : (
            <ul className="divide-y divide-border">
              {groups.map((group) => (
                <li key={group.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2">
                    <input
                      type="radio"
                      name="group"
                      checked={selectedId === group.id}
                      onChange={() => setSelectedId(group.id)}
                      className="size-4 accent-primary"
                    />
                    <span className="flex-1">{group.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {group.participantCount !== undefined
                        ? `${group.participantCount} participantes`
                        : "participantes desconhecidos"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card role="region" aria-label="Exportar">
        <CardHeader>
          <CardTitle>Exportar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Button
              onClick={() => void handleExport()}
              disabled={connection !== "connected" || !selected}
              loading={exporting}
            >
              Exportar CSV
            </Button>
          </div>
          {exporting && <p className="text-sm text-muted-foreground">Exportando…</p>}
          {exportResult && (
            <Alert variant="success">
              <AlertTitle>✓ CSV exportado</AlertTitle>
              <AlertDescription>
                <span className="block">{exportResult.groupName}</span>
                <span className="block">{exportResult.participantCount} participantes</span>
                <span className="block">{exportResult.resolvedCount} contatos resolvidos</span>
                {exportResult.unresolvedCount > 0 && (
                  <span className="block">{exportResult.unresolvedCount} não resolvidos</span>
                )}
                <a href={exportResult.downloadUrl} className="font-semibold text-primary underline">
                  Baixar CSV
                </a>
              </AlertDescription>
            </Alert>
          )}
          {exportError && (
            <Alert variant="destructive">
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Telegram (own state; mounted persistently across tab switches) ──────────

function TelegramSection({ onUnauthorized }: { onUnauthorized: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<TgStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [groups, setGroups] = useState<TgGroup[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingParts, setLoadingParts] = useState(false);
  const [partsTitle, setPartsTitle] = useState<string | null>(null);
  const [participants, setParticipants] = useState<TgParticipant[] | null>(null);
  const [partsError, setPartsError] = useState<string | null>(null);
  const [hideNoPhone, setHideNoPhone] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<TgExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<TgStatusResponse>("/api/telegram/status");
      setStatus(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Unauthorized.") {
        onUnauthorized();
        return;
      }
      setError(message);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const refreshGroups = useCallback(async () => {
    try {
      const data = await fetchJson<{ groups: TgGroup[] }>("/api/telegram/groups");
      setGroups(data.groups);
      setGroupsError(null);
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (status?.authorized) {
      void refreshGroups();
    }
  }, [status?.authorized, refreshGroups]);

  async function post(path: string, body?: Record<string, string | boolean>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadParticipants(): Promise<void> {
    const selected = groups.find((g) => g.id === selectedId);
    if (!selected || loadingParts) return;
    setLoadingParts(true);
    setParticipants(null);
    setPartsError(null);
    setPartsTitle(null);
    setExportResult(null);
    setExportError(null);
    try {
      const data = await fetchJson<{ groupId: string; participants: TgParticipant[] }>(
        `/api/telegram/groups/${encodeURIComponent(selected.id)}/participants`,
      );
      setPartsTitle(selected.title);
      setParticipants(data.participants);
    } catch (err) {
      setPartsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingParts(false);
    }
  }

  async function handleExport(): Promise<void> {
    const selected = groups.find((g) => g.id === selectedId);
    if (!selected || exporting) return;
    setExporting(true);
    setExportResult(null);
    setExportError(null);
    try {
      const result = await fetchJson<TgExportResult>("/api/telegram/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selected.id, excludeHiddenPhone: hideNoPhone }),
      });
      setExportResult(result);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  const transport = status?.transport ?? "disconnected";
  const authorized = status?.authorized ?? false;
  const step = status?.loginStep ?? "none";
  const visibleParticipants = hideNoPhone
    ? (participants ?? []).filter((p) => p.phone.trim() !== "")
    : (participants ?? []);

  return (
    <section aria-label="Telegram" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>Autenticação via QR code, telefone ou senha 2FA.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {transport === "connected" && authorized && status?.user ? (
            <>
              {connectionBadge("connected")}
              <p className="text-2xl font-bold tracking-tight">
                {[status.user.firstName, status.user.lastName].filter(Boolean).join(" ") || "Telegram"}
              </p>
              {status.user.username && <p className="text-sm text-muted-foreground">@{status.user.username}</p>}
              <p className="text-sm text-muted-foreground">ID: {status.user.id}</p>
            </>
          ) : transport === "connecting" ? (
            <>
              {connectionBadge("connecting")}
              <p className="text-sm text-muted-foreground">Conectando…</p>
            </>
          ) : transport === "connected" && step === "qr_pending" ? (
            <>
              {connectionBadge("qr")}
              {status?.qr && (
                <div className="inline-block rounded-lg border bg-white p-3">
                  <QRCode value={status.qr} size={220} />
                </div>
              )}
              <p className="text-sm text-muted-foreground">Escaneie o QR Code usando o Telegram.</p>
              <div>
                <Button variant="secondary" onClick={() => void post("/api/telegram/qr/cancel")} loading={busy}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : transport === "connected" && step === "awaiting_code" ? (
            <>
              {connectionBadge("connecting")}
              <p className="text-sm text-muted-foreground">Digite o código enviado pelo Telegram.</p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tg-code">Código</Label>
                <Input
                  id="tg-code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void post("/api/telegram/auth/code", { code })} loading={busy} disabled={!code.trim()}>
                  Verificar
                </Button>
                <Button variant="secondary" onClick={() => void post("/api/telegram/qr/cancel")} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : transport === "connected" && step === "awaiting_password" ? (
            <>
              {connectionBadge("connecting")}
              {status?.passwordHint && <p className="text-sm text-muted-foreground">Dica: {status.passwordHint}</p>}
              <div className="flex flex-col gap-2">
                <Label htmlFor="tg-password">Senha</Label>
                <Input
                  id="tg-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void post("/api/telegram/auth/password", { password })} loading={busy} disabled={!password}>
                  Verificar
                </Button>
                <Button variant="secondary" onClick={() => void post("/api/telegram/qr/cancel")} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : transport === "connected" ? (
            <>
              {connectionBadge("connecting")}
              <div>
                <Button onClick={() => void post("/api/telegram/qr/start")} loading={busy}>
                  Escanear QR Code
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">ou entre com o número de telefone:</p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tg-phone">Telefone</Label>
                <Input
                  id="tg-phone"
                  type="tel"
                  placeholder="+5516999999999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <Button onClick={() => void post("/api/telegram/auth/phone", { phone })} loading={busy} disabled={!phone.trim()}>
                  Continuar
                </Button>
              </div>
            </>
          ) : (
            <>
              {connectionBadge("disconnected")}
              <div>
                <Button onClick={() => void post("/api/telegram/connect")} loading={busy}>
                  Conectar Telegram
                </Button>
              </div>
            </>
          )}
          {(status?.error || error) && (
            <Alert variant="destructive">
              <AlertDescription>{status?.error ?? error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {authorized && (
        <Card>
          <CardHeader>
            <CardTitle>Grupos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {groupsError ? (
              <Alert variant="destructive">
                <AlertDescription>{groupsError}</AlertDescription>
              </Alert>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum grupo encontrado.</p>
            ) : (
              <ul className="divide-y divide-border">
                {groups.map((group) => (
                  <li key={group.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <input
                        type="radio"
                        name="telegram-group"
                        checked={selectedId === group.id}
                        onChange={() => setSelectedId(group.id)}
                        className="size-4 accent-primary"
                      />
                      <span className="flex-1">{group.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {group.participantCount !== undefined
                          ? `${group.participantCount} participantes`
                          : group.kind === "supergroup"
                            ? "supergrupo"
                            : "grupo"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button onClick={() => void handleLoadParticipants()} disabled={!selectedId} loading={loadingParts}>
                Carregar participantes
              </Button>
            </div>
            {loadingParts && (
              <div className="flex flex-col gap-2" aria-label="Carregando participantes">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            )}
            {participants && (
              <>
                <Alert variant="info">
                  <AlertDescription>
                    Contatos no Telegram podem optar por não exibir o número de telefone.
                  </AlertDescription>
                </Alert>
                <p className="text-sm text-muted-foreground">
                  {partsTitle} — {participants.length} participantes
                  {hideNoPhone && ` • ${visibleParticipants.length} com número`}
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="tg-hide-no-phone"
                    checked={hideNoPhone}
                    onCheckedChange={(checked) => setHideNoPhone(checked === true)}
                  />
                  <Label htmlFor="tg-hide-no-phone">Não listar contatos com número oculto ou desconhecido</Label>
                </div>
                <ul className="divide-y divide-border">
                  {visibleParticipants.map((p) => (
                    <li key={p.telegramId} className="py-1.5 text-sm">
                      {participantLabel(p)}
                      {p.isOwner ? " • dono" : p.isAdmin ? " • admin" : ""}
                    </li>
                  ))}
                </ul>
                <Separator />
                <div>
                  <Button onClick={() => void handleExport()} loading={exporting}>
                    Exportar CSV
                  </Button>
                </div>
                {exporting && <p className="text-sm text-muted-foreground">Exportando…</p>}
              </>
            )}
            {exportResult && (
              <Alert variant="success">
                <AlertTitle>✓ CSV exportado</AlertTitle>
                <AlertDescription>
                  <span className="block">{exportResult.groupTitle}</span>
                  <span className="block">{exportResult.participantCount} participantes</span>
                  <a href={exportResult.downloadUrl} className="font-semibold text-primary underline">
                    Baixar CSV
                  </a>
                </AlertDescription>
              </Alert>
            )}
            {partsError && (
              <Alert variant="destructive">
                <AlertDescription>{partsError}</AlertDescription>
              </Alert>
            )}
            {exportError && (
              <Alert variant="destructive">
                <AlertDescription>{exportError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
