// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAgents } from "@/lib/hooks";
import { AgentItem } from "@/lib/api";
import { Bot, CheckCircle2, AlertCircle, ShieldAlert } from "lucide-react";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";

const WINDOWS = [
  { label: "All time", value: 0 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
  { label: "Last 30d", value: 2592000 },
];

export default function AgentsPage() {
  const [windowSec, setWindowSec] = useState(0);
  const { data, isLoading, error } = useAgents(windowSec || undefined);

  const agents: AgentItem[] = data?.agents || [];
  const hasRealData = !error && agents.length > 0;

  const totalAgents = agents.length;
  const activeAgents = agents.filter((a) => {
    const lastSeen = new Date(a.last_seen_at);
    return Date.now() - lastSeen.getTime() < 5 * 60 * 1000;
  }).length;
  const errorAgents = agents.filter((a) => a.error_count > 0).length;
  const avgRisk = totalAgents > 0
    ? Math.round(agents.reduce((sum, a) => sum + (a.avg_risk || 0), 0) / totalAgents)
    : 0;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        icon={Bot}
        title="Agents"
        subtitle="Monitor registered agents across environments"
        action={
          <Select
            value={String(windowSec)}
            onValueChange={(v) => setWindowSec(Number(v))}
            ariaLabel="Time window"
            className="min-w-[150px]"
            options={WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))}
          />
        }
      />
      {!hasRealData && !isLoading && (
        <p className="-mt-2 mb-4 text-xs text-amber-600">
          No agent data yet — send traces with agent names to populate.
        </p>
      )}

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Agents" value={totalAgents} icon={Bot} />
        <StatCard label="Active" value={activeAgents} icon={CheckCircle2} accent="text-emerald-600" />
        <StatCard label="With Errors" value={errorAgents} icon={AlertCircle} accent="text-red-600" />
        <StatCard label="Avg Risk" value={avgRisk} icon={ShieldAlert} accent="text-orange-600" />
      </div>

      {/* Agent table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading agents…</div>
        ) : agents.length === 0 ? (
          <EmptyState icon={Bot} title="No agents found">
            Send traces to your collector to see agents here.
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Agent</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Traces</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Errors</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Avg Latency</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">P95 Latency</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Cost</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Detections</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Avg Risk</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agents.map((agent) => {
                const errorRate = agent.trace_count > 0
                  ? ((agent.error_count / agent.trace_count) * 100).toFixed(1)
                  : "0.0";
                const isActive = Date.now() - new Date(agent.last_seen_at).getTime() < 5 * 60 * 1000;
                const hasErrors = agent.error_count > 0;

                return (
                  <tr key={agent.agent_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/agents/${encodeURIComponent(agent.agent_id)}`}
                        className="text-gray-900 hover:text-splyntra-600 hover:underline dark:text-white dark:hover:text-splyntra-400"
                      >
                        {agent.name || agent.agent_id}
                      </Link>
                      {agent.framework && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-splyntra-50 text-splyntra-700">
                          {agent.framework}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={hasErrors ? "error" : isActive ? "active" : "idle"} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {agent.trace_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={agent.error_count > 0 ? "text-red-600 font-medium" : "text-gray-600"}>
                        {agent.error_count} ({errorRate}%)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {Math.round(agent.avg_latency_ms)}ms
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {Math.round(agent.p95_latency_ms)}ms
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      ${agent.total_cost.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {agent.detection_count > 0 ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                          {agent.detection_count}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const r = Math.round(agent.avg_risk || 0);
                        const cls = r >= 60
                          ? "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                          : r >= 30
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
                        return <span className={`rounded px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}>{r}</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">
                      {formatRelativeTime(agent.last_seen_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: "active" | "idle" | "error" }) {
  const styles = {
    active: "bg-green-100 text-green-700",
    idle: "bg-gray-100 text-gray-600",
    error: "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}
