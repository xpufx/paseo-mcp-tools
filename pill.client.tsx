import { Icon, Modal, useToast } from "@getpaseo/plugin/react-native";
import type { PluginClientContext, PluginComposerPillProps } from "@getpaseo/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMcpQuery } from "./mcp-query.client";
import { useRpc } from "@getpaseo/plugin";
import { checkMcpHealth, readMcp } from "./mcp.shared";

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
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ raw: string; redacted: string; path: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [health, setHealth] = useState<{ instructions: string | null; status: string; latencyMs: number; toolCount: number | null; tools: string[] | null; error: string | null } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [paseoExpanded, setPaseoExpanded] = useState(false);

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

  useEffect(() => {
    if (!selected) {
      setHealth(null);
      return;
    }
    setHealthLoading(true);
    callHealth({ agentId, serverId: selected })
      .then((r) => setHealth(r.results[0] ?? null))
      .catch(() => setHealth(null))
      .finally(() => setHealthLoading(false));
  }, [selected, agentId, callHealth]);

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
        {selected ? (
          <View style={{ gap: 12, padding: 16 }}>
            <Pressable onPress={() => { setSelected(null); setDetail(null); }}>
              <Text style={{ color: theme.colors.accent }}>← Back to list</Text>
            </Pressable>
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
                      Platform.OS === "web" ? (
                        <ScrollView
                          style={{ maxHeight: 120, marginTop: 4, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "18", borderRadius: 6, padding: 8 }}
                          contentContainerStyle={{ flexGrow: 1 }}
                          nestedScrollEnabled
                          overScrollMode="always"
                          showsVerticalScrollIndicator
                          bounces={false}
                        >
                          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{health.instructions}</Text>
                        </ScrollView>
                      ) : (
                        <View style={{ marginTop: 4, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "18", borderRadius: 6, padding: 8 }}>
                          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{health.instructions}</Text>
                        </View>
                      )
                    ) : (
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontStyle: "italic" }}>No instructions advertised.</Text>
                    )}
                    {health.tools && health.tools.length > 0 ? (
                      Platform.OS === "web" ? (
                        <ScrollView
                          style={{ maxHeight: 80, marginTop: 4, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "10", borderRadius: 6, padding: 6 }}
                          contentContainerStyle={{ flexGrow: 1 }}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                          overScrollMode="always"
                        >
                          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>{health.tools.slice(0, 30).join(", ")}</Text>
                        </ScrollView>
                      ) : (
                        <View style={{ marginTop: 4, borderWidth: 1, borderColor: theme.colors.foregroundMuted + "10", borderRadius: 6, padding: 6 }}>
                          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>{health.tools.slice(0, 30).join(", ")}</Text>
                        </View>
                      )
                    ) : null}
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
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                {lastCheck ? `Last check ${lastCheck}` : "Never checked"}
                {query.data?.provider ? ` · provider: ${query.data.provider}` : ""}
                {query.isFetching ? " • checking…" : ""}
              </Text>
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
                    {items.map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => void openDetail(s.id)}
                        style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.foregroundMuted + "18" }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{s.name}</Text>
                          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, backgroundColor: theme.colors.foregroundMuted + "18", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                            {s.transport}
                          </Text>
                          {s.hasSecrets ? <Icon name="KeyRound" size={12} color={theme.colors.foregroundMuted} /> : null}
                        </View>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                          {s.description || s.command || s.url || "—"}
                        </Text>
                      </Pressable>
                    ))}
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
