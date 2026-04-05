"use client";

import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Bar, BarChart, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import type { WeekTrendItem } from "@/lib/services/reports";

const chartConfig = {
  completed: { label: "Готово", color: "#22c55e" },
  inProgress: { label: "В работе", color: "#eab308" },
  new: { label: "Новая", color: "#ef4444" },
} satisfies ChartConfig;

interface ReportChartProps {
  data: WeekTrendItem[];
}

export function ReportChart({ data }: ReportChartProps) {
  const chartData = data.map((item) => ({
    week: format(new Date(item.weekStart), "d MMM", { locale: ru }),
    completed: item.completed,
    inProgress: item.inProgress,
    new: item.new,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Динамика задач по неделям</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <BarChart data={chartData} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="week"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="completed"
              stackId="a"
              fill="var(--color-completed)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="inProgress"
              stackId="a"
              fill="var(--color-inProgress)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="new"
              stackId="a"
              fill="var(--color-new)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
