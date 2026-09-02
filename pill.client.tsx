import { Icon, Modal, useToast } from "@getpaseo/plugin/react-native";
import type { PluginClientContext, PluginComposerPillProps } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMcpQuery } from "./mcp-query.client";
import { useRpc } from "@getpaseo/plugin";
import { checkMcpHealth, diagnoseMcp, readMcp } from "./mcp.shared";

const openers = new Map<string, () => void>();

function McpModal({
  agentId,
  open,
  onOpenChange,
  theme,
}: {
  agentId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  theme: PluginComposerPillProps["theme"];
}) {
  const query = useMcpQuery(agentId);
  const callRead = useRpc(readMcp);
  const callHealth = useRpc(checkMcpHealth);
  const callDiagnose = useRpc(diagnoseMcp);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ raw: string; redacted: string; path: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [health, setHealth] = useState<{ instructions: string | null; status: string; latencyMs: number; toolCount: number | null; tools: string[] | null; error: string | null } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [paseoExpanded, setPaseoExpanded] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<{
    provider: string;
    cwd: string;
    probeId: string | null;
    probeLabel: string | null;
    steps: Array<{ target: string; status: "found" | "missing" | "error" | "skipped"; details: string; contentPreview: string | null }>;
    discoveredServerCount: number;
    error: string | null;
  } | null>(null);

  const runDiagnostics = async () => {
    setShowDiagnostics(true);
    setDiagnosticsLoading(true);
    try {
      const data = await callDiagnose({ agentId });
      setDiagnosticData(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const term = search.trim().toLowerCase();
  const matches = (s: { name: string; description: string }) =>
    !term || s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term);

  const servers = (query.data?.servers ?? []).filter(matches);
  const paseoTools = (query.data?.paseoTools ?? []).filter(matches);

  const groupedServers = useMemo(() => {
    const m = new Map<string, typeof servers>();
    for (const s of servers) {
      const k = s.source.label;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()];
  }, [servers]);

  const groupedTools = useMemo(() => {
    const m = new Map<string, typeof paseoTools>();
    for (const t of paseoTools) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return [...m.entries()];
  }, [paseoTools]);

  const openDetail = useCallback(
    async (id: string) => {
      setSelected(id);
      setLoadingDetail(true);
      try {
        const d = await callRead({ agentId, serverId: id });
        setDetail({ raw: d.raw, redacted: d.redacted, path: d.path });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        setSelected(null);
      } finally {
        setLoadingDetail(false);
      }
    },
    [agentId, callRead, toast],
  );

  type HealthInfo = {
    serverId: string;
    name: string;
    status: "healthy" | "degraded" | "down" | "unknown";
    latencyMs: number;
    toolCount: number | null;
    tools: string[] | null;
    instructions: string | null;
    error: string | null;
  };

  const [healthMap, setHealthMap] = useState<Map<string, HealthInfo>>(new Map());
  const [healthMapLoading, setHealthMapLoading] = useState(false);

  // Background health check across all discovered servers when modal is open or data refreshes
  useEffect(() => {
    if (!open || !query.data?.servers || query.data.servers.length === 0) return;
    let active = true;
    setHealthMapLoading(true);
    callHealth({ agentId })
      .then((res) => {
        if (!active || !res?.results) return;
        const map = new Map<string, HealthInfo>();
        for (const r of res.results) {
          map.set(r.serverId, r);
          map.set(r.name, r);
        }
        setHealthMap(map);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setHealthMapLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, agentId, query.dataUpdatedAt, callHealth]);

  // When opening detail view, immediately show cached health if available, or fetch
  useEffect(() => {
    if (!selected) {
      setHealth(null);
      return;
    }
    const cached = healthMap.get(selected);
    if (cached) {
      setHealth(cached);
      setHealthLoading(false);
      return;
    }
    setHealthLoading(true);
    callHealth({ agentId, serverId: selected })
      .then((r) => setHealth(r.results[0] ?? null))
      .catch(() => setHealth(null))
      .finally(() => setHealthLoading(false));
  }, [selected, agentId, callHealth, healthMap]);

  const getStatusColor = (status?: "healthy" | "degraded" | "down" | "unknown") => {
    switch (status) {
      case "healthy":
        return theme.colors.statusSuccess;
      case "degraded":
        return theme.colors.statusWarning;
      case "down":
        return theme.colors.statusDanger;
      default:
        return theme.colors.foregroundMuted;
    }
  };

  const getStatusDot = (status?: "healthy" | "degraded" | "down" | "unknown") => {
    switch (status) {
      case "healthy":
        return "●";
      case "degraded":
        return "●";
      case "down":
        return "●";
      default:
        return "○";
    }
  };

  const copy = async (value: string) => {
    if (typeof navigator !== "undefined" && (navigator as unknown as { clipboard?: { writeText: (s: string) => Promise<void> } }).clipboard) {
      try {
        await (navigator as unknown as { clipboard: { writeText: (s: string) => Promise<void> } }).clipboard.writeText(value);
        toast.show("Copied");
        return;
      } catch {}
    }
    toast.show("Copy not available");
  };

  const lastCheck = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString() : null;
  const OuterScroll = ScrollView;

  return (
    <Modal title="MCP" icon={<Icon name="Plug" />} open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        {showDiagnostics ? (
          <View style={{ gap: 12, padding: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Pressable onPress={() => setShowDiagnostics(false)}>
                <Text style={{ color: theme.colors.accent }}>← Back to list</Text>
              </Pressable>
              <Pressable
                onPress={() => void runDiagnostics()}
                disabled={diagnosticsLoading}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.foregroundMuted,
                  opacity: diagnosticsLoading ? 0.6 : 1,
                }}
              >
                <Icon name="Activity" size={12} color={theme.colors.foregroundMuted} />
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Re-run</Text>
              </Pressable>
            </View>
            {diagnosticsLoading ? (
              <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Running host diagnostics…</Text>
              </View>
            ) : diagnosticData ? (
              <OuterScroll style={{ maxHeight: 420 }}>
                <View style={{ gap: 4, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.foregroundMuted + "18" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>Probe Diagnostic Report</Text>
                    <Pressable
                      onPress={() => void copy(JSON.stringify(diagnosticData, null, 2))}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        backgroundColor: theme.colors.foregroundMuted + "14",
                      }}
                    >
                      <Icon name="Copy" size={11} color={theme.colors.foregroundMuted} />
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Copy JSON</Text>
                    </Pressable>
                  </View>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    Provider: <Text style={{ color: theme.colors.foreground }}>{diagnosticData.provider}</Text>
                    {diagnosticData.probeLabel ? ` (${diagnosticData.probeLabel})` : " (no matching probe in registry)"}
                  </Text>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>CWD: {diagnosticData.cwd}</Text>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    Discovered Servers: <Text style={{ color: theme.colors.statusSuccess, fontWeight: "600" }}>{diagnosticData.discoveredServerCount}</Text>
                  </Text>
                  {diagnosticData.error ? (
                    <Text style={{ color: theme.colors.statusDanger, fontSize: 12, marginTop: 4 }}>Probe Error: {diagnosticData.error}</Text>
                  ) : null}
                </View>

                <View style={{ marginTop: 12, gap: 10 }}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textTransform: "uppercase" }}>Checked Paths & Targets</Text>
                  {diagnosticData.steps.map((step, idx) => (
                    <View
                      key={idx}
                      style={{
                        padding: 8,
                        borderRadius: 6,
                        backgroundColor:
                          step.status === "found"
                            ? theme.colors.statusSuccess + "14"
                            : step.status === "error"
                            ? theme.colors.statusDanger + "14"
                            : theme.colors.foregroundMuted + "08",
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500", flex: 1 }} numberOfLines={1}>
                          {step.target}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Pressable
                            onPress={() => void copy(step.contentPreview ?? step.target)}
                            style={{ padding: 2 }}
                          >
                            <Icon name="Copy" size={11} color={theme.colors.foregroundMuted} />
                          </Pressable>
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "600",
                              textTransform: "uppercase",
                              color:
                                step.status === "found"
                                ? theme.colors.statusSuccess
                                : step.status === "error"
                                ? theme.colors.statusDanger
                                : theme.colors.foregroundMuted,
                            }}
                          >
                            {step.status}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 2 }}>{step.details}</Text>
                      {step.contentPreview ? (
                        <Text
                          style={{
                            color: theme.colors.foregroundMuted,
                            fontSize: 10,
                            fontFamily: "monospace",
                            marginTop: 4,
                            backgroundColor: theme.colors.foregroundMuted + "10",
                            padding: 6,
                            borderRadius: 4,
                          }}
                          numberOfLines={6}
                        >
                          {step.contentPreview}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </OuterScroll>
            ) : null}
          </View>
        ) : selected ? (
          <View style={{ gap: 12, padding: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Pressable onPress={() => { setSelected(null); setDetail(null); }}>
                <Text style={{ color: theme.colors.accent }}>← Back to list</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const debugPayload = {
                    platform: Platform.OS,
                    selected,
                    server: servers.find((s) => s.id === selected),
                    health,
                    healthLoading,
                    detailPath: detail?.path,
                    hasHealthMapEntry: Boolean(healthMap.get(selected)),
                    rawHealthMapEntry: healthMap.get(selected),
                  };
                  void copy(JSON.stringify(debugPayload, null, 2));
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: theme.colors.foregroundMuted + "14",
                }}
              >
                <Icon name="Copy" size={11} color={theme.colors.foregroundMuted} />
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Copy Debug</Text>
              </Pressable>
            </View>
            {loadingDetail ? (
              <ActivityIndicator color={theme.colors.foregroundMuted} />
            ) : detail ? (
              <OuterScroll style={{ maxHeight: 420 }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>{servers.find((s) => s.id === selected)?.name ?? selected}</Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 }}>{detail.path}</Text>
                <Pressable onPress={() => void copy(detail.path)} style={{ marginTop: 4 }}>
                  <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Copy path</Text>
                </Pressable>
                {healthLoading ? (
                  <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Checking health…</Text>
                  </View>
                ) : health ? (
                  <View style={{ marginTop: 12, gap: 6, padding: 10, backgroundColor: theme.colors.foregroundMuted + "10", borderRadius: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
                        {health.status.toUpperCase()} · {health.latencyMs}ms · {health.toolCount ?? "?"} tools
                      </Text>
                      {health.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 11 }}>{health.error.slice(0, 120)}</Text> : null}
                    </View>
                    {health.instructions ? (
                      <View style={{ marginTop: 6, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "18", borderRadius: 6, padding: 8, backgroundColor: theme.colors.foregroundMuted + "06" }}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 }}>Instructions</Text>
                        <Text style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 16 }}>{health.instructions}</Text>
                      </View>
                    ) : (
                      <View style={{ marginTop: 6, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "18", borderRadius: 6, padding: 8, backgroundColor: theme.colors.foregroundMuted + "04" }}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontStyle: "italic" }}>No custom instructions provided by server</Text>
                      </View>
                    )}
                    {health.tools && health.tools.length > 0 ? (
                      <View style={{ marginTop: 6, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "18", borderRadius: 6, padding: 8, backgroundColor: theme.colors.foregroundMuted + "06" }}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 }}>
                          Available Tools ({health.tools.length})
                        </Text>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace", lineHeight: 15 }}>
                          {health.tools.join(", ")}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ marginTop: 6, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "18", borderRadius: 6, padding: 8, backgroundColor: theme.colors.foregroundMuted + "04" }}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontStyle: "italic" }}>
                          {health.toolCount === 0 ? "Server exports 0 tools" : "No tools listed"}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null}
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 12, fontFamily: "monospace" }}>{detail.redacted.slice(0, 4000)}</Text>
              </OuterScroll>
            ) : (
              <Text style={{ color: theme.colors.foregroundMuted }}>No detail</Text>
            )}
          </View>
        ) : (
          <View style={{ gap: 12, padding: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, flex: 1 }} numberOfLines={1}>
                {lastCheck ? `Last check ${lastCheck}` : "Never checked"}
                {query.data?.provider ? ` · provider: ${query.data.provider}` : ""}
                {query.isFetching ? " • checking…" : ""}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Pressable
                  onPress={() => void runDiagnostics()}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: theme.colors.foregroundMuted,
                  }}
                >
                  <Icon name="Activity" size={12} color={theme.colors.foregroundMuted} />
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Diagnose</Text>
                </Pressable>
                <Pressable
                  onPress={() => void query.refetch()}
                  disabled={query.isFetching}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: theme.colors.foregroundMuted,
                    opacity: query.isFetching ? 0.6 : 1,
                  }}
                >
                  <Icon name="RefreshCw" size={12} color={theme.colors.foregroundMuted} />
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Refresh</Text>
                </Pressable>
              </View>
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search servers & tools"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                color: theme.colors.foreground,
                borderWidth: 1,
                borderColor: theme.colors.foregroundMuted,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            />
            {query.isPending ? (
              <ActivityIndicator color={theme.colors.foregroundMuted} />
            ) : query.isError ? (
              <Text style={{ color: theme.colors.statusDanger }}>{(query.error as Error).message}</Text>
            ) : (
              <OuterScroll style={{ maxHeight: 380 }}>
                {servers.length === 0 && paseoTools.length === 0 ? (
                  <Text style={{ color: theme.colors.foregroundMuted }}>{term ? "No matches." : "No MCP servers found."}</Text>
                ) : null}
                {groupedServers.map(([label, items]) => (
                  <View key={label} style={{ marginTop: 12 }}>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>{label}</Text>
                    {items.map((s) => {
                      const h = healthMap.get(s.id) ?? healthMap.get(s.name);
                      const statusColor = getStatusColor(h?.status);
                      const statusDot = getStatusDot(h?.status);

                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => void openDetail(s.id)}
                          style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.foregroundMuted + "18" }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                              <Text style={{ color: statusColor, fontSize: 13, lineHeight: 14 }}>{statusDot}</Text>
                              <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{s.name}</Text>
                              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, backgroundColor: theme.colors.foregroundMuted + "18", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                                {s.transport}
                              </Text>
                              {s.hasSecrets ? <Icon name="KeyRound" size={12} color={theme.colors.foregroundMuted} /> : null}
                            </View>

                            {h ? (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text style={{ color: statusColor, fontSize: 11, fontWeight: "600", textTransform: "uppercase" }}>
                                  {h.status}
                                </Text>
                                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                                  {h.latencyMs}ms{h.toolCount !== null ? ` · ${h.toolCount} tools` : ""}
                                </Text>
                              </View>
                            ) : healthMapLoading ? (
                              <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
                            ) : null}
                          </View>
                          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                            {s.description || s.command || s.url || "—"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                {query.data?.cwd ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, marginTop: 12, fontFamily: "monospace" }}>{query.data.cwd}</Text>
                ) : null}
                {query.data?.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 11, marginTop: 6 }}>{query.data.error}</Text> : null}
                <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.foregroundMuted + "18", paddingTop: 8 }}>
                  <Pressable
                    onPress={() => setPaseoExpanded((v) => !v)}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 }}
                  >
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textTransform: "uppercase" }}>
                      Paseo catalog · {paseoTools.length} {paseoExpanded ? "" : "— tap to expand"}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{paseoExpanded ? "Hide" : "Show"}</Text>
                      <Icon name={paseoExpanded ? "ChevronUp" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
                    </View>
                  </Pressable>
                  {paseoExpanded
                    ? groupedTools.map(([cat, items]) => (
                        <View key={cat} style={{ marginTop: 10 }}>
                          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>Paseo · {cat}</Text>
                          {items.map((t) => (
                            <View key={t.name} style={{ paddingVertical: 4 }}>
                              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}>{t.name}</Text>
                              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{t.description}</Text>
                            </View>
                          ))}
                        </View>
                      ))
                    : null}
                </View>
              </OuterScroll>
            )}
          </View>
        )}
      </Modal.Content>
    </Modal>
  );
}

