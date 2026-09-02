import { describe, expect, it } from "vitest";
import { probes } from "./registry.server";
import type { McpProbe } from "./types.server";

describe("probe contract — PRs only need to satisfy this, not implementation", () => {
  for (const probe of probes) {
    it(`${probe.id} satisfies McpProbe`, async () => {
      expect(probe.id).toMatch(/^[a-z0-9_-]+$/);
      expect(typeof probe.label).toBe("string");
      expect(typeof probe.matches).toBe("function");
      expect(typeof probe.probe).toBe("function");

      const result = await probe.probe({ agentId: "test-agent", provider: probe.id, cwd: "/tmp" });
      expect(result).toHaveProperty("servers");
      expect(Array.isArray(result.servers)).toBe(true);
      for (const s of result.servers) {
        expect(s).toHaveProperty("id");
        expect(s).toHaveProperty("name");
        expect(s).toHaveProperty("transport");
        expect(s).toHaveProperty("source");
        expect(s.source).toHaveProperty("kind");
      }
    });
  }

  it("registry is a keyed map — obvious where to add a provider", async () => {
    const ids = probes.map((p: McpProbe) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["opencode", "claude", "codex", "pi"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
