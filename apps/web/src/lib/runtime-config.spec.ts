import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuthProvider,
  getAutoLoginEmail,
  getClaweEdition,
  getConvexUrl,
} from "./runtime-config";

describe("runtime-config", () => {
  beforeEach(() => {
    window.__CLAWE_CONFIG__ = undefined;
  });

  it("returns safe client defaults when no runtime config is injected", () => {
    expect(getConvexUrl()).toBe("");
    expect(getAuthProvider()).toBe("nextauth");
    expect(getAutoLoginEmail()).toBeNull();
    expect(getClaweEdition()).toBe("oss");
  });

  it("reads auth and login values from the injected runtime config", () => {
    window.__CLAWE_CONFIG__ = {
      convexUrl: "http://127.0.0.1:3210",
      authProvider: "nextauth",
      autoLoginEmail: "dev@clawe.local",
      claweEdition: "oss",
    };

    expect(getConvexUrl()).toBe("http://127.0.0.1:3210");
    expect(getAuthProvider()).toBe("nextauth");
    expect(getAutoLoginEmail()).toBe("dev@clawe.local");
    expect(getClaweEdition()).toBe("oss");
  });

  it("maps host.docker.internal to the current browser hostname", () => {
    window.__CLAWE_CONFIG__ = {
      convexUrl: "http://host.docker.internal:3210",
      authProvider: "nextauth",
      autoLoginEmail: "dev@clawe.local",
      claweEdition: "oss",
    };

    const url = new URL(getConvexUrl());
    expect(url.hostname).toBe(window.location.hostname);
    expect(url.port).toBe("3210");
  });
});
