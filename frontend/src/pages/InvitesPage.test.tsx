import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvitesPage, inviteLink } from "./InvitesPage";
import { AuthProvider } from "../auth/AuthContext";
import { ToastProvider } from "../components/Toast";

/**
 * Invites, for an admin (AD-54).
 *
 * Held here: the create sends the note and the days, the one-time code becomes a message
 * holding a sign-up link, the message can be copied, the list reads the server's state, and
 * only an open invite offers Revoke.
 */

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const me = {
  id: "u1",
  email: "alex@example.com",
  currency: "USD",
  weight_unit: "kg",
  budget_start_day: 1,
  created_at: "",
  is_admin: true,
};

const invite = (overrides: Record<string, unknown>) => ({
  id: "i1",
  note: "sam",
  created_at: "2026-09-20T10:00:00Z",
  expires_at: "2026-10-04T10:00:00Z",
  used_at: null,
  state: "open",
  ...overrides,
});

type Call = { url: string; method: string; body: string };

function mockApi(list = [invite({})]) {
  window.localStorage.setItem("everything-everywhere.token", "test-token");
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: String(init?.body ?? "") });
    if (url.includes("/api/auth/me")) return json(me);
    if (url.includes("/revoke")) return json(null, 204);
    if (url.includes("/api/admin/invites") && method === "POST") {
      return json(
        { id: "new", code: "abc-DEF_123", note: "mum", expires_at: "2026-10-11T12:00:00Z" },
        201,
      );
    }
    if (url.includes("/api/admin/invites")) return json({ items: list });
    return json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

function render() {
  return rtlRender(
    <MemoryRouter initialEntries={["/invites"]}>
      <AuthProvider>
        <ToastProvider>
          <InvitesPage />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("InvitesPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the link from the app's own origin and escapes the code", () => {
    expect(inviteLink("a+b/c", "https://everything-everywhere.app")).toBe(
      "https://everything-everywhere.app/?invite=a%2Bb%2Fc",
    );
  });

  it("creates an invite and turns the one-time code into a message with the link", async () => {
    const { calls } = mockApi();
    const user = userEvent.setup();
    render();

    await user.type(await screen.findByLabelText("Who it is for"), "mum");
    await user.click(screen.getByRole("button", { name: "Create invite" }));

    const box = (await screen.findByLabelText("Message to send")) as HTMLTextAreaElement;
    expect(box.value).toContain(`${window.location.origin}/?invite=abc-DEF_123`);
    expect(box.value).toContain("expires on");

    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/admin/invites"));
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ note: "mum", days: 14 });
  });

  it("copies the message as edited", async () => {
    mockApi();
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    render();
    // userEvent installs its own clipboard on setup; replace it after.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await user.click(await screen.findByRole("button", { name: "Create invite" }));
    const box = await screen.findByLabelText("Message to send");
    await user.clear(box);
    await user.type(box, "see you there");
    await user.click(screen.getByRole("button", { name: "Copy message" }));

    expect(writeText).toHaveBeenCalledWith("see you there");
  });

  it("lists invites with their state and offers Revoke only on an open one", async () => {
    const { calls } = mockApi([
      invite({ id: "o", note: "open one" }),
      invite({ id: "u", note: "used one", state: "used", used_at: "2026-09-22T10:00:00Z" }),
      invite({ id: "e", note: null, state: "expired" }),
    ]);
    const user = userEvent.setup();
    render();

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const [openRow, usedRow, endedRow] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(openRow).getByText(/^Open until/)).toBeInTheDocument();
    expect(within(usedRow).getByText(/^Used/)).toBeInTheDocument();
    expect(within(endedRow).getByText("(no note)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);

    await user.click(within(openRow).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/api/admin/invites/o/revoke"))).toBe(true),
    );
  });
});
