import { computeEpicStatus } from "./status";
import { buildEpicTexts } from "./texts";
import type { DraftTask, EpicStatus, SlideRow, SlidesDraft } from "./types";

/**
 * Состояние эпика в модалке выгрузки.
 *
 * `null` в полях правки значит «авто»: статус и тексты недель выводятся из
 * отмеченных задач при каждом рендере, пока их не тронули руками. Так
 * «пересборка вслед за галочками» и «ручная правка останавливает пересборку»
 * получаются без эффектов и синхронизаций.
 */
export type EpicDraftState = {
  categoryId: string;
  name: string;
  /** Попадёт ли эпик строкой в таблицу. */
  included: boolean;
  tasks: DraftTask[];
  checkedIds: string[];
  statusOverride: EpicStatus | null;
  thisWeekOverride: string | null;
  nextWeekOverride: string | null;
};

/** Что показывать и что выгружать для эпика прямо сейчас. */
export type EpicView = {
  status: EpicStatus;
  statusIsAuto: boolean;
  tasks: string[];
  thisWeek: string;
  thisWeekIsAuto: boolean;
  nextWeek: string;
  nextWeekIsAuto: boolean;
};

/** Старт модалки: всё включено и отмечено, правок нет. */
export function initEpicStates(draft: SlidesDraft): EpicDraftState[] {
  return draft.epics.map((epic) => ({
    categoryId: epic.categoryId,
    name: epic.name,
    included: true,
    tasks: epic.tasks,
    checkedIds: epic.tasks.map((t) => t.id),
    statusOverride: null,
    thisWeekOverride: null,
    nextWeekOverride: null,
  }));
}

/** Отмеченные задачи в исходном порядке эпика, а не в порядке кликов. */
function checkedTasks(epic: EpicDraftState): DraftTask[] {
  const ids = new Set(epic.checkedIds);
  return epic.tasks.filter((t) => ids.has(t.id));
}

export function viewEpic(epic: EpicDraftState, today: string): EpicView {
  const checked = checkedTasks(epic);
  const texts = buildEpicTexts(checked);
  return {
    status: epic.statusOverride ?? computeEpicStatus(checked, today),
    statusIsAuto: epic.statusOverride === null,
    tasks: texts.tasks,
    thisWeek: epic.thisWeekOverride ?? texts.thisWeek,
    thisWeekIsAuto: epic.thisWeekOverride === null,
    nextWeek: epic.nextWeekOverride ?? texts.nextWeek,
    nextWeekIsAuto: epic.nextWeekOverride === null,
  };
}

export function toggleTask(epic: EpicDraftState, taskId: string): EpicDraftState {
  const checked = epic.checkedIds.includes(taskId);
  return {
    ...epic,
    checkedIds: checked
      ? epic.checkedIds.filter((id) => id !== taskId)
      : [...epic.checkedIds, taskId],
  };
}

const NEXT_STATUS: Record<EpicStatus, EpicStatus> = {
  green: "yellow",
  yellow: "red",
  red: "green",
};

/** Клик по кружку: следующий цвет от того, что сейчас на экране. */
export function cycleStatus(epic: EpicDraftState, today: string): EpicDraftState {
  return { ...epic, statusOverride: NEXT_STATUS[viewEpic(epic, today).status] };
}

/** Строки таблицы слайда из включённых эпиков. */
export function toSlideRows(epics: EpicDraftState[], today: string): SlideRow[] {
  return epics
    .filter((epic) => epic.included)
    .map((epic) => {
      const view = viewEpic(epic, today);
      return {
        focus: epic.name,
        tasks: view.tasks,
        status: view.status,
        thisWeek: view.thisWeek,
        nextWeek: view.nextWeek,
      };
    });
}
