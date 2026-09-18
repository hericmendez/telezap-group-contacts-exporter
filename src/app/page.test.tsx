// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import Home from "./page.js";

// Scoped queries: the page has parallel WhatsApp and Telegram sections with
// similar controls — always scope export/group queries to one region.
function whatsappExportRegion() {
  return within(screen.getByRole("region", { name: "Exportar" }));
}

function telegramRegion() {
  return within(screen.getByRole("region", { name: "Telegram" }));
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as Response;
}

const disconnected = { status: "disconnected", number: null, qr: null, error: null };
const connected = { status: "connected", number: "5516993038349", qr: null, error: null };
const groups = {
  groups: [{ id: "120363423663114428@g.us", name: "Fazendinha", participantCount: 2 }],
};
const exportOk = {
  groupName: "Fazendinha",
  groupId: "120363423663114428@g.us",
  participantCount: 2,
  resolvedCount: 2,
  unresolvedCount: 0,
  outputPath: "output/Fazendinha.csv",
  downloadUrl: "/api/export/download",
};

let fetchMock: ReturnType<typeof vi.fn>;

const authedMe = { authenticated: true, user: { id: "u1", username: "revi" } };

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  // Auth gate defaults to authenticated so existing app-flow tests keep
  // exercising the TeleZap UI; auth-specific tests stub /api/auth/me itself.
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") {
      // Auth-specific tests answer /me themselves; everyone else falls back
      // to the default authenticated user (a response without an
      // `authenticated` field does not count as an answer).
      try {
        const res = await handler(url, init);
        const data = (await res.json()) as { authenticated?: unknown };
        if (data && typeof data === "object" && "authenticated" in data) return res;
      } catch {
        // handler doesn't cover /me — fall through to the default below
      }
      return jsonResponse(authedMe);
    }
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home page", () => {
  it("shows disconnected state with a connect button", async () => {
    stubFetch(async () => jsonResponse(disconnected));
    render(<Home />);
    // both platforms render their own disconnected section
    expect(await screen.findAllByText("Não conectado")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Conectar" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Conectar Telegram" })).toBeDefined();
  });

  it("calls /api/whatsapp/connect when Conectar is clicked", async () => {
    stubFetch(async (url, init) => {
      if (url === "/api/whatsapp/connect") return jsonResponse({ started: true, status: "connecting" });
      return jsonResponse(disconnected);
    });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "Conectar" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/whatsapp/connect", { method: "POST" });
    });
  });

  it("shows QR while waiting for scan", async () => {
    stubFetch(async () => jsonResponse({ status: "qr", number: null, qr: "raw-qr", error: null }));
    render(<Home />);
    expect(await screen.findByText("Escaneie o QR Code usando o WhatsApp.")).toBeDefined();
  });

  it("lists groups when connected and exports the selected one by ID", async () => {
    stubFetch(async (url, init) => {
      if (url === "/api/whatsapp/status") return jsonResponse(connected);
      if (url === "/api/groups") return jsonResponse(groups);
      if (url === "/api/export") {
        expect(init?.method).toBe("POST");
        // identity is the group ID — the name is presentation only
        expect(JSON.parse(init?.body as string)).toEqual({
          groupId: "120363423663114428@g.us",
        });
        return jsonResponse(exportOk);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);

    expect(await screen.findByText("Conectado")).toBeDefined();
    expect(await screen.findByText("5516993038349")).toBeDefined();
    expect(await screen.findByText("Fazendinha")).toBeDefined();

    fireEvent.click(screen.getByRole("radio"));
    const exportButton = whatsappExportRegion().getByRole("button", { name: "Exportar CSV" });
    expect(exportButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(exportButton);

    expect(await screen.findByText("✓ CSV exportado")).toBeDefined();
    expect(screen.getByText("2 contatos resolvidos")).toBeDefined();
    const download = screen.getByRole("link", { name: "Baixar CSV" });
    expect(download.getAttribute("href")).toBe("/api/export/download");
  });

  it("selects duplicate group names individually by ID", async () => {
    const dupGroups = {
      groups: [
        { id: "aaa@g.us", name: "Fazendinha", participantCount: 2 },
        { id: "bbb@g.us", name: "Fazendinha", participantCount: 14 },
      ],
    };
    stubFetch(async (url, init) => {
      if (url === "/api/whatsapp/status") return jsonResponse(connected);
      if (url === "/api/groups") return jsonResponse(dupGroups);
      if (url === "/api/export") {
        expect(JSON.parse(init?.body as string)).toEqual({ groupId: "bbb@g.us" });
        return jsonResponse({ ...exportOk, groupId: "bbb@g.us", participantCount: 14 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);

    // both rows show only name + count — no raw IDs in the UI
    expect(await screen.findAllByText("Fazendinha")).toHaveLength(2);
    expect(screen.queryByText("bbb@g.us")).toBeNull();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);

    // select the second duplicate and export it specifically
    fireEvent.click(radios[1]!);
    fireEvent.click(whatsappExportRegion().getByRole("button", { name: "Exportar CSV" }));

    expect(await screen.findByText("✓ CSV exportado")).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/export",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const exportCall = fetchMock.mock.calls.find((c) => c[0] === "/api/export");
    expect(JSON.parse(exportCall![1]!.body as string)).toEqual({ groupId: "bbb@g.us" });
  });

  it("shows export errors clearly", async () => {
    stubFetch(async (url) => {
      if (url === "/api/whatsapp/status") return jsonResponse(connected);
      if (url === "/api/groups") return jsonResponse(groups);
      if (url === "/api/export") {
        return jsonResponse({ error: 'Group "X" was not found.' }, false, 404);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);
    expect(await screen.findByText("Fazendinha")).toBeDefined();
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.click(whatsappExportRegion().getByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByText('Group "X" was not found.')).toBeDefined();
  });

  it("keeps Exportar disabled until a group is selected", async () => {
    stubFetch(async (url) => {
      if (url === "/api/whatsapp/status") return jsonResponse(connected);
      if (url === "/api/groups") return jsonResponse(groups);
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);
    expect(await screen.findByText("Fazendinha")).toBeDefined();
    expect(whatsappExportRegion().getByRole("button", { name: "Exportar CSV" }).hasAttribute("disabled")).toBe(true);
  });
});

const tgDisconnected = {
  transport: "disconnected",
  authorized: false,
  loginStep: "none",
  qr: null,
  user: null,
  passwordHint: null,
  error: null,
};

function stubApp(waStatus: unknown, tgStatus: unknown | (() => unknown), extra?: (url: string, init?: RequestInit) => Response | Promise<Response | undefined> | undefined) {
  stubFetch(async (url, init) => {
    if (url === "/api/whatsapp/status") return jsonResponse(waStatus);
    if (url === "/api/telegram/status") {
      return jsonResponse(typeof tgStatus === "function" ? tgStatus() : tgStatus);
    }
    if (extra) {
      const res = await extra(url, init);
      if (res) return res;
    }
    if (url === "/api/groups") return jsonResponse(groups);
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("Telegram section", () => {
  it("connects via its own button without touching WhatsApp state", async () => {
    stubApp(disconnected, tgDisconnected, async (url) => {
      if (url === "/api/telegram/connect") return jsonResponse({ started: true });
      return undefined;
    });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "Conectar Telegram" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/telegram/connect", expect.objectContaining({ method: "POST" }));
    });
    // WhatsApp section untouched
    expect(await screen.findAllByText("Não conectado")).toHaveLength(2);
  });

  it("shows the Telegram QR while pending", async () => {
    stubApp(disconnected, { ...tgDisconnected, transport: "connected", loginStep: "qr_pending", qr: "tg://login?token=abc" });
    render(<Home />);
    expect(await screen.findByText("Escaneie o QR Code usando o Telegram.")).toBeDefined();
  });

  it("runs the phone → code flow to authorized", async () => {
    let tgState: Record<string, unknown> = { ...tgDisconnected, transport: "connected", loginStep: "none" };
    stubApp(disconnected, () => tgState, async (url, init) => {
      if (url === "/api/telegram/auth/phone") {
        expect(JSON.parse(init?.body as string)).toEqual({ phone: "+5516999999999" });
        tgState = { ...tgState, loginStep: "awaiting_code" };
        return jsonResponse({ sent: true });
      }
      if (url === "/api/telegram/auth/code") {
        expect(JSON.parse(init?.body as string)).toEqual({ code: "12345" });
        tgState = {
          ...tgState,
          loginStep: "none",
          authorized: true,
          user: { id: "777000", firstName: "Grazi", lastName: "", username: "grazi" },
        };
        return jsonResponse({ verified: true });
      }
      return undefined;
    });
    render(<Home />);
    expect(await screen.findByRole("button", { name: "Escanear QR Code" })).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText("+5516999999999"), { target: { value: "+5516999999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Digite o código enviado pelo Telegram.")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByText("Grazi")).toBeDefined();
    expect(screen.getByText("ID: 777000")).toBeDefined();
  });

  it("shows 2FA hint and submits the password", async () => {
    stubApp(
      disconnected,
      { ...tgDisconnected, transport: "connected", loginStep: "awaiting_password", passwordHint: "your dog" },
      async (url, init) => {
        if (url === "/api/telegram/auth/password") {
          expect(JSON.parse(init?.body as string)).toEqual({ password: "s3cret" });
          return jsonResponse({ verified: true });
        }
        return undefined;
      },
    );
    render(<Home />);
    expect(await screen.findByText("Dica: your dog")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/telegram/auth/password",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("shows the connected user without internals", async () => {
    stubApp(disconnected, {
      ...tgDisconnected,
      transport: "connected",
      authorized: true,
      user: { id: "777000", firstName: "Grazi", lastName: "", username: "grazi" },
    });
    render(<Home />);
    expect(await screen.findByText("Grazi")).toBeDefined();
    expect(screen.getByText("@grazi")).toBeDefined();
    expect(screen.getByText("ID: 777000")).toBeDefined();
  });

  it("surfaces server errors clearly", async () => {
    stubApp(disconnected, { ...tgDisconnected, transport: "connected", error: "Invalid verification code. Check the code and try again." });
    render(<Home />);
    expect(await screen.findByText("Invalid verification code. Check the code and try again.")).toBeDefined();
  });
});

const tgAuthorized = {
  transport: "connected",
  authorized: true,
  loginStep: "none",
  qr: null,
  user: { id: "777000", firstName: "Grazi", lastName: "", username: "grazi" },
  passwordHint: null,
  error: null,
};

const tgGroups = {
  groups: [
    { id: "100", title: "Devs", kind: "supergroup", participantCount: 2 },
    { id: "200", title: "Family", kind: "group" },
  ],
};

describe("Telegram groups & participants", () => {
  function stubTelegramApp(opts: {
    groups?: unknown;
    participants?: Record<string, unknown>;
    groupsError?: { status: number; body: unknown };
  }) {
    stubFetch(async (url) => {
      if (url === "/api/whatsapp/status") return jsonResponse(disconnected);
      if (url === "/api/telegram/status") return jsonResponse(tgAuthorized);
      if (url === "/api/telegram/groups") {
        if (opts.groupsError) return jsonResponse(opts.groupsError.body, false, opts.groupsError.status);
        return jsonResponse(opts.groups ?? tgGroups);
      }
      const match = url.match(/^\/api\/telegram\/groups\/([^/]+)\/participants$/);
      if (match) {
        const entry = opts.participants?.[match[1]!];
        if (!entry) return jsonResponse({ error: 'Telegram group "000" was not found.' }, false, 404);
        return jsonResponse(entry);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it("lists groups after authorization and loads participants by ID", async () => {
    stubTelegramApp({
      participants: {
        "100": {
          groupId: "100",
          participants: [
            { telegramId: "11", firstName: "Ada", lastName: "", username: "ada", phone: "", isAdmin: true, isOwner: false },
            { telegramId: "12", firstName: "", lastName: "", username: "", phone: "", isAdmin: false, isOwner: false },
          ],
        },
      },
    });
    render(<Home />);
    expect(await screen.findByText("Devs")).toBeDefined();
    expect(screen.getByText("Family")).toBeDefined();

    const radios = screen.getAllByRole("radio", { name: /Devs|Family/ });
    fireEvent.click(radios[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Carregar participantes" }));

    expect(await screen.findByText("Devs — 2 participantes")).toBeDefined();
    expect(screen.getByText("Ada (@ada) • admin")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/telegram/groups/100/participants",
        undefined,
      );
    });
  });

  it("selects duplicate titles individually by ID", async () => {
    stubTelegramApp({
      groups: {
        groups: [
          { id: "aaa", title: "Same", kind: "supergroup", participantCount: 2 },
          { id: "bbb", title: "Same", kind: "supergroup", participantCount: 14 },
        ],
      },
      participants: {
        bbb: { groupId: "bbb", participants: [] },
      },
    });
    render(<Home />);
    expect(await screen.findAllByText("Same")).toHaveLength(2);
    expect(screen.queryByText("bbb")).toBeNull();
    const radios = screen.getAllByRole("radio", { name: /Same/ });
    fireEvent.click(radios[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Carregar participantes" }));
    expect(await screen.findByText("Same — 0 participantes")).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/telegram/groups/bbb/participants", undefined);
    });
  });

  it("shows participant errors clearly", async () => {
    stubTelegramApp({});
    render(<Home />);
    expect(await screen.findByText("Devs")).toBeDefined();
    fireEvent.click(screen.getAllByRole("radio", { name: /Devs|Family/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Carregar participantes" }));
    expect(await screen.findByText('Telegram group "000" was not found.')).toBeDefined();
  });

  it("shows group loading errors clearly", async () => {
    stubTelegramApp({
      groupsError: { status: 401, body: { error: "Telegram authentication is required. Connect and log in first." } },
    });
    render(<Home />);
    expect(await screen.findByText("Telegram authentication is required. Connect and log in first.")).toBeDefined();
  });
});

describe("Telegram export", () => {
  const exportParticipants = {
    groupId: "100",
    participants: [
      { telegramId: "11", firstName: "Ada", lastName: "", username: "ada", phone: "", isAdmin: true, isOwner: false },
    ],
  };

  function stubExportApp(exportImpl?: (url: string, init?: RequestInit) => Response | Promise<Response | undefined> | undefined) {
    stubFetch(async (url, init) => {
      if (url === "/api/whatsapp/status") return jsonResponse(disconnected);
      if (url === "/api/telegram/status") return jsonResponse(tgAuthorized);
      if (url === "/api/telegram/groups") return jsonResponse(tgGroups);
      if (url === "/api/telegram/groups/100/participants") return jsonResponse(exportParticipants);
      if (exportImpl) {
        const res = await exportImpl(url, init);
        if (res) return res;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it("exports by groupId and shows success with download", async () => {
    stubExportApp(async (url, init) => {
      if (url === "/api/telegram/export") {
        expect(JSON.parse(init?.body as string)).toEqual({ groupId: "100", excludeHiddenPhone: false });
        return jsonResponse({
          groupId: "100",
          groupTitle: "Devs",
          participantCount: 1,
          filename: "telegram-Devs.csv",
          downloadUrl: "/api/telegram/export/download",
        });
      }
      return undefined;
    });
    render(<Home />);
    expect(await screen.findByText("Devs")).toBeDefined();
    fireEvent.click(screen.getAllByRole("radio", { name: /Devs|Family/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Carregar participantes" }));
    expect(await screen.findByText("Devs — 1 participantes")).toBeDefined();

    fireEvent.click(telegramRegion().getByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByText("✓ CSV exportado")).toBeDefined();
    expect(screen.getByText("1 participantes")).toBeDefined();
    const download = screen.getByRole("link", { name: "Baixar CSV" });
    expect(download.getAttribute("href")).toBe("/api/telegram/export/download");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/telegram/export",
        expect.objectContaining({ method: "POST" }),
      );
    });
    // WhatsApp export button unaffected (still disabled, no group selected there)
    expect(whatsappExportRegion().getByRole("button", { name: "Exportar CSV" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows export errors without leaking internals", async () => {
    stubExportApp(async (url) => {
      if (url === "/api/telegram/export") {
        return jsonResponse({ error: "Participant enumeration is not available for this group with the current account." }, false, 403);
      }
      return undefined;
    });
    render(<Home />);
    expect(await screen.findByText("Devs")).toBeDefined();
    fireEvent.click(screen.getAllByRole("radio", { name: /Devs|Family/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Carregar participantes" }));
    expect(await screen.findByText("Devs — 1 participantes")).toBeDefined();
    fireEvent.click(telegramRegion().getByRole("button", { name: "Exportar CSV" }));
    expect(
      await screen.findByText("Participant enumeration is not available for this group with the current account."),
    ).toBeDefined();
  });
});

describe("TeleZap tabs, theme, and phone filter", () => {
  function stubTabsApp() {
    stubFetch(async (url) => {
      if (url === "/api/whatsapp/status") return jsonResponse(disconnected);
      if (url === "/api/telegram/status") return jsonResponse(tgAuthorized);
      if (url === "/api/telegram/groups") return jsonResponse(tgGroups);
      const match = url.match(/^\/api\/telegram\/groups\/([^/]+)\/participants$/);
      if (match) {
        return jsonResponse({
          groupId: match[1],
          participants: [
            { telegramId: "11", firstName: "Ada", lastName: "", username: "ada", phone: "+5516", isAdmin: false, isOwner: false },
            { telegramId: "12", firstName: "Bo", lastName: "", username: "", phone: "", isAdmin: false, isOwner: false },
          ],
        });
      }
      if (url === "/api/telegram/export") {
        return jsonResponse({
          groupId: "100",
          groupTitle: "Devs",
          participantCount: 1,
          filename: "telegram-Devs.csv",
          downloadUrl: "/api/telegram/export/download",
        });
      }
      if (url === "/api/groups") return jsonResponse(groups);
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it("renders both platform tabs and preserves WhatsApp state across switches", async () => {
    stubTabsApp();
    render(<Home />);
    const waTab = await screen.findByRole("tab", { name: "WhatsApp" });
    const tgTab = screen.getByRole("tab", { name: "Telegram" });
    expect(waTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.mouseDown(tgTab, { button: 0 });
    fireEvent.click(tgTab);
    expect(tgTab.getAttribute("aria-selected")).toBe("true");
    // both sections stay mounted (forceMount) — WhatsApp keeps its state
    expect(screen.getByRole("region", { name: "Telegram" })).toBeDefined();
    waTab.focus();
    fireEvent.mouseDown(waTab, { button: 0 });
    fireEvent.click(waTab);
    expect(waTab.getAttribute("aria-selected")).toBe("true");
  });

  it("toggles the theme without crashing", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    const { ThemeProvider } = await import("next-themes");
    const { ThemeToggle } = await import("../components/theme-toggle.js");
    render(
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const toggle = await screen.findByRole("button", { name: /modo escuro|modo claro/ });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: /modo escuro|modo claro/ }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  it("filters hidden-phone contacts in list, count, and export body", async () => {
    stubTabsApp();
    render(<Home />);
    fireEvent.click(await screen.findByRole("tab", { name: "Telegram" }));
    expect(await screen.findByText("Devs")).toBeDefined();
    fireEvent.click(screen.getAllByRole("radio", { name: /Devs|Family/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Carregar participantes" }));
    expect(await screen.findByText("Devs — 2 participantes")).toBeDefined();
    expect(screen.getByText("Bo")).toBeDefined();
    expect(
      screen.getByText("Contatos no Telegram podem optar por não exibir o número de telefone."),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("checkbox", { name: "Não listar contatos com número oculto ou desconhecido" }));
    expect(screen.getByText(/Devs — 2 participantes/)).toBeDefined();
    expect(screen.getByText(/1 com número/)).toBeDefined();
    expect(screen.queryByText("Bo")).toBeNull();

    fireEvent.click(telegramRegion().getByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByText("✓ CSV exportado")).toBeDefined();
    const exportCall = fetchMock.mock.calls.find((c) => c[0] === "/api/telegram/export");
    expect(JSON.parse(exportCall![1]!.body as string)).toEqual({ groupId: "100", excludeHiddenPhone: true });
  });
});

const unauth = () => jsonResponse({ error: "Unauthorized." }, false, 401);

describe("App authentication gate", () => {
  it("shows the login screen when unauthenticated", async () => {
    stubFetch(async (url) => {
      if (url === "/api/auth/me") return jsonResponse({ authenticated: false });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeDefined();
    expect(screen.queryByRole("tab", { name: "WhatsApp" })).toBeNull();
    expect(screen.getByLabelText("Username")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
  });

  it("logs in and shows the app with the username", async () => {
    let loggedIn = false;
    stubFetch(async (url, init) => {
      if (url === "/api/auth/me") {
        return loggedIn ? jsonResponse(authedMe) : jsonResponse({ authenticated: false });
      }
      if (url === "/api/auth/login") {
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ username: "revi", password: "s3cret" });
        loggedIn = true;
        return jsonResponse({ authenticated: true, user: { id: "revi", username: "revi" } });
      }
      if (url === "/api/whatsapp/status") return jsonResponse(disconnected);
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "revi" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("tab", { name: "WhatsApp" })).toBeDefined();
    expect(screen.getByText("revi")).toBeDefined();
  });

  it("shows a generic error on invalid credentials", async () => {
    stubFetch(async (url) => {
      if (url === "/api/auth/me") return jsonResponse({ authenticated: false });
      if (url === "/api/auth/login") return jsonResponse({ error: "Invalid credentials." }, false, 401);
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "revi" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Invalid credentials.")).toBeDefined();
    expect(screen.queryByRole("tab", { name: "WhatsApp" })).toBeNull();
  });

  it("logs out back to the login screen", async () => {
    let loggedIn = true;
    stubFetch(async (url, init) => {
      if (url === "/api/auth/me") {
        return loggedIn ? jsonResponse(authedMe) : jsonResponse({ authenticated: false });
      }
      if (url === "/api/auth/logout") {
        expect(init?.method).toBe("POST");
        loggedIn = false;
        return jsonResponse({ authenticated: false });
      }
      if (url === "/api/whatsapp/status") return jsonResponse(disconnected);
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);
    expect(await screen.findByRole("tab", { name: "WhatsApp" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeDefined();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
    });
  });

  it("returns to login when polling hits 401", async () => {
    stubFetch(async (url) => {
      if (url === "/api/auth/me") return jsonResponse(authedMe);
      if (url === "/api/whatsapp/status") return unauth();
      if (url === "/api/telegram/status") {
        return jsonResponse({ transport: "disconnected", authorized: false, loginStep: "none", qr: null, user: null, passwordHint: null, error: null });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<Home />);
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeDefined();
  });
});