function McpPill({ theme, agentId }: PluginComposerPillProps) {
  const query = useMcpQuery(agentId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    openers.set(agentId, () => setOpen(true));
    return () => { openers.delete(agentId); };
  }, [agentId]);

  const label = useMemo(() => {
    if (!query.data) return "MCP";
    const n = query.data.servers.length;
    return n > 0 ? `MCP ${n}` : "MCP";
  }, [query.data]);

  return (
    <>
      <Icon name="Plug" size={14} color={theme.colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, flexShrink: 1 }}>
        {label}
      </Text>
      <McpModal agentId={agentId} open={open} onOpenChange={setOpen} theme={theme} />
    </>
  );
}

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();

  function addPill(agentId: string, workspaceId: string) {
    if (pills.has(agentId)) return;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "mcp-tools",
        title: "MCP",
        workspaceId,
        agentId,
        Component: McpPill,
        onPress() {
          const opener = openers.get(agentId);
          if (opener) opener();
        },
      }),
    );
  }

  function removePill(agentId: string) {
    pills.get(agentId)?.();
    pills.delete(agentId);
    openers.delete(agentId);
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      removePill(update.agentId);
      return;
    }
    const { id, workspaceId } = update.agent;
    if (workspaceId) addPill(id, workspaceId);
  });

  client.paseo.agents
    .list()
    .then((result) => {
      result.entries.forEach(({ agent }) => {
        if (agent.workspaceId) addPill(agent.id, agent.workspaceId);
      });
    })
    .catch((e) => console.error("mcp-tools: seed pills failed", e));

  return () => {
    unsubscribe();
    pills.forEach((remove) => remove());
    pills.clear();
  };
}
