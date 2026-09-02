import { describe, expect, it } from "vitest";
import { probes, probeForProvider } from "./registry.server";
import { McpServerSchema } from "../mcp.shared";
import type { McpProbe } from "./types.server";

describe("provider contract verification (black-box guarantee)", () => {
  for (const probe of probes) {
    describe(`provider probe: ${probe.id}`, () => {
      it("satisfies McpProbe interface format", () => {
        expect(probe.id).toMatch(/^[a-z0-9_-]+$/);
        expect(typeof probe.label).toBe("string");
        expect(probe.label.trim().length).toBeGreaterThan(0);
        expect(typeof probe.matches).toBe("function");
        expect(typeof probe.probe).toBe("function");
      });

      it("matches its own provider identifier", () => {
        expect(probe.matches(probe.id)).toBe(true);
        expect(probe.matches("non-existent-provider-xyz")).toBe(false);
      });

      it("probes without throwing uncaught exceptions and returns schema-compliant servers", async () => {
        const result = await probe.probe({
          agentId: "test-agent-mock",
          provider: probe.id,
          cwd: "/tmp",
          sessionId: "test-session-mock",
        });

        // 1. Must return a valid result structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.servers)).toBe(true);
        if (result.error !== undefined && result.error !== null) {
          expect(typeof result.error).toBe("string");
        }

        // 2. Every returned server MUST strictly pass runtime Zod validation
        for (const s of result.servers) {
          const parsed = McpServerSchema.safeParse(s);
          if (!parsed.success) {
            console.error(`Invalid server returned by probe ${probe.id}:`, parsed.error.format());
          }
          expect(parsed.success).toBe(true);
        }
      });
    });
  }

  describe("registry resolution", () => {
    it("ensures unique probe IDs", () => {
      const ids = probes.map((p: McpProbe) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("resolves probes via probeForProvider", () => {
      for (const probe of probes) {
        const found = probeForProvider(probe.id);
        expect(found).not.toBeNull();
        expect(found?.id).toBe(probe.id);
      }
      expect(probeForProvider("unknown-provider")).toBeNull();
    });
  });
});

