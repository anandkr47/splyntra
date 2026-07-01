// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAgents, useTraces } from "@/lib/hooks";
import { AgentItem } from "@/lib/api";
import { TraceList } from "@/components/trace/TraceList";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui/primitives";
import { Select } from "@/components/ui/Select";
import { Bot, ArrowLeft, Activity, AlertCircle, Clock, Coins, DollarSign, ShieldAlert } from "lucide-react";

const WINDOWS = [
  { label: "All time", value: 0 },
  { label: "Last 24h", value: 86400 },
  { label: "Last 7d", value: 604800 },
  { label: "Last 30d", value: 2592000 },
];

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = decodeURIComponent(String(params.agentId || ""));
  const [windowSec, setWindowSec] = useState(0);

  const { data: agentsData, isLoading: agentsLoading } = useAgents(windowSec || undefined);
  const agent: AgentItem | undefined = useMemo(
    () => agentsData?.agents.find((a) => a.agent_id === agentId),
    [agentsData, agentId]
  );

  const { data: tracesData, isLoading: tracesLoading } = useTraces({
    agentId,
    since: windowSec || undefined,
    limit: 25,
  });
  const traces = tracesData?.traces || [];

  const errorRate = agent && agent.trace_count > 0 ? ((agent.error_count / agent.trace_count) * 100).toFixed(1) : "0.0";
  const risk = Math.round(agent?.avg_risk || 0);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Link href="/agents" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All agents
      </Link>

      <PageHeader
        icon={Bot}
        title={agent?.name || agentId}
        subtitle={agent?.framework ? `${agent.framework} agent` : "Agent detail"}
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

      {agentsLoading && !agent ? (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : !agent ? (
        <Card className="mb-6">
          <EmptyState icon={Bot} title="No data for this agent in the selected window">
            Try a wider time range, or send traces tagged with this agent.
          </EmptyState>
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
          <StatCard label="Traces" value={agent.trace_count.toLocaleString()} icon={Activity} />
          <StatCard label="Error Rate" value={`${errorRate}%`} icon={AlertCircle} accent={agent.error_count > 0 ? "text-red-600" : undefined} />
          <StatCard label="P95 Latency" value={`${Math.round(agent.p95_latency_ms)}ms`} icon={Clock} />
          <StatCard label="Tokens" value={agent.total_tokens.toLocaleString()} icon={Coins} />
          <StatCard label="Cost" value={`$${agent.total_cost.toFixed(2)}`} icon={DollarSign} />
          <StatCard label="Avg Risk" value={risk} icon={ShieldAlert} accent={risk >= 50 ? "text-red-600" : risk >= 25 ? "text-amber-600" : undefined} />
        </div>
      )}

      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-gray-500">Recent traces</h2>
      {tracesLoading ? <TableSkeleton rows={5} cols={8} /> : <TraceList traces={traces} />}
    </div>
  );
}
