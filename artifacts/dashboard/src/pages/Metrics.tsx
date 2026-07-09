import React, { useState } from 'react';
import { useListMetrics, useListProjects } from '@workspace/api-client-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { BarChart3, AlertTriangle } from 'lucide-react';

export default function Metrics() {
  const { data: projects } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const effectiveProjectId = selectedProjectId || (projects?.[0]?.id ?? '');

  const { data: metrics, isLoading } = useListMetrics(
    { projectId: effectiveProjectId },
    { query: { enabled: !!effectiveProjectId, staleTime: 30_000 } },
  );

  const formatData =
    metrics?.map((m) => ({
      ...m,
      date: new Date(m.timestamp).toLocaleDateString(),
    })) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" /> Metrics & Telemetry
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Historical quality trends and analysis.</p>
        </div>
        <div>
          <select
            value={effectiveProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none w-64 font-medium"
          >
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!effectiveProjectId ? (
        <div className="h-64 bg-card border border-border rounded-xl flex items-center justify-center text-muted-foreground">
          Select a project to view metrics.
        </div>
      ) : isLoading ? (
        <div className="h-96 bg-card border border-border rounded-xl animate-pulse"></div>
      ) : formatData.length === 0 ? (
        <div className="h-64 bg-card border border-border rounded-xl flex flex-col items-center justify-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
          <p>No historical metrics data for this project yet.</p>
          <p className="text-xs mt-1 opacity-70">Trigger a scan to generate the first snapshot.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold mb-6">Overall Quality Trend</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={formatData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Line
                    type="monotone"
                    dataKey="overallScore"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={false}
                    name="Total Score"
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="architectureScore"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    name="Architecture"
                  />
                  <Line
                    type="monotone"
                    dataKey="securityScore"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    name="Security"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="font-semibold mb-6">Test Coverage vs Lint Issues</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={formatData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar
                      yAxisId="left"
                      dataKey="testCoverage"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                      name="Coverage %"
                    />
                    <Bar
                      yAxisId="right"
                      dataKey="lintIssues"
                      fill="hsl(var(--destructive))"
                      radius={[4, 4, 0, 0]}
                      name="Lint Issues"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="font-semibold mb-6">Technical Debt (Hours)</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formatData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Line
                      type="step"
                      dataKey="technicalDebt"
                      stroke="#8b5cf6"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      name="Tech Debt Est."
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
