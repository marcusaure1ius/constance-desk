import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { ExtendedWeeklyReport, ExtendedReportTask } from "@/lib/services/reports";
import type { AiAnalysis } from "@/lib/services/report-pdf";

interface ReportPdfProps {
  report: ExtendedWeeklyReport;
  analysis: AiAnalysis;
}

const colors = {
  primary: "#1a1a2e",
  secondary: "#16213e",
  accent: "#0f3460",
  text: "#1f2937",
  textLight: "#6b7280",
  textMuted: "#9ca3af",
  border: "#e5e7eb",
  borderLight: "#f3f4f6",
  white: "#ffffff",
  green: "#16a34a",
  greenBg: "#dcfce7",
  yellow: "#ca8a04",
  yellowBg: "#fef9c3",
  red: "#dc2626",
  redBg: "#fee2e2",
  blueBg: "#eff6ff",
  blue: "#2563eb",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: colors.text,
    backgroundColor: colors.white,
  },

  /* Header */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 12,
    borderBottomWidth: 3,
    borderBottomColor: colors.primary,
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: colors.primary,
    letterSpacing: 1,
  },
  headerDate: {
    fontSize: 11,
    color: colors.textLight,
  },

  /* Section */
  section: {
    marginBottom: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  sectionIcon: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginRight: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionIconText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: colors.secondary,
  },
  sectionText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: colors.text,
    paddingLeft: 28,
  },

  /* Metrics row */
  metricsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.borderLight,
    borderRadius: 6,
    padding: 14,
    borderLeftWidth: 3,
  },
  metricLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.textLight,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 11,
    color: colors.text,
    lineHeight: 1.5,
  },

  /* Bullet list */
  bulletList: {
    paddingLeft: 28,
  },
  bulletItem: {
    flexDirection: "row",
    marginBottom: 4,
  },
  bulletDot: {
    width: 14,
    fontSize: 10,
    color: colors.accent,
    fontFamily: "Helvetica-Bold",
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 1.5,
    color: colors.text,
  },

  /* Task tables */
  tableSection: {
    marginBottom: 16,
  },
  tableTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.secondary,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.borderLight,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: colors.textLight,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
  },
  tableRowAlt: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
    backgroundColor: "#fafafa",
  },
  taskNameCol: {
    flex: 3,
  },
  taskCategoryCol: {
    flex: 1.5,
  },
  taskStatusCol: {
    flex: 1,
    alignItems: "flex-end",
  },
  taskName: {
    fontSize: 10,
    color: colors.text,
  },
  taskCategory: {
    fontSize: 9,
    color: colors.textMuted,
  },

  /* Status badges */
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
  badgeDone: {
    backgroundColor: colors.greenBg,
    color: colors.green,
  },
  badgeInProgress: {
    backgroundColor: colors.yellowBg,
    color: colors.yellow,
  },

  /* Empty state */
  emptyText: {
    fontSize: 10,
    color: colors.textMuted,
    fontStyle: "italic",
    padding: 8,
  },

  /* Footer */
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  footerLeft: {
    fontSize: 8,
    color: colors.textMuted,
  },
  footerRight: {
    fontSize: 8,
    color: colors.textMuted,
  },
});

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon}>
        <Text style={styles.sectionIconText}>{icon}</Text>
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <View style={styles.bulletList}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletItem}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusBadge({ task }: { task: ExtendedReportTask }) {
  const isDone = !!task.completedAt;
  return (
    <Text
      style={[
        styles.badge,
        isDone ? styles.badgeDone : styles.badgeInProgress,
      ]}
    >
      {isDone ? "Готово" : "В работе"}
    </Text>
  );
}

function TaskTable({
  title,
  tasks,
}: {
  title: string;
  tasks: ExtendedReportTask[];
}) {
  return (
    <View style={styles.tableSection}>
      <Text style={styles.tableTitle}>{title}</Text>
      <View style={styles.tableHeader}>
        <View style={styles.taskNameCol}>
          <Text style={styles.tableHeaderText}>Задача</Text>
        </View>
        <View style={styles.taskCategoryCol}>
          <Text style={styles.tableHeaderText}>Категория</Text>
        </View>
        <View style={styles.taskStatusCol}>
          <Text style={styles.tableHeaderText}>Статус</Text>
        </View>
      </View>
      {tasks.length === 0 ? (
        <Text style={styles.emptyText}>Нет задач</Text>
      ) : (
        tasks.map((task, i) => (
          <View key={task.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <View style={styles.taskNameCol}>
              <Text style={styles.taskName}>{task.title}</Text>
            </View>
            <View style={styles.taskCategoryCol}>
              <Text style={styles.taskCategory}>
                {task.categoryName ?? "—"}
              </Text>
            </View>
            <View style={styles.taskStatusCol}>
              <StatusBadge task={task} />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

export function ReportPdfDocument({ report, analysis }: ReportPdfProps) {
  const weekStart = format(new Date(report.weekStart), "d MMMM", { locale: ru });
  const weekEnd = format(new Date(report.weekEnd), "d MMMM yyyy", { locale: ru });
  const dateRange = `${weekStart} — ${weekEnd}`;
  const generatedAt = format(new Date(), "d MMMM yyyy, HH:mm", { locale: ru });

  return (
    <Document
      title={`Constance — Отчёт ${dateRange}`}
      author="Constance"
      language="ru"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Constance</Text>
          <Text style={styles.headerDate}>{dateRange}</Text>
        </View>

        {/* Summary */}
        <View style={styles.section}>
          <SectionHeader icon="R" title="Резюме" />
          <Text style={styles.sectionText}>{analysis.summary}</Text>
        </View>

        {/* Metrics row */}
        <View style={styles.metricsRow}>
          <View style={[styles.metricCard, { borderLeftColor: colors.green }]}>
            <Text style={styles.metricLabel}>Выполнение</Text>
            <Text style={styles.metricValue}>{analysis.completionRate}</Text>
          </View>
          <View style={[styles.metricCard, { borderLeftColor: colors.blue }]}>
            <Text style={styles.metricLabel}>Динамика</Text>
            <Text style={styles.metricValue}>{analysis.weekComparison}</Text>
          </View>
        </View>

        {/* Trends */}
        <View style={styles.section}>
          <SectionHeader icon="T" title="Тренды" />
          <Text style={styles.sectionText}>{analysis.trends}</Text>
        </View>

        {/* Risks */}
        <View style={styles.section}>
          <SectionHeader icon="!" title="Риски" />
          <BulletList items={analysis.risks} />
        </View>

        {/* Next week focus */}
        <View style={styles.section}>
          <SectionHeader icon=">" title="Фокус на следующую неделю" />
          <BulletList items={analysis.nextWeekFocus} />
        </View>

        {/* Task tables */}
        <TaskTable
          title="Прошлые задачи"
          tasks={report.carryoverTasks}
        />
        <TaskTable
          title="Новые задачи"
          tasks={report.newTasks}
        />

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>
            Constance — Аналитический отчёт
          </Text>
          <Text style={styles.footerRight}>
            Сгенерировано: {generatedAt}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
