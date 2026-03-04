import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { mockTenantAuth } from "@/test/mock-tenant-auth";
import { POST } from "./route";

vi.mock("@/lib/api/tenant-auth", () => mockTenantAuth);
const { sessionsSendMock } = vi.hoisted(() => ({
  sessionsSendMock: vi.fn(),
}));
vi.mock("@clawe/shared/squadhub", () => ({
  sessionsSend: sessionsSendMock,
}));
vi.mock("@/lib/squadhub/connection", () => ({
  getConnection: vi.fn(() => ({
    squadhubUrl: "http://localhost:18790",
    squadhubToken: "test-token",
  })),
}));

const originalFetch = global.fetch;
const fetchMock = vi.fn<typeof fetch>();

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionsSendMock.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    sessionsSendMock.mockResolvedValue({
      ok: true,
      result: {
        content: [{ type: "text", text: "Acknowledged." }],
        details: { response: "Acknowledged." },
      },
    });

    // Anthropic success by default
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Hello from Anthropic" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 400 when sessionKey is missing", async () => {
    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe("sessionKey is required");
  });

  it("returns 400 when messages is missing", async () => {
    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionKey: "test-session" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe("messages is required");
  });

  it("returns text response with valid request", async () => {
    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "test-session",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Acknowledged.");
    expect(sessionsSendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI when Anthropic fails", async () => {
    sessionsSendMock.mockResolvedValueOnce({
      ok: false,
      error: { type: "unreachable", message: "Gateway unreachable" },
    });

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "Anthropic invalid key" },
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Hello from OpenAI" } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "test-session",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Hello from OpenAI");
  });

  it("uses Kimi endpoint when OpenAI key is sk-kimi", async () => {
    sessionsSendMock.mockResolvedValueOnce({
      ok: false,
      error: { type: "unreachable", message: "Gateway unreachable" },
    });

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {},
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "",
        openaiApiKey: "sk-kimi-test",
        kimiApiKey: "",
        status: "active",
      },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Hello from Kimi" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "test-session",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Hello from Kimi");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kimi.com/coding/v1/messages",
      expect.any(Object),
    );
  });

  it("uses tenant kimiApiKey when configured", async () => {
    sessionsSendMock.mockResolvedValueOnce({
      ok: false,
      error: { type: "unreachable", message: "Gateway unreachable" },
    });

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {},
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "",
        openaiApiKey: "",
        kimiApiKey: "sk-kimi-tenant-test",
        status: "active",
      },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Hello from tenant Kimi key" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "test-session",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Hello from tenant Kimi key");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kimi.com/coding/v1/messages",
      expect.any(Object),
    );
  });

  it("routes @mentions to target agents and persists notifications", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Inky", sessionKey: "agent:inky:main" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock.mockResolvedValueOnce({
      ok: true,
      result: {
        content: [{ type: "text", text: "I'll handle this now." }],
        details: { response: "I'll handle this now." },
      },
    });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [
          { role: "user", content: "@Inky write a landing-page draft" },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      "Inky: I'll handle this now.",
    );
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledWith(
      expect.any(Object),
      "agent:inky:main",
      expect.stringContaining("Message routed from Clawe"),
      expect.any(Number),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes @all to all teammates for collaboration", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Inky", sessionKey: "agent:inky:main" },
        { name: "Pixel", sessionKey: "agent:pixel:main" },
        { name: "Scout", sessionKey: "agent:scout:main" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I'll draft copy." }],
          details: { response: "I'll draft copy." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I'll prepare visuals." }],
          details: { response: "I'll prepare visuals." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I'll provide SEO keywords." }],
          details: { response: "I'll provide SEO keywords." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "Team plan with owners." }],
          details: { response: "Team plan with owners." },
        },
      });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [{ role: "user", content: "@all prepare launch materials" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Inky: I'll draft copy.");
    expect(text).toContain("Pixel: I'll prepare visuals.");
    expect(text).toContain("Scout: I'll provide SEO keywords.");
    expect(text).toContain("Clawe: Team plan with owners.");
    expect(response.headers.get("X-Clawe-Auto-Collab")).toBe("true");
    expect(response.headers.get("X-Clawe-Collab-Async")).toBe("false");
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes implicit typo mention to nearest agent name", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Scout", sessionKey: "agent:scout:main" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock.mockResolvedValueOnce({
      ok: true,
      result: {
        content: [{ type: "text", text: "I'll run keyword research now." }],
        details: { response: "I'll run keyword research now." },
      },
    });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [
          {
            role: "user",
            content: "please ask scount to do keyword research today",
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      "Scout: I'll run keyword research now.",
    );
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledWith(
      expect.any(Object),
      "agent:scout:main",
      expect.stringContaining("keyword research"),
      expect.any(Number),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes short @ink handle to Inky even when status is offline", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main", status: "online" },
        { name: "Inky", sessionKey: "agent:inky:main", status: "offline" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock.mockResolvedValueOnce({
      ok: true,
      result: {
        content: [{ type: "text", text: "I'll draft the article intro now." }],
        details: { response: "I'll draft the article intro now." },
      },
    });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [{ role: "user", content: "@ink please draft the intro" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      "Inky: I'll draft the article intro now.",
    );
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledWith(
      expect.any(Object),
      "agent:inky:main",
      expect.stringContaining("draft the intro"),
      expect.any(Number),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses @mentions in Chinese text without spaces", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Inky", sessionKey: "agent:inky:main" },
        { name: "Pixel", sessionKey: "agent:pixel:main" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I will draft copy blocks." }],
          details: { response: "I will draft copy blocks." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I will create visual drafts." }],
          details: { response: "I will create visual drafts." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "Combined execution plan." }],
          details: { response: "Combined execution plan." },
        },
      });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [{ role: "user", content: "请@Inky和@Pixel做一个首页方案" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Inky: I will draft copy blocks.");
    expect(text).toContain("Pixel: I will create visual drafts.");
    expect(text).toContain("Clawe: Combined execution plan.");
    expect(response.headers.get("X-Clawe-Collab-Async")).toBe("false");
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto-collaborates from main session after explicit delegation confirmation", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Inky", sessionKey: "agent:inky:main" },
        { name: "Pixel", sessionKey: "agent:pixel:main" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I will write the launch copy." }],
          details: { response: "I will write the launch copy." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I will design key visuals." }],
          details: { response: "I will design key visuals." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "Final plan with owners." }],
          details: { response: "Final plan with owners." },
        },
      });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [{ role: "user", content: "请协作完成下周发布计划，没其他补充了，开始分工" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Inky: I will write the launch copy.");
    expect(text).toContain("Pixel: I will design key visuals.");
    expect(text).toContain("Clawe: Final plan with owners.");
    expect(response.headers.get("X-Clawe-Auto-Collab")).toBe("true");
    expect(response.headers.get("X-Clawe-Collab-Async")).toBe("false");
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps no-mention message in Clawe session until delegation is confirmed", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Inky", sessionKey: "agent:inky:main" },
        { name: "Scout", sessionKey: "agent:scout:main" },
      ]);
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [{ role: "user", content: "prepare next week launch plan" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Acknowledged.");
    expect(response.headers.get("X-Clawe-Auto-Collab")).toBeNull();
    expect(response.headers.get("X-Clawe-Session-Key")).toBe("agent:main:main");
    expect(response.headers.get("X-Clawe-Clarification-Only")).toBe("true");
    expect(mutationMock).not.toHaveBeenCalled();
    expect(sessionsSendMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledWith(
      expect.any(Object),
      "agent:main:main",
      expect.stringContaining(
        "SYSTEM POLICY: clarification-only mode is active for this turn.",
      ),
      expect.any(Number),
    );
    expect(sessionsSendMock).toHaveBeenCalledWith(
      expect.any(Object),
      "agent:main:main",
      expect.stringContaining("User message: prepare next week launch plan"),
      expect.any(Number),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expands @mention routing to full team when collaboration intent is present", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Scout", sessionKey: "agent:scout:main" },
        { name: "Inky", sessionKey: "agent:inky:main" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I will cover keyword strategy." }],
          details: { response: "I will cover keyword strategy." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "I will draft positioning copy." }],
          details: { response: "I will draft positioning copy." },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          content: [{ type: "text", text: "Team breakdown complete." }],
          details: { response: "Team breakdown complete." },
        },
      });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [{ role: "user", content: "@Scout 请协作完成下周投放方案" }],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Scout: I will cover keyword strategy.");
    expect(text).toContain("Inky: I will draft positioning copy.");
    expect(text).toContain("Clawe: Team breakdown complete.");
    expect(response.headers.get("X-Clawe-Auto-Collab")).toBe("true");
    expect(response.headers.get("X-Clawe-Collab-Async")).toBe("false");
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns routed fallback text when specialists are unreachable", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "Clawe", sessionKey: "agent:main:main" },
        { name: "Inky", sessionKey: "agent:inky:main" },
        { name: "Pixel", sessionKey: "agent:pixel:main" },
      ])
      .mockResolvedValueOnce({ name: "Clawe" });
    const mutationMock = vi.fn().mockResolvedValue(undefined);

    mockTenantAuth.getAuthenticatedTenant.mockResolvedValueOnce({
      error: null,
      convex: {
        query: queryMock,
        mutation: mutationMock,
      },
      tenant: {
        _id: "test-tenant-id",
        squadhubUrl: "http://localhost:18790",
        squadhubToken: "test-token",
        anthropicApiKey: "sk-ant-test",
        openaiApiKey: "",
        kimiApiKey: "",
        status: "active",
      },
    });

    sessionsSendMock.mockResolvedValue({
      ok: false,
      error: { type: "unreachable", message: "session unavailable" },
    });

    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionKey: "agent:main:main",
        messages: [{ role: "user", content: "@all make a launch plan" }],
      }),
    });

    const response = await POST(request);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain(
      "Routed to Inky, Pixel. They were notified and will pick this up shortly.",
    );
    expect(response.headers.get("X-Clawe-Auto-Collab")).toBe("true");
    expect(response.headers.get("X-Clawe-Collab-Async")).toBe("false");
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(sessionsSendMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 500 on invalid JSON", async () => {
    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: "invalid json",
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
  });
});
