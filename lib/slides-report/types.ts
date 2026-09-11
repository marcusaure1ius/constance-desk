import { z } from "zod";
import { dayOfWeek, isIsoDate } from "./dates";

/** Неделя отчёта: даты `YYYY-MM-DD` и готовые подписи. */
export type ReportWeek = {
  monday: string;
  friday: string;
  /** `07.09.2026 - 11.09.2026` — как на плашке слайда. */
  label: string;
  /** `07.09–11.09` — для уведомлений. */
  shortLabel: string;
};

export type EpicStatus = "red" | "yellow" | "green";

export type DraftTask = {
  id: string;
  title: string;
  /** Срок, `YYYY-MM-DD`. */
  plannedDate: string | null;
  /** Когда закрыта, ISO-строка. `null` — задача открыта. */
  completedAt: string | null;
  /** Закрыта на неделе отчёта. */
  doneThisWeek: boolean;
};

/** Эпик — это категория доски. */
export type DraftEpic = { categoryId: string; name: string; tasks: DraftTask[] };

export type SlidesDraft = {
  week: ReportWeek;
  /** «Сегодня» браузера — от него считаются просрочка и риск. */
  today: string;
  epics: DraftEpic[];
};

export const slideRowSchema = z.object({
  focus: z.string().max(300),
  tasks: z.array(z.string().max(500)).max(50),
  status: z.enum(["red", "yellow", "green"]),
  thisWeek: z.string().max(3000),
  nextWeek: z.string().max(3000),
});

/**
 * То, что модалка отправляет на выгрузку. Подписи недели с клиента не
 * принимаются: сервер выводит их из понедельника сам.
 */
export const exportPayloadSchema = z.object({
  weekMonday: z
    .string()
    .refine((d) => isIsoDate(d) && dayOfWeek(d) === 1, "Неделя начинается с понедельника"),
  rows: z.array(slideRowSchema).min(1).max(40),
});

export type SlideRow = z.infer<typeof slideRowSchema>;
export type ExportPayload = z.infer<typeof exportPayloadSchema>;
