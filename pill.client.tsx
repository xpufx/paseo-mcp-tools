import { useToast } from "@getpaseo/plugin/react-native";
import type { PluginClientContext } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  AboutSection,
  ActionBar,
  Badge,
  Button,
  Card,
  CodeBlock,
  EmptyState,
  FormRow,
  ModalBody,
  PluginThemeProvider,
  SearchInput,
  StatusDot,
  Tabs,
  TextInput,
  Toggle,
  copyToClipboard,
  registerComposerPill,
  triggerHaptic,
  usePluginSettings,
  usePluginTheme,
  useResponsive,
  type RenderModalProps,
  type RenderPillProps,
  type TabItem,
} from "paseo-plugin-helper/client";
import { useMcpHealthQuery, useMcpQuery } from "./mcp-query.client";
import {
  callMcpTool,
  diagnoseMcp,
  mcpToolsSettingsContract,
  readMcp,
  type ToolInfo,
} from "./mcp.shared";
import { PLUGIN_VERSION } from "./version";

type HealthInfo = {
  serverId: string;
  name: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs: number;
  toolCount: number | null;
  tools: string[] | null;
  toolDetails?: ToolInfo[] | null;
  instructions: string | null;
  error: string | null;
};

const TABS: TabItem[] = [
  { id: "servers", label: "Servers", shortLabel: "Servers", icon: "Plug" },
  { id: "diagnostics", label: "Diagnostics", shortLabel: "Diag", icon: "Activity" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
  { id: "about", label: "About", shortLabel: "About", icon: "Info" },
];

function McpPillBody(props: RenderPillProps) {
  const { colors } = usePluginTheme();
  const { isCompact } = useResponsive();
  const { data } = useMcpQuery(props.agentId);
  const n = data?.servers.length ?? 0;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 }}>
      <StatusDot variant={n > 0 ? "success" : "neutral"} />
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.foregroundMuted, flexShrink: 1 }}>
        {isCompact ? (n > 0 ? `${n}` : "MCP") : n > 0 ? `MCP ${n}` : "MCP"}
      </Text>
    </View>
  );
}

