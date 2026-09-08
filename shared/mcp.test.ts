import { describe, expect, it } from "vitest";
import { buildHealthDigest, splitNamespacedTool } from "./mcp";

describe("splitNamespacedTool", () => {
  it("splits gateway multiplexed names", () => {
    expect(splitNamespacedTool("forgejo__list_branches")).toEqual({
      server: "forgejo",
      tool: "list_branches",
    });
  });

  it("returns null for bare names and degenerate input", () => {
    expect(splitNamespacedTool("list_branches")).toBeNull();
    expect(splitNamespacedTool("__tool")).toBeNull();
    expect(splitNamespacedTool("server__")).toBeNull();
    expect(splitNamespacedTool("")).toBeNull();
  });
});

describe("buildHealthDigest", () => {
  it("carries counts and stamps an ISO time", () => {
    const digest = buildHealthDigest({ healthy: 3, degraded: 1, down: 0, total: 4 });
    expect(digest).toMatchObject({ healthy: 3, degraded: 1, down: 0, total: 4 });
    expect(Number.isNaN(Date.parse(digest.updatedAt))).toBe(false);
  });
});