function McpModalContent({ agentId, close, theme, layout }: RenderModalProps) {
  const { colors } = usePluginTheme();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("servers");
  const { settings, updateSettings, resetSettings, isUpdating } =
    usePluginSettings(mcpToolsSettingsContract);

  const query = useMcpQuery(agentId);
  const callRead = useRpc(readMcp);
  const callToolRpc = useRpc(callMcpTool);
  const callDiagnose = useRpc(diagnoseMcp);

  const [modalOpen] = useState(true);
  const healthQuery = useMcpHealthQuery(agentId, undefined, {
    isOpen: modalOpen,
    rate: settings.healthPollingRate,
  });

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ raw: string; redacted: string; path: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolInfo | null>(null);
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const [toolExecuting, setToolExecuting] = useState(false);
  const [toolResult, setToolResult] = useState<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  } | null>(null);
  const [toolSearch, setToolSearch] = useState("");

  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<{
    provider: string;
    cwd: string;
    probeId: string | null;
    probeLabel: string | null;
    steps: Array<{
      target: string;
      status: "found" | "missing" | "error" | "skipped";
      details: string;
      contentPreview: string | null;
    }>;
    discoveredServerCount: number;
    error: string | null;
  } | null>(null);

  const copy = (value: string, label = "Value") =>
    copyToClipboard(value, { toast, toastMessage: label });

  const healthMap = useMemo(() => {
    const map = new Map<string, HealthInfo>();
    for (const r of healthQuery.data?.results ?? []) {
      map.set(r.serverId, r as HealthInfo);
      map.set(r.name, r as HealthInfo);
    }
    return map;
  }, [healthQuery.data]);

  const health = selected ? healthMap.get(selected) ?? null : null;
  const healthLoading = healthQuery.isFetching && !health;

  const runDiagnostics = async () => {
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

  const groupedServers = useMemo(() => {
    const m = new Map<string, typeof servers>();
    for (const s of servers) {
      const k = s.source.label;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()];
  }, [servers]);

  const filteredTools = useMemo(() => {
    if (!health?.tools) return [];
    if (!toolSearch.trim()) return health.tools;
    const q = toolSearch.toLowerCase().trim();
    return health.tools.filter((toolName) => {
      if (toolName.toLowerCase().includes(q)) return true;
      const details = health.toolDetails?.find((d) => d.name === toolName);
      if (details?.description?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [health?.tools, health?.toolDetails, toolSearch]);

  const resetExecutionState = () => {
    setActiveTool(null);
    setToolArgs({});
    setToolResult(null);
  };

  const openDetail = async (id: string) => {
    resetExecutionState();
    setSelected(id);
    setToolSearch("");
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
  };

  const backToList = () => {
    setSelected(null);
    setDetail(null);
    setToolSearch("");
    resetExecutionState();
  };

  const openToolRunner = (toolName: string) => {
    triggerHaptic("light");
    const details = health?.toolDetails?.find((d) => d.name === toolName);
    const toolObj: ToolInfo = details ?? { name: toolName };
    setActiveTool(toolObj);
    const initialArgs: Record<string, string> = {};
    if (toolObj.inputSchema?.properties) {
      for (const [key, prop] of Object.entries(toolObj.inputSchema.properties)) {
        if (prop.default !== undefined) {
          initialArgs[key] = typeof prop.default === "object" ? JSON.stringify(prop.default) : String(prop.default);
        } else {
          initialArgs[key] = "";
        }
      }
    }
    setToolArgs(initialArgs);
    setToolResult(null);
  };

  const handleExecuteTool = async () => {
    if (!activeTool || !selected) return;

    const required = activeTool.inputSchema?.required ?? [];
    const missing = required.filter((req) => !toolArgs[req]?.trim());
    if (missing.length > 0) {
      toast.error(`Missing required parameter(s): ${missing.join(", ")}`);
      return;
    }

    const parsedArgs: Record<string, unknown> = {};
    const props = activeTool.inputSchema?.properties ?? {};
    for (const [key, val] of Object.entries(toolArgs)) {
      if (!val && !required.includes(key)) continue;
      const typeRaw = props[key]?.type;
      const type = Array.isArray(typeRaw) ? typeRaw.find((t) => t !== "null") ?? typeRaw[0] : typeRaw;
      if (type === "number" || type === "integer") {
        const n = Number(val);
        parsedArgs[key] = isNaN(n) ? val : n;
      } else if (type === "boolean") {
        parsedArgs[key] = val.toLowerCase() === "true" || val === "1";
      } else if (type === "array" || type === "object") {
        try {
          parsedArgs[key] = JSON.parse(val);
        } catch {
          parsedArgs[key] = val;
        }
      } else {
        parsedArgs[key] = val;
      }
    }

    setToolExecuting(true);
    try {
      triggerHaptic("medium");
      const res = await callToolRpc({
        agentId,
        serverId: selected,
        toolName: activeTool.name,
        arguments: parsedArgs,
      });
      setToolResult(res);
      if (res.isError) {
        triggerHaptic("error");
        toast.error("Tool returned an error");
      } else {
        triggerHaptic("success");
        toast.show("Tool executed successfully");
      }
    } catch (e) {
      triggerHaptic("error");
      setToolResult({
        content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      });
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setToolExecuting(false);
    }
  };

  const statusVariant = (status?: string) =>
    status === "healthy" ? "success" as const
    : status === "degraded" ? "warning" as const
    : status === "down" ? "danger" as const
    : "neutral" as const;

  const lastCheck = healthQuery.dataUpdatedAt
    ? new Date(healthQuery.dataUpdatedAt).toLocaleTimeString()
    : null;

  const renderServers = () => {
    if (selected) {
      const server = servers.find((s) => s.id === selected);
      if (activeTool) {
        return (
          <View key={`runner:${selected}:${activeTool.name}`} style={{ gap: 12 }}>
            <Button
              label="← Back to server"
              variant="ghost"
              size="sm"
              onPress={() => {
                resetExecutionState();
              }}
            />
            <Card>
              <Card.Header title={activeTool.name} icon="Play" />
              {activeTool.description ? (
                <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>
                  {activeTool.description}
                </Text>
              ) : null}
            </Card>

            <Card>
              <Card.Header
                title={`Parameters (${activeTool.inputSchema?.properties ? Object.keys(activeTool.inputSchema.properties).length : 0})`}
              />
              {activeTool.inputSchema?.properties && Object.keys(activeTool.inputSchema.properties).length > 0 ? (
                <View style={{ gap: 10 }}>
                  {Object.entries(activeTool.inputSchema.properties).map(([paramName, prop]) => {
                    const isRequired = (activeTool.inputSchema?.required ?? []).includes(paramName);
                    const typeRaw = prop.type;
                    const typeLabel = Array.isArray(typeRaw) ? typeRaw.join(" | ") : typeRaw;
                    const isStructured =
                      typeRaw === "object" || typeRaw === "array" ||
                      (Array.isArray(typeRaw) && (typeRaw.includes("object") || typeRaw.includes("array")));
                    return (
                      <TextInput
                        key={paramName}
                        label={`${paramName}${isRequired ? " *" : ""}${typeLabel ? ` (${typeLabel})` : ""}`}
                        helperText={prop.description}
                        errorText={isRequired && !(toolArgs[paramName]?.trim()) ? "Required" : undefined}
                        value={toolArgs[paramName] ?? ""}
                        onChangeText={(text) => setToolArgs((prev) => ({ ...prev, [paramName]: text }))}
                        placeholder={prop.default !== undefined ? String(prop.default) : isRequired ? "Required value..." : "Optional value..."}
                        autoCapitalize="none"
                        autoCorrect={false}
                        multiline={isStructured}
                        mono={isStructured}
                      />
                    );
                  })}
                </View>
              ) : (
                <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontStyle: "italic" }}>
                  This tool takes no parameters.
                </Text>
              )}
              <Button
                label={toolExecuting ? "Executing tool…" : "Execute Tool"}
                variant="primary"
                icon="Play"
                loading={toolExecuting}
                disabled={toolExecuting}
                onPress={() => void handleExecuteTool()}
              />
            </Card>

            {toolResult ? (
              <Card>
                <Card.Header
                  title={toolResult.isError ? "✕ Execution Failed" : "✓ Result"}
                  badge={
                    <Badge
                      label={toolResult.isError ? "error" : "ok"}
                      variant={toolResult.isError ? "danger" : "success"}
                    />
                  }
                />
                <CodeBlock
                  language="json"
                  code={toolResult.content.map((c) => c.text ?? JSON.stringify(c, null, 2)).join("\n\n")}
                  copyable
                />
              </Card>
            ) : null}
          </View>
        );
      }
      if (loadingDetail) {
        return (
          <View style={{ padding: 24, alignItems: "center" }}>
            <ActivityIndicator color={colors.foregroundMuted} />
          </View>
        );
      }
      if (!detail) {
        return <EmptyState icon="Plug" title="No detail" description="Could not load server detail." />;
      }
      return (
        <View style={{ gap: 12 }}>
          <Button label="← Back to list" variant="ghost" size="sm" onPress={backToList} />
          <Card>
            <Card.Header
              title={server?.name ?? selected}
              badge={server ? <Badge label={server.transport} variant="neutral" /> : undefined}
            />
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
              {detail.path}
            </Text>
            {healthLoading ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color={colors.foregroundMuted} />
                <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Checking health…</Text>
              </View>
            ) : health ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <StatusDot variant={statusVariant(health.status)} />
                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>
                  {health.latencyMs}ms · {health.toolCount ?? "?"} tools
                </Text>
                {health.error ? (
                  <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{health.error.slice(0, 120)}</Text>
                ) : null}
              </View>
            ) : null}
          </Card>

          {health?.instructions ? (
            <Card>
              <Card.Header title="Instructions" />
              <Text selectable style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>
                {health.instructions}
              </Text>
            </Card>
          ) : null}

          {health?.tools && health.tools.length > 0 ? (
            <Card>
              <Card.Header
                title={`Available Tools (${filteredTools.length}${filteredTools.length !== health.tools.length ? ` of ${health.tools.length}` : ""}) — tap to run`}
              />
              <SearchInput
                value={toolSearch}
                onChangeText={setToolSearch}
                placeholder="Filter tools by name or description..."
              />
              {filteredTools.length === 0 ? (
                <EmptyState
                  icon="Search"
                  title="No tools match"
                  description={`Nothing matches "${toolSearch}"`}
                />
              ) : (
                <View style={{ gap: 6 }}>
                  {filteredTools.map((toolName) => {
                    const details = health?.toolDetails?.find((d) => d.name === toolName);
                    return (
                      <Button
                        key={toolName}
                        label={details?.description ? `${toolName} — ${details.description}` : toolName}
                        variant="ghost"
                        size="sm"
                        icon="Play"
                        onPress={() => openToolRunner(toolName)}
                      />
                    );
                  })}
                </View>
              )}
            </Card>
          ) : null}

          <Card>
            <Card.Header title="Raw Config (redacted)" />
            <CodeBlock language="json" code={detail.redacted} maxHeight={240} copyable />
          </Card>
        </View>
      );
    }

    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11, flex: 1 }} numberOfLines={1}>
            {lastCheck ? `Last check ${lastCheck}` : "Never checked"}
            {query.data?.provider ? ` · ${query.data.provider}` : ""}
            {` · ${PLUGIN_VERSION}`}
            {query.isFetching ? " • checking…" : ""}
          </Text>
          <ActionBar align="flex-end">
            <Button
              label="Diagnose"
              variant="ghost"
              size="sm"
              icon="Activity"
              onPress={() => {
                triggerHaptic("light");
                setActiveTab("diagnostics");
                void runDiagnostics();
              }}
            />
            <Button
              label="Refresh"
              variant="ghost"
              size="sm"
              icon="RefreshCw"
              loading={query.isFetching}
              disabled={query.isFetching}
              onPress={() => void query.refetch()}
            />
          </ActionBar>
        </View>
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search servers & tools"
        />
        {query.isPending ? (
          <ActivityIndicator color={colors.foregroundMuted} />
        ) : query.isError ? (
          <Text style={{ color: colors.statusDanger }}>{(query.error as Error).message}</Text>
        ) : servers.length === 0 ? (
          <EmptyState
            icon="Plug"
            title={term ? "No matches" : "No MCP servers found"}
            description={term ? `Nothing matches "${term}"` : "No MCP servers discovered for this agent session."}
          />
        ) : (
          <View>
            {groupedServers.map(([label, items]) => (
              <View key={label} style={{ marginTop: 12 }}>
                <Text style={{ color: colors.foregroundMuted, fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>
                  {label}
                </Text>
                {items.map((s) => {
                  const h = healthMap.get(s.id) ?? healthMap.get(s.name);
                  return (
                    <Button
                      key={s.id}
                      label={`${s.name} · ${s.transport}${h && h.toolCount !== null ? ` · ${h.toolCount} tools` : ""}${h ? ` · ${h.latencyMs}ms` : ""}`}
                      variant="ghost"
                      size="sm"
                      icon="Plug"
                      onPress={() => void openDetail(s.id)}
                    />
                  );
                })}
              </View>
            ))}
            {query.data?.cwd ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: 10, marginTop: 12, fontFamily: "monospace" }}>
                {query.data.cwd}
              </Text>
            ) : null}
            {query.data?.error ? (
              <Text style={{ color: colors.statusDanger, fontSize: 11, marginTop: 6 }}>{query.data.error}</Text>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  const renderDiagnostics = () => (
    <View style={{ gap: 12 }}>
      <ActionBar align="flex-end">
        <Button
          label="Re-run"
          variant="ghost"
          size="sm"
          icon="Activity"
          loading={diagnosticsLoading}
          disabled={diagnosticsLoading}
          onPress={() => void runDiagnostics()}
        />
      </ActionBar>
      {diagnosticsLoading ? (
        <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Running host diagnostics…</Text>
        </View>
      ) : diagnosticData ? (
        <View style={{ gap: 12 }}>
          <Card>
            <Card.Header
              title={`Probe Diagnostic Report (${PLUGIN_VERSION})`}
              badge={<Badge label={`${diagnosticData.discoveredServerCount} servers`} variant="success" />}
            />
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              Provider: {diagnosticData.provider}
              {diagnosticData.probeLabel ? ` (${diagnosticData.probeLabel})` : " (no matching probe in registry)"}
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
              CWD: {diagnosticData.cwd}
            </Text>
            {diagnosticData.error ? (
              <Text style={{ color: colors.statusDanger, fontSize: 12, marginTop: 4 }}>
                Probe Error: {diagnosticData.error}
              </Text>
            ) : null}
            <CodeBlock language="json" code={JSON.stringify(diagnosticData, null, 2)} maxHeight={200} copyable />
          </Card>

          {diagnosticData.steps.map((step, idx) => (
            <Card key={idx}>
              <Card.Header
                title={step.target}
                badge={<Badge label={step.status} variant={statusVariant(step.status === "found" ? "healthy" : step.status === "error" ? "down" : "unknown")} />}
              />
              <Text style={{ color: colors.foregroundMuted, fontSize: 11, marginTop: 2 }}>{step.details}</Text>
              {step.contentPreview ? (
                <CodeBlock language="json" code={step.contentPreview} maxHeight={160} copyable />
              ) : null}
            </Card>
          ))}
        </View>
      ) : (
        <EmptyState
          icon="Activity"
          title="No diagnostics yet"
          description="Run host diagnostics to inspect provider MCP probes."
          actionLabel="Run Diagnostics" onAction={() => void runDiagnostics()}
        />
      )}
    </View>
  );

  const renderSettings = () => (
    <View style={{ gap: 12 }}>
      <Card>
        <Card.Header title="Health Polling" subtitle="Background refresh rate for server health" />
        <FormRow label="Polling rate" description="Paused disables background health polling">
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {(["1s", "2s", "5s", "10s", "15s", "30s", "60s", "5m", "paused"] as const).map((r) => (
              <Button
                key={r}
                label={r}
                size="sm"
                variant={settings.healthPollingRate === r ? "primary" : "ghost"}
                onPress={() => {
                  triggerHaptic("light");
                  updateSettings({ healthPollingRate: r });
                }}
              />
            ))}
          </View>
        </FormRow>
      </Card>

      <Card>
        <Card.Header title="Visual Flair" subtitle="Corner radius, density, surface and accent" />
        <FormRow label="Corner radius" description={`Active preset: "${settings.flairRadius}"`}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {(["sharp", "rounded", "pill"] as const).map((r) => (
              <Button
                key={r}
                label={r.toUpperCase()}
                size="sm"
                variant={settings.flairRadius === r ? "primary" : "ghost"}
                onPress={() => {
                  triggerHaptic("light");
                  updateSettings({ flairRadius: r });
                }}
              />
            ))}
          </View>
        </FormRow>
        <FormRow label="Layout density" description={`Active density: "${settings.flairDensity}"`}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {(["compact", "comfortable", "spacious"] as const).map((d) => (
              <Button
                key={d}
                label={d.charAt(0).toUpperCase() + d.slice(1)}
                size="sm"
                variant={settings.flairDensity === d ? "primary" : "ghost"}
                onPress={() => {
                  triggerHaptic("light");
                  updateSettings({ flairDensity: d });
                }}
              />
            ))}
          </View>
        </FormRow>
        <FormRow label="Surface treatment" description={`Active surface: "${settings.flairSurface}"`}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {(["flat", "tinted", "elevated"] as const).map((s) => (
              <Button
                key={s}
                label={s.charAt(0).toUpperCase() + s.slice(1)}
                size="sm"
                variant={settings.flairSurface === s ? "primary" : "ghost"}
                onPress={() => {
                  triggerHaptic("light");
                  updateSettings({ flairSurface: s });
                }}
              />
            ))}
          </View>
        </FormRow>
        <FormRow label="Brand accent color" description={`Current accent: ${settings.flairAccentColor}`}>
          <TextInput
            value={settings.flairAccentColor}
            onChangeText={(text) => updateSettings({ flairAccentColor: text })}
            placeholder="#6366f1"
            mono
          />
        </FormRow>
      </Card>

      <ActionBar align="space-between">
        <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>
          {isUpdating ? "Saving to disk..." : "Saved to settings.json atomically"}
        </Text>
        <Button
          label="Reset Defaults"
          variant="secondary"
          size="sm"
          onPress={() => {
            triggerHaptic("warning");
            void resetSettings();
          }}
        />
      </ActionBar>
    </View>
  );

  return (
    <PluginThemeProvider
      theme={{ ...theme, colors: { ...theme.colors, accent: settings.flairAccentColor } }}
      layout={layout}
      flair={{
        radius: settings.flairRadius,
        density: settings.flairDensity,
        surfaceStyle: settings.flairSurface,
        accentColor: settings.flairAccentColor,
      }}
    >
    <ModalBody refreshing={query.isFetching} onRefresh={() => void query.refetch()}>
      <Tabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(tab) => {
          triggerHaptic("light");
          setActiveTab(tab);
        }}
        mode="auto"
      />
      {activeTab === "servers" ? renderServers() : null}
      {activeTab === "diagnostics" ? renderDiagnostics() : null}
      {activeTab === "settings" ? renderSettings() : null}
      {activeTab === "about" ? (
        <AboutSection
          name="MCP Tools"
          description="Live MCP server inspector, health probes, diagnostics and tool runner for Paseo agents."
          version={PLUGIN_VERSION}
          author="xpufx"
          repository="https://github.com/xpufx/paseo-mcp-tools"
          license="MIT"
          logo="Plug"
          extraItems={[
            { label: "Servers", value: `${query.data?.servers.length ?? 0}`, copyable: false },
            { label: "Provider", value: query.data?.provider ?? "unknown", copyable: true },
            { label: "Health Polling", value: settings.healthPollingRate, copyable: false },
          ]}
        />
      ) : null}
      <ActionBar align="flex-end">
        <Button
          label="Close"
          variant="ghost"
          onPress={() => {
            triggerHaptic("light");
            close();
          }}
        />
      </ActionBar>
    </ModalBody>
    </PluginThemeProvider>
  );
}

export function contributeClient(client: PluginClientContext) {
  return registerComposerPill(client, {
    id: "mcp-tools",
    title: "MCP",
    compactTitle: "MCP",
    modalTitle: "MCP Tools",
    icon: "Plug",
    flair: {
      radius: "rounded",
      density: "comfortable",
      accentColor: "#6366f1",
    },
    renderPill: (props) => <McpPillBody {...props} />,
    renderModal: (props) => <McpModalContent {...props} />,
  });
}
