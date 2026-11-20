"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  calculateEstimatedEndDate,
  calculateTimeComparison,
  CompletedFilterPeriod,
  doesActivityOccurOnDateKey,
  formatDateKey,
  formatDateKeyDisplay,
  formatDateTimeDisplay,
  formatDateTimeLocalInput,
  formatDurationWithUnit,
  formatTotalDurationMs,
  getCalendarGridDays,
  MONTH_NAMES_ES,
  snapDateTo15Minutes,
  TIME_SLOTS_15_MIN,
  TimeUnit,
  UNIT_MS,
  WEEKDAY_NAMES_ES,
} from "@/lib/timeUtils";
import {
  activityHasSchedule,
  buildActivityTree,
  flattenActivityTree,
  formatHoursAndDays,
  getDescendantIds,
  formatElapsedEs,
  overdueMs,
  STATUS_LABEL,
  type ActivityForest,
  type ActivityNode,
} from "@/lib/activityTree";
import ActivityTreeView, { AllListsTreeView } from "@/components/ActivityTreeView";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MAX_ACTIVITY_NAME_LENGTH, MAX_LIST_NAME_LENGTH } from "@/lib/limits";

/**
 * fetch a la API de la app. Si la sesión venció (401), lleva al login.
 * La sesión se renueva sola con cada pedido; solo vence tras el tiempo de inactividad.
 */
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.location.replace("/login");
    // No se resuelve: la página ya se está yendo al login.
    return new Promise<Response>(() => {});
  }
  return res;
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("/login");
  }
}

export interface ActivityDTO {
  id: number;
  listId: number;
  /** Actividad padre dentro de la misma lista (null = principal). */
  parentId: number | null;
  name: string;
  position: number;
  /** Horario: solo tareas finales; null = "sin horario". */
  startDate: string | null;
  estimatedAmount: number | null;
  estimatedUnit: TimeUnit | null;
  estimatedEndDate: string | null;
  actualEndDate: string | null;
  /** Observación libre (opcional). */
  observation: string | null;
  /** Observaciones cargadas al finalizar (una por renglón). */
  completionNotes?: { id: number; text: string }[];
  createdAt: string;
  updatedAt: string;
  list?: {
    id: number;
    name: string;
  };
}

export interface TodoListDTO {
  id: number;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  activities: ActivityDTO[];
}

/** Tarea final con horario: la única que aparece en el calendario. */
type ScheduledActivity = ActivityDTO & {
  startDate: string;
  estimatedAmount: number;
  estimatedUnit: TimeUnit;
  estimatedEndDate: string;
};

function isScheduled(a: ActivityDTO): a is ScheduledActivity {
  return activityHasSchedule(a);
}

type ActiveTab = "dashboard" | "completed" | "calendar";
type ListViewMode = "list" | "tree";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [lists, setLists] = useState<TodoListDTO[]>([]);
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [listViewMode, setListViewMode] = useState<ListViewMode>("list");
  // Dashboard principal: tarjetas de listas o árbol con todas las actividades
  const [dashboardView, setDashboardView] = useState<"cards" | "tree">("cards");
  // Vista lista: actividades con hijas DESPLEGADAS. Vacío = todo contraído (por defecto).
  const [expandedListParents, setExpandedListParents] = useState<Set<number>>(
    () => new Set()
  );
  const [loadingLists, setLoadingLists] = useState<boolean>(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Drag & Drop: Listas
  const [draggedListId, setDraggedListId] = useState<number | null>(null);
  const [dragOverListId, setDragOverListId] = useState<number | null>(null);

  // Drag & Drop: Actividades dentro de una lista
  const [draggedActivityId, setDraggedActivityId] = useState<number | null>(null);
  const [dragOverActivityId, setDragOverActivityId] = useState<number | null>(null);

  // Modal: Crear lista
  const [showCreateListModal, setShowCreateListModal] = useState<boolean>(false);
  const [newListName, setNewListName] = useState<string>("");
  const [createListError, setCreateListError] = useState<string | null>(null);
  const [submittingList, setSubmittingList] = useState<boolean>(false);

  // Modal: Renombrar lista
  const [renamingList, setRenamingList] = useState<TodoListDTO | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Modal: Confirmar eliminación de lista
  const [deletingList, setDeletingList] = useState<TodoListDTO | null>(null);

  // Modal: Crear / Editar Actividad
  const [showActivityModal, setShowActivityModal] = useState<boolean>(false);
  const [editingActivity, setEditingActivity] = useState<ActivityDTO | null>(null);
  const [actName, setActName] = useState<string>("");
  const [actStartDate, setActStartDate] = useState<string>("");
  const [actEstAmount, setActEstAmount] = useState<string>("1");
  const [actEstUnit, setActEstUnit] = useState<TimeUnit>("HOURS");
  const [actParentId, setActParentId] = useState<string>("");
  const [actNoSchedule, setActNoSchedule] = useState<boolean>(false);
  const [actObservation, setActObservation] = useState<string>("");
  const [actExtraDates, setActExtraDates] = useState<string[]>([]);
  const [showCreateMultiDaysPicker, setShowCreateMultiDaysPicker] =
    useState<boolean>(false);
  const [pickerYear, setPickerYear] = useState<number>(() => new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState<number>(() => new Date().getMonth());
  const [activityFormError, setActivityFormError] = useState<string | null>(null);
  const [submittingActivity, setSubmittingActivity] = useState<boolean>(false);

  // Modal: Finalizar actividad / Modificar fecha de finalización real
  const [finalizingActivity, setFinalizingActivity] = useState<ActivityDTO | null>(
    null
  );
  const [actualEndDateInput, setActualEndDateInput] = useState<string>("");
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  // Observaciones de finalización (una por renglón) y el renglón que se está escribiendo
  const [finalizeNotes, setFinalizeNotes] = useState<string[]>([]);
  const [finalizeNoteInput, setFinalizeNoteInput] = useState<string>("");
  const [submittingFinalize, setSubmittingFinalize] = useState<boolean>(false);

  // Modal: Confirmar eliminación de actividad
  const [deletingActivity, setDeletingActivity] = useState<ActivityDTO | null>(null);

  // Modal / Modo: Tildar una actividad existente para varios días
  const [multiDayActivity, setMultiDayActivity] = useState<ScheduledActivity | null>(
    null
  );
  const [multiDayCheckedKeys, setMultiDayCheckedKeys] = useState<string[]>([]);
  const [multiDayCalYear, setMultiDayCalYear] = useState<number>(() =>
    new Date().getFullYear()
  );
  const [multiDayCalMonth, setMultiDayCalMonth] = useState<number>(() =>
    new Date().getMonth()
  );
  const [multiDayError, setMultiDayError] = useState<string | null>(null);
  const [submittingMultiDay, setSubmittingMultiDay] = useState<boolean>(false);

  // Solapa "Actividades realizadas"
  const [completedPeriod, setCompletedPeriod] =
    useState<CompletedFilterPeriod>("day");
  const [completedActivities, setCompletedActivities] = useState<ActivityDTO[]>([]);
  const [completedPeriodLabel, setCompletedPeriodLabel] = useState<string>("");
  const [loadingCompleted, setLoadingCompleted] = useState<boolean>(false);

  // Solapa "Calendario"
  const [calendarYear, setCalendarYear] = useState<number>(() =>
    new Date().getFullYear()
  );
  const [calendarMonth, setCalendarMonth] = useState<number>(() =>
    new Date().getMonth()
  );
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = useState<string>(() =>
    formatDateKey(new Date())
  );
  const [calendarCheckActivityId, setCalendarCheckActivityId] = useState<
    number | null
  >(null);
  const [calendarCheckedDates, setCalendarCheckedDates] = useState<string[]>([]);
  const [savingCalendarChecks, setSavingCalendarChecks] = useState<boolean>(false);
  const [calendarCheckSuccess, setCalendarCheckSuccess] = useState<string | null>(
    null
  );
  // Arrastrar y soltar actividades entre días del calendario:
  // actividad que se arrastra y día (celda) desde donde se tomó.
  const [calendarDrag, setCalendarDrag] = useState<{
    id: number;
    fromKey: string;
  } | null>(null);
  const [calendarDragOverKey, setCalendarDragOverKey] = useState<string | null>(
    null
  );
  const [calendarMoveError, setCalendarMoveError] = useState<string | null>(null);
  // Días del calendario desplegados con "+ N más" (muestran todas sus actividades)
  const [expandedCalendarDays, setExpandedCalendarDays] = useState<Set<string>>(
    () => new Set()
  );
  const toggleCalendarDayExpanded = (dateKey: string) =>
    setExpandedCalendarDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });

  const fetchLists = useCallback(async () => {
    try {
      setLoadingLists(true);
      setGlobalError(null);
      const res = await apiFetch("/api/lists", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("No se pudieron cargar las listas.");
      }
      const data: TodoListDTO[] = await res.json();
      setLists(data);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoadingLists(false);
    }
  }, []);

  const fetchCompletedActivities = useCallback(
    async (period: CompletedFilterPeriod) => {
      try {
        setLoadingCompleted(true);
        const res = await apiFetch(`/api/activities/completed?period=${period}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("No se pudieron cargar las actividades realizadas.");
        }
        const data = await res.json();
        setCompletedActivities(data.activities || []);
        setCompletedPeriodLabel(data.label || "");
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : "Error inesperado");
      } finally {
        setLoadingCompleted(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  useEffect(() => {
    if (activeTab === "completed") {
      fetchCompletedActivities(completedPeriod);
    }
  }, [activeTab, completedPeriod, fetchCompletedActivities]);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedListId) || null,
    [lists, selectedListId]
  );

  // Árbol de cada lista con tiempo, período y estado calculados en un solo lugar
  // (src/lib/activityTree.ts). Lo usan la lista, el dashboard, el calendario y el árbol.
  const forestByList = useMemo(() => {
    const map = new Map<number, ActivityForest<ActivityDTO>>();
    for (const list of lists) {
      map.set(list.id, buildActivityTree(list.activities));
    }
    return map;
  }, [lists]);

  const nodeById = useMemo(() => {
    const map = new Map<number, ActivityNode<ActivityDTO>>();
    for (const forest of forestByList.values()) {
      for (const [id, node] of forest.byId) map.set(id, node);
    }
    return map;
  }, [forestByList]);

  const selectedForest = selectedList ? forestByList.get(selectedList.id) ?? null : null;
  const selectedFlatNodes = useMemo(
    () => (selectedForest ? flattenActivityTree(selectedForest.roots) : []),
    [selectedForest]
  );

  // Vista lista: mismo orden, pero sin las hijas de las actividades contraídas
  const visibleListNodes = useMemo(() => {
    const out: ActivityNode<ActivityDTO>[] = [];
    const walk = (n: ActivityNode<ActivityDTO>) => {
      out.push(n);
      if (expandedListParents.has(n.activity.id)) n.children.forEach(walk);
    };
    selectedForest?.roots.forEach(walk);
    return out;
  }, [selectedForest, expandedListParents]);

  const selectedParentIds = useMemo(
    () => selectedFlatNodes.filter((n) => !n.isLeaf).map((n) => n.activity.id),
    [selectedFlatNodes]
  );

  const toggleListParent = (id: number) =>
    setExpandedListParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Tareas finales con horario, enriquecidas con el nombre de su lista, ordenadas por fecha y horario
  // (las actividades con hijas no tienen horario propio y no van al calendario)
  const allActivitiesWithList = useMemo(() => {
    const result: ScheduledActivity[] = [];
    for (const list of lists) {
      for (const act of list.activities) {
        if (!isScheduled(act) || !nodeById.get(act.id)?.isLeaf) continue;
        result.push({
          ...act,
          list: { id: list.id, name: list.name },
        });
      }
    }
    result.sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
    return result;
  }, [lists, nodeById]);

  // Cálculo automático de la fecha y hora de finalización estimada para el formulario
  const previewEstimatedEndDate = useMemo(() => {
    if (!actStartDate) return null;
    const parsedStart = new Date(actStartDate);
    const amount = Number(actEstAmount);
    if (
      Number.isNaN(parsedStart.getTime()) ||
      Number.isNaN(amount) ||
      amount <= 0
    ) {
      return null;
    }
    return calculateEstimatedEndDate(parsedStart, amount, actEstUnit);
  }, [actStartDate, actEstAmount, actEstUnit]);

  // Horarios (cada 15 min) ya ocupados por otras actividades en la fecha seleccionada.
  // Solo es visual: no bloquea la selección (las actividades pueden superponerse).
  const occupiedStartSlots = useMemo(() => {
    const occupied = new Set<string>();
    const datePart = actStartDate.split("T")[0];
    if (!datePart) return occupied;
    const [y, m, d] = datePart.split("-").map(Number);
    if (!y || !m || !d) return occupied;
    const dayStart = new Date(y, m - 1, d).getTime();
    const SLOT_MS = 15 * 60 * 1000;
    for (const act of allActivitiesWithList) {
      if (editingActivity && act.id === editingActivity.id) continue;
      const start = new Date(act.startDate).getTime();
      const endRaw = new Date(act.actualEndDate ?? act.estimatedEndDate).getTime();
      if (Number.isNaN(start)) continue;
      // Sin duración válida: se marca al menos el bloque de 15 min del inicio
      const end = Number.isNaN(endRaw) || endRaw <= start ? start + SLOT_MS : endRaw;
      for (const slot of TIME_SLOTS_15_MIN) {
        const [hh, mm] = slot.value.split(":").map(Number);
        const slotStart = dayStart + (hh * 60 + mm) * 60 * 1000;
        const slotEnd = slotStart + SLOT_MS;
        if (slotStart < end && slotEnd > start) occupied.add(slot.value);
      }
    }
    return occupied;
  }, [actStartDate, allActivitiesWithList, editingActivity]);

  // --- Drag & Drop: Reordenar Listas ---
  const handleListDragStart = (listId: number) => {
    setDraggedListId(listId);
  };

  const handleListDragOver = (e: React.DragEvent, targetListId: number) => {
    e.preventDefault();
    if (draggedListId === null || draggedListId === targetListId) return;
    setDragOverListId(targetListId);
  };

  const handleListDrop = async (e: React.DragEvent, targetListId: number) => {
    e.preventDefault();
    setDragOverListId(null);
    if (draggedListId === null || draggedListId === targetListId) {
      setDraggedListId(null);
      return;
    }

    const oldIndex = lists.findIndex((l) => l.id === draggedListId);
    const newIndex = lists.findIndex((l) => l.id === targetListId);
    if (oldIndex === -1 || newIndex === -1) {
      setDraggedListId(null);
      return;
    }

    const reordered = [...lists];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    setLists(reordered);
    setDraggedListId(null);

    try {
      await apiFetch("/api/lists/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((l) => l.id) }),
      });
    } catch {
      await fetchLists();
    }
  };

  // --- Drag & Drop: Reordenar Actividades dentro de una Lista ---
  const handleActivityDragStart = (activityId: number) => {
    setDraggedActivityId(activityId);
  };

  const handleActivityDragOver = (
    e: React.DragEvent,
    targetActivityId: number
  ) => {
    e.preventDefault();
    if (draggedActivityId === null || draggedActivityId === targetActivityId)
      return;
    // Solo se reordena entre hermanas (mismo padre)
    if (
      nodeById.get(draggedActivityId)?.activity.parentId !==
      nodeById.get(targetActivityId)?.activity.parentId
    )
      return;
    setDragOverActivityId(targetActivityId);
  };

  const handleActivityDrop = async (
    e: React.DragEvent,
    targetActivityId: number
  ) => {
    e.preventDefault();
    setDragOverActivityId(null);
    if (
      !selectedList ||
      draggedActivityId === null ||
      draggedActivityId === targetActivityId
    ) {
      setDraggedActivityId(null);
      return;
    }

    const draggedParent = nodeById.get(draggedActivityId)?.activity.parentId;
    if (draggedParent !== nodeById.get(targetActivityId)?.activity.parentId) {
      setDraggedActivityId(null);
      return;
    }

    // Hermanas en el orden en que se muestran
    const siblings = selectedFlatNodes
      .filter((n) => n.activity.parentId === draggedParent)
      .map((n) => n.activity);
    const oldIndex = siblings.findIndex((a) => a.id === draggedActivityId);
    const newIndex = siblings.findIndex((a) => a.id === targetActivityId);
    if (oldIndex === -1 || newIndex === -1) {
      setDraggedActivityId(null);
      return;
    }

    const [moved] = siblings.splice(oldIndex, 1);
    siblings.splice(newIndex, 0, moved);
    const newPositions = new Map(siblings.map((a, index) => [a.id, index]));

    setLists((prev) =>
      prev.map((l) =>
        l.id === selectedList.id
          ? {
              ...l,
              activities: l.activities.map((a) =>
                newPositions.has(a.id)
                  ? { ...a, position: newPositions.get(a.id)! }
                  : a
              ),
            }
          : l
      )
    );
    setDraggedActivityId(null);

    try {
      await apiFetch(`/api/lists/${selectedList.id}/activities/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedIds: siblings.map((a) => a.id),
        }),
      });
    } catch {
      await fetchLists();
    }
  };

  // --- Acciones de Lista ---
  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateListError(null);
    const trimmed = newListName.trim();
    if (!trimmed) {
      setCreateListError("El nombre de la lista es obligatorio.");
      return;
    }

    try {
      setSubmittingList(true);
      const res = await apiFetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateListError(data.error || "Error al crear la lista.");
        return;
      }
      await fetchLists();
      setNewListName("");
      setShowCreateListModal(false);
    } catch {
      setCreateListError("Error de red al crear la lista.");
    } finally {
      setSubmittingList(false);
    }
  };

  const openRenameModal = (list: TodoListDTO) => {
    setRenamingList(list);
    setRenameValue(list.name);
    setRenameError(null);
  };

  const handleRenameList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingList) return;
    setRenameError(null);
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("El nombre de la lista es obligatorio.");
      return;
    }

    try {
      setSubmittingList(true);
      const res = await apiFetch(`/api/lists/${renamingList.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameError(data.error || "Error al renombrar la lista.");
        return;
      }
      await fetchLists();
      setRenamingList(null);
    } catch {
      setRenameError("Error de red al renombrar la lista.");
    } finally {
      setSubmittingList(false);
    }
  };

  const handleConfirmDeleteList = async () => {
    if (!deletingList) return;
    try {
      setSubmittingList(true);
      const res = await apiFetch(`/api/lists/${deletingList.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (selectedListId === deletingList.id) {
          setSelectedListId(null);
        }
        await fetchLists();
        setDeletingList(null);
      }
    } finally {
      setSubmittingList(false);
    }
  };

  // --- Acciones de Actividad ---
  const openCreateActivityModal = (parentId: number | null = null) => {
    const now = snapDateTo15Minutes(new Date());
    setEditingActivity(null);
    setActName("");
    setActStartDate(formatDateTimeLocalInput(now));
    setActEstAmount("1");
    setActEstUnit("HOURS");
    setActParentId(parentId !== null ? String(parentId) : "");
    setActNoSchedule(false);
    setActObservation("");
    // Sin días extra: el día de inicio ya cuenta. Antes se pre-marcaba "hoy" y, si se
    // cambiaba la fecha de inicio, se creaba sin querer una copia para hoy.
    setActExtraDates([]);
    setShowCreateMultiDaysPicker(false);
    setPickerYear(now.getFullYear());
    setPickerMonth(now.getMonth());
    setActivityFormError(null);
    setShowActivityModal(true);
  };

  const openEditActivityModal = (activity: ActivityDTO) => {
    setEditingActivity(activity);
    setActName(activity.name);
    // Igual que una tarea con horario: los campos de horario se muestran siempre.
    // Si no tiene horario, la fecha arranca vacía (y vacía la mantiene sin horario).
    setActStartDate(
      activity.startDate
        ? formatDateTimeLocalInput(snapDateTo15Minutes(activity.startDate))
        : ""
    );
    setActEstAmount(String(activity.estimatedAmount ?? 1));
    setActEstUnit(activity.estimatedUnit ?? "HOURS");
    setActParentId(activity.parentId !== null ? String(activity.parentId) : "");
    setActNoSchedule(false);
    setActObservation(activity.observation ?? "");
    setActExtraDates([]);
    setShowCreateMultiDaysPicker(false);
    setActivityFormError(null);
    setShowActivityModal(true);
  };

  // --- Datos del formulario de actividad relacionados con la jerarquía ---
  const editingActivityHasChildren = editingActivity
    ? !(nodeById.get(editingActivity.id)?.isLeaf ?? true)
    : false;

  // Posibles padres: actividades de la misma lista, sin la propia ni sus descendientes (evita ciclos)
  const activityFormListId = editingActivity?.listId ?? selectedList?.id ?? null;
  const parentOptions = useMemo(() => {
    if (activityFormListId === null) return [];
    const forest = forestByList.get(activityFormListId);
    if (!forest) return [];
    const flat = flattenActivityTree(forest.roots);
    if (!editingActivity) return flat;
    const excluded = getDescendantIds(
      editingActivity.id,
      flat.map((n) => n.activity)
    );
    excluded.add(editingActivity.id);
    return flat.filter((n) => !excluded.has(n.activity.id));
  }, [activityFormListId, forestByList, editingActivity]);

  // Aviso: si el padre elegido es hoy una tarea final, perderá su horario y su finalización
  const parentLosingSchedule = useMemo(() => {
    if (!actParentId) return null;
    const pid = Number(actParentId);
    if (editingActivity && editingActivity.parentId === pid) return null;
    const node = nodeById.get(pid);
    if (!node || !node.isLeaf) return null;
    const a = node.activity;
    return a.startDate !== null || a.actualEndDate !== null ? a : null;
  }, [actParentId, editingActivity, nodeById]);

  const toggleCreateExtraDate = (dateKey: string) => {
    setActExtraDates((prev) =>
      prev.includes(dateKey)
        ? prev.filter((d) => d !== dateKey)
        : [...prev, dateKey]
    );
  };

  const handleSaveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetListId = editingActivity
      ? editingActivity.listId
      : selectedList?.id;
    if (!targetListId) return;
    setActivityFormError(null);

    const trimmedName = actName.trim();
    if (!trimmedName) {
      setActivityFormError("El nombre de la actividad es obligatorio.");
      return;
    }

    const parentId = actParentId ? Number(actParentId) : null;
    let body: Record<string, unknown> = {
      name: trimmedName,
      parentId,
      observation: actObservation.trim(),
    };

    // Una actividad con hijas no tiene horario propio: solo nombre y padre.
    if (!editingActivityHasChildren) {
      // Casilla "sin horario" marcada, o fecha de inicio vacía: queda sin horario
      if (actNoSchedule || !actStartDate) {
        body = { ...body, startDate: null };
      } else {
        if (Number.isNaN(new Date(actStartDate).getTime())) {
          setActivityFormError("Debe ingresar una fecha y hora de inicio válida.");
          return;
        }

        const numericAmount = Number(actEstAmount);
        if (Number.isNaN(numericAmount) || numericAmount <= 0) {
          setActivityFormError(
            "La cantidad del tiempo estimado debe ser mayor a 0."
          );
          return;
        }

        const startDateObj = new Date(actStartDate);
        if (
          editingActivity?.actualEndDate &&
          new Date(editingActivity.actualEndDate).getTime() < startDateObj.getTime()
        ) {
          setActivityFormError(
            "La fecha de inicio no puede ser posterior a la fecha de finalización real ya registrada."
          );
          return;
        }

        body = {
          ...body,
          startDate: startDateObj.toISOString(),
          estimatedAmount: numericAmount,
          estimatedUnit: actEstUnit,
          ...(!editingActivity && actExtraDates.length > 0
            ? { additionalDates: actExtraDates }
            : {}),
        };
      }
    }

    try {
      setSubmittingActivity(true);
      const url = editingActivity
        ? `/api/activities/${editingActivity.id}`
        : `/api/lists/${targetListId}/activities`;
      const method = editingActivity ? "PATCH" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setActivityFormError(data.error || "Error al guardar la actividad.");
        return;
      }

      await fetchLists();
      setShowActivityModal(false);
      setEditingActivity(null);
    } catch {
      setActivityFormError("Error de red al guardar la actividad.");
    } finally {
      setSubmittingActivity(false);
    }
  };

  // --- Modal: Tildar una actividad existente para varios días ---
  const openMultiDayModal = (activity: ScheduledActivity) => {
    const startDt = new Date(activity.startDate);
    setMultiDayActivity(activity);
    setMultiDayCalYear(startDt.getFullYear());
    setMultiDayCalMonth(startDt.getMonth());
    setMultiDayError(null);

    // Pre-tildar todos los días donde ya existe esta actividad en cualquiera de las tarjetas
    const normTarget = activity.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    const existingKeys = new Set<string>([formatDateKey(activity.startDate)]);
    for (const a of allActivitiesWithList) {
      const normA = a.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
      // Solo cuentan las copias hermanas (misma tarjeta y misma madre)
      const sameScope =
        a.listId === activity.listId && a.parentId === activity.parentId;
      if (normA === normTarget && sameScope) {
        existingKeys.add(formatDateKey(a.startDate));
      }
    }
    setMultiDayCheckedKeys(Array.from(existingKeys));
  };

  const toggleMultiDayKey = (dateKey: string) => {
    if (!multiDayActivity) return;
    const baseKey = formatDateKey(multiDayActivity.startDate);
    if (dateKey === baseKey) return; // El día original de la actividad base permanece tildado
    setMultiDayCheckedKeys((prev) =>
      prev.includes(dateKey)
        ? prev.filter((k) => k !== dateKey)
        : [...prev, dateKey]
    );
  };

  const handleSaveMultiDayModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!multiDayActivity) return;
    setMultiDayError(null);

    if (multiDayCheckedKeys.length === 0) {
      setMultiDayError("Debe mantener al menos un día tildado.");
      return;
    }

    try {
      setSubmittingMultiDay(true);
      const res = await apiFetch(
        `/api/activities/${multiDayActivity.id}/multi-days`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dates: multiDayCheckedKeys }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setMultiDayError(
          data.error || "Error al guardar los días seleccionados."
        );
        return;
      }
      await fetchLists();
      setMultiDayActivity(null);
    } catch {
      setMultiDayError("Error de red al asignar la actividad a varios días.");
    } finally {
      setSubmittingMultiDay(false);
    }
  };

  // --- Arrastrar y soltar una actividad a otro día del calendario ---
  // Se corre la actividad la misma cantidad de días que hay entre la celda de origen
  // y la de destino, manteniendo la hora y la duración (el servidor recalcula el fin estimado).
  // Solo se mueven las pendientes: las finalizadas conservan su historial real.
  const handleCalendarDrop = async (toKey: string) => {
    const drag = calendarDrag;
    setCalendarDrag(null);
    setCalendarDragOverKey(null);
    if (!drag) return;

    const act = allActivitiesWithList.find((a) => a.id === drag.id);
    if (!act || act.actualEndDate !== null) return;

    const [fy, fm, fd] = drag.fromKey.split("-").map(Number);
    const [ty, tm, td] = toKey.split("-").map(Number);
    const dayOffset = Math.round(
      (new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) /
      UNIT_MS.DAYS
    );
    if (dayOffset === 0) return;

    const newStart = new Date(act.startDate);
    newStart.setDate(newStart.getDate() + dayOffset);
    const newEnd = calculateEstimatedEndDate(
      newStart,
      act.estimatedAmount,
      act.estimatedUnit
    );

    setCalendarMoveError(null);
    // Actualización optimista: la actividad aparece enseguida en el día nuevo
    setLists((prev) =>
      prev.map((l) => ({
        ...l,
        activities: l.activities.map((a) =>
          a.id === act.id
            ? {
              ...a,
              startDate: newStart.toISOString(),
              estimatedEndDate: newEnd.toISOString(),
            }
            : a
        ),
      }))
    );

    try {
      const res = await apiFetch(`/api/activities/${act.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: newStart.toISOString() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCalendarMoveError(data.error || "No se pudo mover la actividad.");
      }
    } catch {
      setCalendarMoveError("Error de red al mover la actividad.");
    }
    // Sincroniza con el servidor (y revierte si hubo error)
    await fetchLists();
  };

  // --- Modo en vivo de "Tildar actividad en varios días" dentro de la solapa Calendario ---
  const selectedCalendarCheckActivity = useMemo(
    () =>
      allActivitiesWithList.find((a) => a.id === calendarCheckActivityId) ||
      null,
    [allActivitiesWithList, calendarCheckActivityId]
  );

  const handleSelectCalendarCheckActivity = (actIdStr: string) => {
    setCalendarCheckSuccess(null);
    if (!actIdStr) {
      setCalendarCheckActivityId(null);
      setCalendarCheckedDates([]);
      return;
    }
    const id = Number(actIdStr);
    const act = allActivitiesWithList.find((a) => a.id === id);
    if (!act) return;
    setCalendarCheckActivityId(id);

    const normTarget = act.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    const keys = new Set<string>([formatDateKey(act.startDate)]);
    for (const sibling of allActivitiesWithList) {
      const normSibling = sibling.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
      // Solo cuentan las copias hermanas (misma tarjeta y misma madre)
      const sameScope =
        sibling.listId === act.listId && sibling.parentId === act.parentId;
      if (normSibling === normTarget && sameScope) {
        keys.add(formatDateKey(sibling.startDate));
      }
    }
    setCalendarCheckedDates(Array.from(keys));
  };

  const toggleCalendarDirectCheck = (dateKey: string) => {
    if (!selectedCalendarCheckActivity) return;
    setCalendarCheckSuccess(null);
    const baseKey = formatDateKey(selectedCalendarCheckActivity.startDate);
    if (dateKey === baseKey) return;
    setCalendarCheckedDates((prev) =>
      prev.includes(dateKey)
        ? prev.filter((d) => d !== dateKey)
        : [...prev, dateKey]
    );
  };

  const handleSaveCalendarDirectChecks = async () => {
    if (!selectedCalendarCheckActivity) return;
    try {
      setSavingCalendarChecks(true);
      setCalendarCheckSuccess(null);
      const res = await apiFetch(
        `/api/activities/${selectedCalendarCheckActivity.id}/multi-days`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dates: calendarCheckedDates }),
        }
      );
      if (res.ok) {
        await fetchLists();
        setCalendarCheckSuccess(
          "Días actualizados correctamente en el calendario."
        );
      }
    } finally {
      setSavingCalendarChecks(false);
    }
  };

  const openFinalizeModal = (activity: ActivityDTO) => {
    setFinalizingActivity(activity);
    if (activity.actualEndDate) {
      setActualEndDateInput(
        formatDateTimeLocalInput(snapDateTo15Minutes(activity.actualEndDate))
      );
    } else if (activity.estimatedEndDate) {
      // Por defecto se propone la finalización estimada (fecha y horario)
      setActualEndDateInput(
        formatDateTimeLocalInput(snapDateTo15Minutes(activity.estimatedEndDate))
      );
    } else {
      // Tarea sin horario: se propone el momento actual
      setActualEndDateInput(
        formatDateTimeLocalInput(snapDateTo15Minutes(new Date()))
      );
    }
    setFinalizeNotes((activity.completionNotes ?? []).map((n) => n.text));
    setFinalizeNoteInput("");
    setFinalizeError(null);
  };

  const addFinalizeNote = () => {
    const text = finalizeNoteInput.trim();
    if (!text) return;
    setFinalizeNotes((prev) => [...prev, text]);
    setFinalizeNoteInput("");
  };

  const removeFinalizeNote = (index: number) => {
    setFinalizeNotes((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveFinalize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalizingActivity) return;
    setFinalizeError(null);

    if (
      !actualEndDateInput ||
      Number.isNaN(new Date(actualEndDateInput).getTime())
    ) {
      setFinalizeError(
        "Debe ingresar una fecha y hora de finalización real válida."
      );
      return;
    }

    const actualDateObj = new Date(actualEndDateInput);

    if (
      finalizingActivity.startDate &&
      actualDateObj.getTime() < new Date(finalizingActivity.startDate).getTime()
    ) {
      setFinalizeError(
        "La fecha de finalización real no puede ser anterior a la fecha de inicio."
      );
      return;
    }

    try {
      setSubmittingFinalize(true);
      const res = await apiFetch(`/api/activities/${finalizingActivity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualEndDate: actualDateObj.toISOString(),
          // Si quedó un renglón escrito sin agregar, también se guarda
          completionNotes: [...finalizeNotes, finalizeNoteInput].filter(
            (n) => n.trim() !== ""
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFinalizeError(data.error || "Error al finalizar la actividad.");
        return;
      }

      await fetchLists();
      if (activeTab === "completed") {
        await fetchCompletedActivities(completedPeriod);
      }
      setFinalizingActivity(null);
    } catch {
      setFinalizeError("Error de red al guardar la finalización.");
    } finally {
      setSubmittingFinalize(false);
    }
  };

  const handleConfirmDeleteActivity = async () => {
    if (!deletingActivity) return;
    try {
      setSubmittingActivity(true);
      const res = await apiFetch(`/api/activities/${deletingActivity.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchLists();
        if (activeTab === "completed") {
          await fetchCompletedActivities(completedPeriod);
        }
        setDeletingActivity(null);
      }
    } finally {
      setSubmittingActivity(false);
    }
  };

  // Celdas del calendario principal
  const calendarCells = useMemo(
    () => getCalendarGridDays(calendarYear, calendarMonth),
    [calendarYear, calendarMonth]
  );

  // Actividades del día seleccionado en el calendario (ordenadas por horario y fecha)
  const activitiesForSelectedCalendarDay = useMemo(() => {
    return allActivitiesWithList
      .filter((act) =>
        doesActivityOccurOnDateKey(
          act.startDate,
          act.actualEndDate ?? act.estimatedEndDate,
          selectedCalendarDateKey
        )
      )
      .sort((a, b) => {
        const da = new Date(a.startDate);
        const db = new Date(b.startDate);
        const timeA = da.getHours() * 60 + da.getMinutes();
        const timeB = db.getHours() * 60 + db.getMinutes();
        if (timeA !== timeB) return timeA - timeB;
        return da.getTime() - db.getTime();
      });
  }, [allActivitiesWithList, selectedCalendarDateKey]);

  const goToPreviousMonth = () => {
    if (calendarMonth === 0) {
      setCalendarYear((y) => y - 1);
      setCalendarMonth(11);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarYear((y) => y + 1);
      setCalendarMonth(0);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  };

  const goToTodayCalendar = () => {
    const now = new Date();
    setCalendarYear(now.getFullYear());
    setCalendarMonth(now.getMonth());
    setSelectedCalendarDateKey(formatDateKey(now));
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Encabezado y navegación por solapas */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Gestor de Listas y Actividades
            </h1>
            <p className="text-sm text-slate-500">
              Organizá tus listas de tareas y compará el tiempo estimado con el
              tiempo real
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-[0.55rem] bg-slate-100 p-1 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "dashboard"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
                }`}
            >
              Dashboard principal
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("completed")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "completed"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
                }`}
            >
              Actividades realizadas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("calendar")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "calendar"
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
                }`}
            >
              Calendario
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2 rounded-md text-sm font-medium text-slate-600 hover:text-rose-700 transition"
            >
              Cerrar sesión
            </button>
          </nav>
        </div>
      </header>

      {/* Contenido principal */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {globalError && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center justify-between">
            <span>{globalError}</span>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="text-red-500 hover:text-red-800 font-semibold"
            >
              Cerrar
            </button>
          </div>
        )}

        {activeTab === "dashboard" ? (
          selectedList === null ? (
            /* VISTA DE TODAS LAS LISTAS EN EL DASHBOARD */
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">
                    Mis Listas
                  </h2>
                  <p className="text-sm text-slate-600">
                    Seleccioná una lista para gestionar sus actividades, o{" "}
                    <strong>agarrá y arrastrá</strong> cada tarjeta para cambiar
                    su posición.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDashboardView((v) => (v === "tree" ? "cards" : "tree"))
                    }
                    className="inline-flex items-center justify-center rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 transition"
                  >
                    {dashboardView === "tree"
                      ? "← Volver a mis listas"
                      : "Ver árbol de actividades"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewListName("");
                      setCreateListError(null);
                      setShowCreateListModal(true);
                    }}
                    className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
                  >
                    + Crear lista
                  </button>
                </div>
              </div>

              {dashboardView === "tree" && lists.length > 0 ? (
                /* Árbol con todas las listas; usa todo el ancho de la pantalla */
                <div className="relative left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)]">
                  <AllListsTreeView
                    lists={lists.map((l) => ({
                      id: l.id,
                      name: l.name,
                      roots: forestByList.get(l.id)?.roots ?? [],
                    }))}
                    onRefresh={fetchLists}
                    refreshing={loadingLists}
                  />
                </div>
              ) : loadingLists ? (
                <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500">
                  Cargando listas...
                </div>
              ) : lists.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
                  <h3 className="text-lg font-medium text-slate-800 mb-1">
                    Todavía no hay listas creadas
                  </h3>
                  <p className="text-sm text-slate-500 mb-6">
                    Creá tu primera lista para empezar a registrar actividades y
                    tiempos estimados.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setNewListName("");
                      setCreateListError(null);
                      setShowCreateListModal(true);
                    }}
                    className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
                  >
                    + Crear lista
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {lists.map((list) => {
                    // Se cuentan solo tareas finales para no sumar dos veces lo mismo
                    const roots = forestByList.get(list.id)?.roots ?? [];
                    const total = roots.reduce((acc, r) => acc + r.leafCount, 0);
                    const completed = roots.reduce(
                      (acc, r) => acc + r.finishedLeafCount,
                      0
                    );
                    const pending = total - completed;

                    const totalEstimatedHours = roots.reduce(
                      (acc, r) => acc + r.totalHours,
                      0
                    );

                    const totalActualMs = list.activities.reduce((acc, a) => {
                      if (!a.actualEndDate || !a.startDate) return acc;
                      if (!nodeById.get(a.id)?.isLeaf) return acc;
                      const diff =
                        new Date(a.actualEndDate).getTime() -
                        new Date(a.startDate).getTime();
                      return acc + Math.max(0, diff);
                    }, 0);

                    const isDragged = draggedListId === list.id;
                    const isDragOver = dragOverListId === list.id;

                    return (
                      <div
                        key={list.id}
                        draggable
                        onDragStart={() => handleListDragStart(list.id)}
                        onDragOver={(e) => handleListDragOver(e, list.id)}
                        onDrop={(e) => handleListDrop(e, list.id)}
                        onDragEnd={() => {
                          setDraggedListId(null);
                          setDragOverListId(null);
                        }}
                        className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition flex flex-col justify-between p-6 cursor-grab active:cursor-grabbing ${isDragged
                            ? "opacity-50 border-indigo-400 scale-[0.98]"
                            : isDragOver
                              ? "border-2 border-indigo-600 ring-2 ring-indigo-100"
                              : "border-slate-200"
                          }`}
                      >
                        <div>
                          <div className="flex items-center justify-between text-xs text-slate-400 mb-2 select-none">
                            <span className="inline-flex items-center gap-1 font-medium">
                              ⠿ Arrastrar para reordenar
                            </span>
                          </div>

                          <div className="flex items-start justify-between gap-2.5 mb-3.5">
                            <h3 className="text-[1.40625rem] leading-snug font-bold text-slate-900 break-words">
                              {list.name}
                            </h3>
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[0.9375rem] leading-snug font-medium text-slate-700 shrink-0">
                              {total}{" "}
                              {total === 1 ? "tarea" : "tareas"}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[0.9375rem] leading-snug text-slate-600 mb-4 flex-wrap">
                            <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 px-3 py-1 rounded-md font-medium">
                              Pendientes: {pending}
                            </span>
                            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 px-3 py-1 rounded-md font-medium">
                              Finalizadas: {completed}
                            </span>
                          </div>

                          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3.5 mb-5 space-y-2 text-[0.9375rem] leading-snug">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-slate-600 font-medium">
                                Tiempo total estimado:
                              </span>
                              <span className="font-bold text-indigo-700 text-right">
                                {formatHoursAndDays(totalEstimatedHours)}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-slate-600 font-medium">
                                Tiempo total real:
                              </span>
                              <span className="font-bold text-emerald-700 text-right">
                                {formatTotalDurationMs(totalActualMs)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-[0.55rem]">
                          <button
                            type="button"
                            onClick={() => setSelectedListId(list.id)}
                            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-[0.9375rem] leading-snug font-semibold text-white hover:bg-indigo-700 transition"
                          >
                            Ver actividades →
                          </button>

                          <div className="flex items-center gap-[0.4125rem]">
                            <button
                              type="button"
                              onClick={() => openRenameModal(list)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[0.9375rem] leading-snug font-medium text-slate-700 hover:bg-slate-50 transition"
                            >
                              Cambiar nombre
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingList(list)}
                              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[0.9375rem] leading-snug font-medium text-red-700 hover:bg-red-100 transition"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : (
            /* VISTA DENTRO DE UNA LISTA (SUS ACTIVIDADES) */
            <section>
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => setSelectedListId(null)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 mb-3"
                >
                  ← Volver a todas las listas
                </button>

                <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded">
                        Lista activa
                      </span>
                      <h2 className="text-2xl font-bold text-slate-900">
                        {selectedList.name}
                      </h2>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">
                      {selectedList.activities.length}{" "}
                      {selectedList.activities.length === 1
                        ? "actividad registrada"
                        : "actividades registradas"}{" "}
                      en esta lista —{" "}
                      <strong>agarrá y arrastrá</strong> cada tarjeta para
                      reordenar su posición entre sus hermanas
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-[0.55rem]">
                    <div className="inline-flex rounded-lg bg-slate-100 p-1">
                      {(["list", "tree"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setListViewMode(mode)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${listViewMode === mode
                              ? "bg-white text-indigo-700 shadow-sm"
                              : "text-slate-600 hover:text-slate-900"
                            }`}
                        >
                          {mode === "list" ? "Lista" : "Árbol"}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => openRenameModal(selectedList)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                    >
                      Cambiar nombre de lista
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingList(selectedList)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 transition"
                    >
                      Eliminar lista
                    </button>
                    <button
                      type="button"
                      onClick={() => openCreateActivityModal()}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition shadow-sm"
                    >
                      + Nueva actividad
                    </button>
                  </div>
                </div>
              </div>

              {selectedList.activities.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
                  <h3 className="text-lg font-medium text-slate-800 mb-1">
                    Esta lista aún no tiene actividades
                  </h3>
                  <p className="text-sm text-slate-500 mb-5">
                    Agregá una actividad indicando fecha de inicio y tiempo
                    estimado en minutos, horas o días.
                  </p>
                  <button
                    type="button"
                    onClick={() => openCreateActivityModal()}
                    className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
                  >
                    + Nueva actividad
                  </button>
                </div>
              ) : listViewMode === "tree" ? (
                /* El árbol usa todo el ancho de la pantalla (puede ser muy ancho) */
                <div className="relative left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)]">
                  <ActivityTreeView
                    listName={selectedList.name}
                    roots={selectedForest?.roots ?? []}
                    onRefresh={fetchLists}
                    refreshing={loadingLists}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedParentIds.length > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedListParents(new Set(selectedParentIds))}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                        Expandir todo
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedListParents(new Set())}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                        Contraer todo
                      </button>
                    </div>
                  )}
                  {visibleListNodes.map((node) => {
                    const activity = node.activity;
                    const indentStyle = {
                      marginLeft: `${Math.min(node.depth, 8) * 2}rem`,
                    };
                    const isDragged = draggedActivityId === activity.id;
                    const isDragOver = dragOverActivityId === activity.id;
                    const dragProps = {
                      draggable: true,
                      onDragStart: () => handleActivityDragStart(activity.id),
                      onDragOver: (e: React.DragEvent) =>
                        handleActivityDragOver(e, activity.id),
                      onDrop: (e: React.DragEvent) =>
                        handleActivityDrop(e, activity.id),
                      onDragEnd: () => {
                        setDraggedActivityId(null);
                        setDragOverActivityId(null);
                      },
                    };
                    const dragClass = isDragged
                      ? "opacity-50 border-indigo-400 scale-[0.99]"
                      : isDragOver
                        ? "border-2 border-indigo-600 ring-2 ring-indigo-100"
                        : "";
                    const breadcrumb =
                      node.path.length > 0 ? (
                        <p className="text-sm text-slate-400 -mb-2">
                          {node.path.join(" › ")}
                        </p>
                      ) : null;
                    const observationBlock = activity.observation ? (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[1.125rem] leading-snug text-slate-700 whitespace-pre-line break-words">
                        <span className="font-semibold text-slate-500">
                          Observación:{" "}
                        </span>
                        {activity.observation}
                      </div>
                    ) : null;

                    /* ACTIVIDAD CON HIJAS: tiempo, período y estado calculados */
                    if (!node.isLeaf) {
                      const parentFinished = node.status === "FINALIZADA";
                      const childrenHidden = !expandedListParents.has(activity.id);
                      const childCount = node.children.length;
                      return (
                        <div
                          key={activity.id}
                          {...dragProps}
                          style={indentStyle}
                          className={`rounded-xl border p-6 shadow-sm transition cursor-grab active:cursor-grabbing bg-indigo-50/50 ${dragClass || "border-indigo-200"}`}
                        >
                          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                            <div className="space-y-4 flex-1">
                              {breadcrumb}
                              <div className="flex items-center gap-3 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => toggleListParent(activity.id)}
                                  title={
                                    childrenHidden
                                      ? `Mostrar ${childCount} ${childCount === 1 ? "actividad" : "actividades"}`
                                      : `Ocultar ${childCount} ${childCount === 1 ? "actividad" : "actividades"}`
                                  }
                                  aria-expanded={!childrenHidden}
                                  className={`group inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2 shadow-sm ring-1 ring-inset transition ${childrenHidden
                                      ? "border-indigo-300 bg-indigo-100 text-indigo-700 ring-indigo-200/60 hover:bg-indigo-200"
                                      : "border-indigo-200 bg-white text-indigo-600 ring-transparent hover:bg-indigo-50"
                                    }`}
                                >
                                  {/* Una sola flecha que gira al desplegar */}
                                  <ChevronRight
                                    className={`h-5 w-5 transition-transform duration-200 ${childrenHidden ? "" : "rotate-90"}`}
                                  />
                                  <span className="min-w-[1.25rem] rounded-md bg-white/80 px-1 text-sm font-bold tabular-nums leading-5 text-indigo-700 group-hover:bg-white">
                                    {childCount}
                                  </span>
                                </button>
                                <h3 className="text-[1.6875rem] leading-tight font-bold text-slate-900">
                                  {activity.name}
                                </h3>
                                <span
                                  className={`inline-flex items-center rounded-full px-3 py-1 text-[1.125rem] leading-snug font-semibold ${parentFinished
                                      ? "bg-emerald-100 text-emerald-800"
                                      : "bg-amber-100 text-amber-800"
                                    }`}
                                >
                                  {STATUS_LABEL[node.status]}
                                </span>
                                <span className="text-[1.125rem] text-slate-500">
                                  {node.finishedLeafCount} de {node.leafCount}{" "}
                                  {node.leafCount === 1 ? "tarea finalizada" : "tareas finalizadas"}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[1.3125rem] leading-snug bg-white p-4 rounded-lg border border-indigo-100">
                                <div>
                                  <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                    Tiempo total (estimado)
                                  </span>
                                  <span className="font-semibold text-indigo-700">
                                    {formatHoursAndDays(node.totalHours)}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                    Inicio del período
                                  </span>
                                  <span className="font-semibold text-slate-800">
                                    {node.periodStart
                                      ? formatDateTimeDisplay(node.periodStart)
                                      : "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                    Fin del período
                                  </span>
                                  <span className="font-semibold text-slate-800">
                                    {node.periodEnd
                                      ? formatDateTimeDisplay(node.periodEnd)
                                      : "—"}
                                  </span>
                                </div>
                              </div>
                              {node.unscheduledLeafCount > 0 && (
                                <p className="text-[1.125rem] italic text-slate-500">
                                  {node.unscheduledLeafCount}{" "}
                                  {node.unscheduledLeafCount === 1
                                    ? "tarea sin horario (cuenta 0 horas)"
                                    : "tareas sin horario (cuentan 0 horas)"}
                                </p>
                              )}
                              {observationBlock}
                            </div>

                            <div className="flex flex-row flex-wrap lg:flex-col items-stretch gap-[0.55rem] shrink-0">
                              <button
                                type="button"
                                onClick={() => openCreateActivityModal(activity.id)}
                                className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-[1.125rem] leading-snug font-medium text-indigo-700 hover:bg-indigo-50 transition text-center"
                              >
                                + Agregar hija
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditActivityModal(activity)}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-[1.125rem] leading-snug font-medium text-slate-700 hover:bg-slate-50 transition text-center"
                              >
                                Editar actividad
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingActivity(activity)}
                                className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[1.125rem] leading-snug font-medium text-red-700 hover:bg-red-100 transition text-center"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    /* TAREA FINAL */
                    const scheduled = isScheduled(activity) ? activity : null;
                    const isFinished = activity.actualEndDate !== null;

                    return (
                      <div
                        key={activity.id}
                        style={indentStyle}
                        draggable
                        onDragStart={() => handleActivityDragStart(activity.id)}
                        onDragOver={(e) =>
                          handleActivityDragOver(e, activity.id)
                        }
                        onDrop={(e) => handleActivityDrop(e, activity.id)}
                        onDragEnd={() => {
                          setDraggedActivityId(null);
                          setDragOverActivityId(null);
                        }}
                        className={`bg-white rounded-xl border p-6 shadow-sm transition cursor-grab active:cursor-grabbing ${isDragged
                            ? "opacity-50 border-indigo-400 scale-[0.99]"
                            : isDragOver
                              ? "border-2 border-indigo-600 ring-2 ring-indigo-100"
                              : "border-slate-200"
                          }`}
                      >
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2 select-none">
                          <span>⠿ Arrastrar tarjeta para reordenar posición</span>
                        </div>

                        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                          <div className="space-y-4 flex-1">
                            {breadcrumb}
                            <div className="flex items-center gap-3 flex-wrap">
                              <h3 className="text-[1.6875rem] leading-tight font-bold text-slate-900">
                                {activity.name}
                              </h3>
                              {isFinished ? (
                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-emerald-800">
                                  Finalizada
                                </span>
                              ) : overdueMs(node) > 0 ? (
                                <span
                                  className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-rose-700"
                                  title={`Plazo superado por ${formatElapsedEs(overdueMs(node))}`}
                                >
                                  Vencida · {formatElapsedEs(overdueMs(node))}
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-amber-800">
                                  Pendiente
                                </span>
                              )}
                              {!scheduled && (
                                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[1.125rem] leading-snug font-medium italic text-slate-500">
                                  sin horario
                                </span>
                              )}
                            </div>

                            {/* Grilla de fechas y tiempo estimado */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[1.3125rem] leading-snug bg-slate-50 p-4 rounded-lg border border-slate-100">
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Fecha y hora de inicio
                                </span>
                                <span className="font-semibold text-slate-800">
                                  {scheduled
                                    ? formatDateTimeDisplay(scheduled.startDate)
                                    : "—"}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Tiempo estimado
                                </span>
                                <span className="font-semibold text-slate-800">
                                  {scheduled
                                    ? `${formatDurationWithUnit(
                                      scheduled.estimatedAmount,
                                      scheduled.estimatedUnit
                                    )}${scheduled.estimatedUnit === "DAYS" ? ` (${formatHoursAndDays(node.totalHours)})` : ""}`
                                    : "0 h"}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Finalización estimada (automática)
                                </span>
                                <span className="font-semibold text-indigo-700">
                                  {scheduled
                                    ? formatDateTimeDisplay(scheduled.estimatedEndDate)
                                    : "—"}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Finalización real
                                </span>
                                <span
                                  className={`font-semibold ${isFinished
                                      ? "text-emerald-700"
                                      : "text-slate-400 italic"
                                    }`}
                                >
                                  {isFinished
                                    ? formatDateTimeDisplay(
                                      activity.actualEndDate!
                                    )
                                    : "Sin finalizar"}
                                </span>
                              </div>
                            </div>

                            {observationBlock}

                            {(activity.completionNotes?.length ?? 0) > 0 && (
                              <div className="rounded-lg bg-emerald-50/60 border border-emerald-200 p-3 text-[1.125rem] leading-snug text-slate-700">
                                <span className="block font-semibold text-emerald-800 mb-1">
                                  Observaciones de finalización
                                </span>
                                <ul className="list-disc pl-6 space-y-0.5">
                                  {activity.completionNotes!.map((n) => (
                                    <li key={n.id} className="break-words">
                                      {n.text}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Acciones de la actividad */}
                          <div className="flex flex-row flex-wrap lg:flex-col items-stretch gap-[0.55rem] shrink-0">
                            {!isFinished ? (
                              <button
                                type="button"
                                onClick={() => openFinalizeModal(activity)}
                                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-[1.125rem] leading-snug font-semibold text-white hover:bg-emerald-700 transition text-center"
                              >
                                Finalizar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openFinalizeModal(activity)}
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-[1.125rem] leading-snug font-semibold text-emerald-800 hover:bg-emerald-100 transition text-center"
                              >
                                Modificar finalización real
                              </button>
                            )}

                            {scheduled && (
                              <button
                                type="button"
                                onClick={() => openMultiDayModal(scheduled)}
                                className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[1.125rem] leading-snug font-medium text-indigo-700 hover:bg-indigo-100 transition text-center"
                              >
                                Tildar varios días
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => openCreateActivityModal(activity.id)}
                              className="rounded-lg border border-indigo-200 bg-white px-4 py-2.5 text-[1.125rem] leading-snug font-medium text-indigo-700 hover:bg-indigo-50 transition text-center"
                            >
                              + Agregar hija
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditActivityModal(activity)}
                              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-[1.125rem] leading-snug font-medium text-slate-700 hover:bg-slate-50 transition text-center"
                            >
                              Editar actividad
                            </button>

                            <button
                              type="button"
                              onClick={() => setDeletingActivity(activity)}
                              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[1.125rem] leading-snug font-medium text-red-700 hover:bg-red-100 transition text-center"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )
        ) : activeTab === "completed" ? (
          /* SOLAPA: ACTIVIDADES REALIZADAS */
          <section>
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Actividades realizadas
                  </h2>
                  <p className="text-sm text-slate-500">
                    Actividades finalizadas de todas las listas según su fecha
                    de finalización real.
                  </p>
                  {completedPeriodLabel && (
                    <p className="text-xs font-semibold text-indigo-600 mt-1">
                      Período filtrado: {completedPeriodLabel}
                    </p>
                  )}
                </div>

                {/* Tres filtros: Día, Semana, Mes */}
                <div className="inline-flex gap-[0.55rem] rounded-lg bg-slate-100 p-1 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setCompletedPeriod("day")}
                    className={`px-4 py-2 rounded-md text-xs sm:text-sm font-semibold transition ${completedPeriod === "day"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-700 hover:text-slate-900"
                      }`}
                  >
                    Día
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompletedPeriod("week")}
                    className={`px-4 py-2 rounded-md text-xs sm:text-sm font-semibold transition ${completedPeriod === "week"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-700 hover:text-slate-900"
                      }`}
                  >
                    Semana
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompletedPeriod("month")}
                    className={`px-4 py-2 rounded-md text-xs sm:text-sm font-semibold transition ${completedPeriod === "month"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-700 hover:text-slate-900"
                      }`}
                  >
                    Mes
                  </button>
                </div>
              </div>
            </div>

            {loadingCompleted ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500">
                Cargando actividades realizadas...
              </div>
            ) : completedActivities.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
                <h3 className="text-lg font-medium text-slate-800 mb-1">
                  No hay actividades finalizadas en este período
                </h3>
                <p className="text-sm text-slate-500">
                  No se encontraron actividades cuya fecha de finalización real
                  corresponda al{" "}
                  {completedPeriod === "day"
                    ? "día calendario actual"
                    : completedPeriod === "week"
                      ? "período de lunes a domingo de la semana actual"
                      : "mes calendario actual"}
                  .
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {completedActivities.map((activity) => {
                  if (!isScheduled(activity)) {
                    return (
                      <div
                        key={activity.id}
                        className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-wrap items-center gap-3"
                      >
                        <h3 className="text-[1.6875rem] leading-tight font-bold text-slate-900">
                          {activity.name}
                        </h3>
                        <span className="inline-flex items-center rounded-md bg-indigo-50 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-indigo-700 border border-indigo-200">
                          Lista: {activity.list?.name || "Sin lista"}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[1.125rem] italic text-slate-500">
                          sin horario
                        </span>
                        <span className="text-[1.125rem] text-slate-600">
                          Finalizada: {formatDateTimeDisplay(activity.actualEndDate!)}
                        </span>
                      </div>
                    );
                  }
                  const comparison = calculateTimeComparison(
                    activity.startDate,
                    activity.actualEndDate!,
                    activity.estimatedAmount,
                    activity.estimatedUnit
                  );

                  return (
                    <div
                      key={activity.id}
                      className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-[1.6875rem] leading-tight font-bold text-slate-900">
                            {activity.name}
                          </h3>
                          <span className="inline-flex items-center rounded-md bg-indigo-50 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-indigo-700 border border-indigo-200">
                            Lista: {activity.list?.name || "Sin lista"}
                          </span>
                        </div>
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-[1.125rem] leading-snug font-bold self-start sm:self-auto ${comparison.status === "BEFORE"
                              ? "bg-emerald-100 text-emerald-800"
                              : comparison.status === "ON_TIME"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                        >
                          {comparison.statusLabel}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[1.3125rem] leading-snug bg-slate-50 p-4 rounded-lg border border-slate-100 mb-4">
                        <div>
                          <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                            Fecha de inicio
                          </span>
                          <span className="font-semibold text-slate-800">
                            {formatDateTimeDisplay(activity.startDate)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                            Finalización estimada
                          </span>
                          <span className="font-semibold text-indigo-700">
                            {formatDateTimeDisplay(activity.estimatedEndDate)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                            Finalización real
                          </span>
                          <span className="font-semibold text-emerald-700">
                            {formatDateTimeDisplay(activity.actualEndDate!)}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[1.3125rem] leading-snug bg-indigo-50/40 p-4 rounded-lg border border-indigo-100">
                        <div>
                          <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                            Tiempo estimado
                          </span>
                          <span className="font-bold text-slate-900">
                            {comparison.estimatedText}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                            Tiempo real
                          </span>
                          <span className="font-bold text-slate-900">
                            {comparison.actualText}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                            Diferencia
                          </span>
                          <span className="font-bold text-slate-900">
                            {comparison.differenceText}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          /* SOLAPA: CALENDARIO */
          <section className="space-y-6">
            {/* Encabezado y controles del Calendario */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Calendario de Actividades
                  </h2>
                  <p className="text-sm text-slate-500">
                    Visualizá las actividades de cada día y tildá una misma
                    actividad en varios días del calendario.
                  </p>
                </div>

                <div className="flex items-center gap-[0.55rem] flex-wrap">
                  <button
                    type="button"
                    onClick={goToPreviousMonth}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                  >
                    ← Mes anterior
                  </button>
                  <span className="px-4 py-2 text-base font-bold text-slate-900 min-w-[160px] text-center">
                    {MONTH_NAMES_ES[calendarMonth]} {calendarYear}
                  </span>
                  <button
                    type="button"
                    onClick={goToNextMonth}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                  >
                    Mes siguiente →
                  </button>
                  <button
                    type="button"
                    onClick={goToTodayCalendar}
                    className="rounded-lg bg-indigo-50 border border-indigo-200 px-3.5 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                  >
                    Hoy
                  </button>
                </div>
              </div>

              {/* Barra para tildar una misma actividad en varios días directamente sobre el calendario */}
              <div className="rounded-lg bg-indigo-50/70 border border-indigo-100 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-indigo-800 mb-1">
                    Tildar una misma actividad para varios días en el calendario:
                  </label>
                  <select
                    value={calendarCheckActivityId ?? ""}
                    onChange={(e) =>
                      handleSelectCalendarCheckActivity(e.target.value)
                    }
                    className="w-full sm:max-w-md rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">
                      -- Seleccioná una actividad para tildar sus días en el
                      calendario --
                    </option>
                    {allActivitiesWithList.map((act) => (
                      <option key={act.id} value={act.id}>
                        [{act.list?.name}] {act.name} (Inicio:{" "}
                        {formatDateTimeDisplay(act.startDate)})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCalendarCheckActivity && (
                  <div className="flex items-center gap-[0.55rem] flex-wrap">
                    <span className="text-xs font-medium text-indigo-900">
                      Días tildados:{" "}
                      <strong>{calendarCheckedDates.length}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={savingCalendarChecks}
                      onClick={handleSaveCalendarDirectChecks}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition"
                    >
                      {savingCalendarChecks
                        ? "Guardando..."
                        : "Guardar días tildados"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectCalendarCheckActivity("")}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                    >
                      Salir de modo tildar
                    </button>
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500">
                Arrastrá una actividad pendiente a otro día para moverla: mantiene
                su horario y su duración. Las finalizadas no se mueven.
              </p>

              {calendarMoveError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-800">
                  {calendarMoveError}
                </div>
              )}

              {calendarCheckSuccess && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm font-medium text-emerald-800">
                  {calendarCheckSuccess}
                </div>
              )}
            </div>

            {/* Grilla mensual del Calendario */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-7 bg-slate-100 border-b border-slate-200">
                {WEEKDAY_NAMES_ES.map((dayName) => (
                  <div
                    key={dayName}
                    className="py-2.5 text-center text-xs sm:text-sm font-bold text-slate-700 uppercase tracking-wider"
                  >
                    {dayName}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
                {calendarCells.map((cell) => {
                  const dayActivities = allActivitiesWithList
                    .filter((act) =>
                      doesActivityOccurOnDateKey(
                        act.startDate,
                        act.actualEndDate ?? act.estimatedEndDate,
                        cell.dateKey
                      )
                    )
                    .sort((a, b) => {
                      const da = new Date(a.startDate);
                      const db = new Date(b.startDate);
                      const timeA = da.getHours() * 60 + da.getMinutes();
                      const timeB = db.getHours() * 60 + db.getMinutes();
                      if (timeA !== timeB) return timeA - timeB;
                      return da.getTime() - db.getTime();
                    });
                  const isSelected = selectedCalendarDateKey === cell.dateKey;
                  const isCheckedForMulti =
                    selectedCalendarCheckActivity !== null &&
                    calendarCheckedDates.includes(cell.dateKey);
                  const isBaseDayOfSelected =
                    selectedCalendarCheckActivity !== null &&
                    formatDateKey(selectedCalendarCheckActivity.startDate) ===
                    cell.dateKey;

                  const isDragTarget =
                    calendarDrag !== null &&
                    calendarDragOverKey === cell.dateKey &&
                    calendarDrag.fromKey !== cell.dateKey;

                  return (
                    <div
                      key={cell.dateKey}
                      onClick={() => setSelectedCalendarDateKey(cell.dateKey)}
                      onDragOver={(e) => {
                        if (!calendarDrag) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (calendarDragOverKey !== cell.dateKey) {
                          setCalendarDragOverKey(cell.dateKey);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleCalendarDrop(cell.dateKey);
                      }}
                      className={`min-h-[210px] p-2 transition cursor-pointer flex flex-col justify-between ${!cell.isCurrentMonth
                          ? "bg-slate-50/70 text-slate-400"
                          : "bg-white"
                        } ${isDragTarget
                          ? "ring-2 ring-inset ring-sky-500 bg-sky-50"
                          : isSelected
                            ? "ring-2 ring-inset ring-indigo-600 bg-indigo-50/20"
                            : "hover:bg-slate-50"
                        }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs sm:text-sm font-bold ${cell.isToday
                                ? "bg-indigo-600 text-white"
                                : cell.isCurrentMonth
                                  ? "text-slate-800"
                                  : "text-slate-400"
                              }`}
                          >
                            {cell.dayNumber}
                          </span>

                          {/* Casillero para tildar la actividad seleccionada en este día */}
                          {selectedCalendarCheckActivity && (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 cursor-pointer"
                              title={
                                isBaseDayOfSelected
                                  ? "Día original de la actividad"
                                  : "Tildar este día para la actividad"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={isCheckedForMulti}
                                disabled={isBaseDayOfSelected}
                                onChange={() =>
                                  toggleCalendarDirectCheck(cell.dateKey)
                                }
                                className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              <span className="hidden sm:inline">Tildar</span>
                            </label>
                          )}
                        </div>

                        <div className="space-y-1">
                          {(expandedCalendarDays.has(cell.dateKey)
                            ? dayActivities
                            : dayActivities.slice(0, 6)
                          ).map((act) => {
                            const finished = act.actualEndDate !== null;
                            const actNode = nodeById.get(act.id);
                            const overdue = actNode ? overdueMs(actNode) > 0 : false;
                            const dt = new Date(act.startDate);
                            const hhmm = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
                            // Nombre con la actividad madre (si tiene): "Madre-Hija"
                            const parentName =
                              act.parentId !== null
                                ? nodeById.get(act.parentId)?.activity.name
                                : undefined;
                            const displayName = parentName
                              ? `${parentName}-${act.name}`
                              : act.name;
                            return (
                              <div
                                key={act.id}
                                draggable={!finished}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.effectAllowed = "move";
                                  // Firefox necesita datos para iniciar el arrastre
                                  e.dataTransfer.setData("text/plain", String(act.id));
                                  setCalendarMoveError(null);
                                  setCalendarDrag({ id: act.id, fromKey: cell.dateKey });
                                }}
                                onDragEnd={() => {
                                  setCalendarDrag(null);
                                  setCalendarDragOverKey(null);
                                }}
                                className={`truncate rounded px-1.5 py-0.5 text-xs font-medium border ${finished
                                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                    : overdue
                                      ? "bg-rose-50 text-rose-800 border-rose-200"
                                      : "bg-amber-50 text-amber-900 border-amber-200"
                                  } ${!finished ? "cursor-grab active:cursor-grabbing" : ""} ${calendarDrag?.id === act.id ? "opacity-40" : ""
                                  }`}
                                title={
                                  finished
                                    ? `${hhmm} hs - ${displayName} (${act.list?.name}) · Finalizada: no se puede mover`
                                    : `${hhmm} hs - ${displayName} (${act.list?.name}) · Arrastrá para moverla a otro día`
                                }
                              >
                                <span className="font-bold">{hhmm}</span> {displayName}
                              </div>
                            );
                          })}
                          {dayActivities.length > 6 && (
                            <button
                              type="button"
                              onClick={() => toggleCalendarDayExpanded(cell.dateKey)}
                              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline pl-1"
                            >
                              {expandedCalendarDays.has(cell.dateKey)
                                ? "Ver menos"
                                : `+ ${dayActivities.length - 6} más`}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detalle de actividades del día seleccionado en el Calendario */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                <h3 className="text-lg font-bold text-slate-900">
                  Actividades del día{" "}
                  <span className="text-indigo-600">
                    {formatDateKeyDisplay(selectedCalendarDateKey)}
                  </span>
                </h3>
                <span className="text-sm text-slate-500">
                  {activitiesForSelectedCalendarDay.length}{" "}
                  {activitiesForSelectedCalendarDay.length === 1
                    ? "actividad"
                    : "actividades"}
                </span>
              </div>

              {activitiesForSelectedCalendarDay.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">
                  No hay actividades registradas para este día.
                </p>
              ) : (
                <div className="space-y-4">
                  {activitiesForSelectedCalendarDay.map((activity) => {
                    const isFinished = activity.actualEndDate !== null;
                    const comparison = isFinished
                      ? calculateTimeComparison(
                        activity.startDate,
                        activity.actualEndDate!,
                        activity.estimatedAmount,
                        activity.estimatedUnit
                      )
                      : null;

                    return (
                      <div
                        key={activity.id}
                        className="rounded-xl border border-slate-200 p-5 bg-slate-50/40"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                          <div className="space-y-3 flex-1">
                            {(nodeById.get(activity.id)?.path.length ?? 0) > 0 && (
                              <p className="text-sm text-slate-400 -mb-1">
                                {nodeById.get(activity.id)!.path.join(" › ")}
                              </p>
                            )}
                            <div className="flex items-center gap-3 flex-wrap">
                              <h4 className="text-[1.6875rem] leading-tight font-bold text-slate-900">
                                {activity.name}
                              </h4>
                              <span className="inline-flex items-center rounded-md bg-indigo-50 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-indigo-700 border border-indigo-200">
                                Lista: {activity.list?.name || "Sin lista"}
                              </span>
                              {isFinished ? (
                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-emerald-800">
                                  Finalizada
                                </span>
                              ) : (nodeById.get(activity.id) && overdueMs(nodeById.get(activity.id)!) > 0) ? (
                                <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-rose-700">
                                  Vencida · {formatElapsedEs(overdueMs(nodeById.get(activity.id)!))}
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[1.125rem] leading-snug font-semibold text-amber-800">
                                  Pendiente
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[1.3125rem] leading-snug bg-white p-4 rounded-lg border border-slate-200">
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Inicio
                                </span>
                                <span className="font-semibold text-slate-800">
                                  {formatDateTimeDisplay(activity.startDate)}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Tiempo estimado
                                </span>
                                <span className="font-semibold text-slate-800">
                                  {formatDurationWithUnit(
                                    activity.estimatedAmount,
                                    activity.estimatedUnit
                                  )}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Finalización estimada
                                </span>
                                <span className="font-semibold text-indigo-700">
                                  {formatDateTimeDisplay(
                                    activity.estimatedEndDate
                                  )}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[1.125rem] leading-snug font-medium text-slate-500">
                                  Finalización real
                                </span>
                                <span
                                  className={`font-semibold ${isFinished
                                      ? "text-emerald-700"
                                      : "text-slate-400 italic"
                                    }`}
                                >
                                  {isFinished
                                    ? formatDateTimeDisplay(
                                      activity.actualEndDate!
                                    )
                                    : "Sin finalizar"}
                                </span>
                              </div>
                            </div>

                            {comparison && (
                              <div className="rounded-lg p-3.5 border border-indigo-100 bg-indigo-50/40 text-[1.3125rem] leading-snug">
                                <span className="font-bold">
                                  {comparison.differenceText}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-row flex-wrap lg:flex-col items-stretch gap-[0.55rem] shrink-0">
                            <button
                              type="button"
                              onClick={() => openFinalizeModal(activity)}
                              className="rounded-lg bg-emerald-600 px-4 py-2 text-[1.125rem] leading-snug font-semibold text-white hover:bg-emerald-700 transition text-center"
                            >
                              {isFinished
                                ? "Modificar finalización real"
                                : "Finalizar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => openMultiDayModal(activity)}
                              className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-[1.125rem] leading-snug font-medium text-indigo-700 hover:bg-indigo-100 transition text-center"
                            >
                              Tildar varios días
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditActivityModal(activity)}
                              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[1.125rem] leading-snug font-medium text-slate-700 hover:bg-slate-50 transition text-center"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingActivity(activity)}
                              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[1.125rem] leading-snug font-medium text-red-700 hover:bg-red-100 transition text-center"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* MODAL: CREAR LISTA */}
      {showCreateListModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Crear nueva lista
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Ingresá el nombre para identificar la lista de actividades.
            </p>
            <form onSubmit={handleCreateList} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nombre de la lista
                </label>
                <input
                  type="text"
                  value={newListName}
                  maxLength={MAX_LIST_NAME_LENGTH}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Ej: Proyecto Web, Estudio, Hogar..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
              </div>
              {createListError && (
                <p className="text-xs font-medium text-red-600">
                  {createListError}
                </p>
              )}
              <div className="flex justify-end gap-[0.55rem] pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateListModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingList}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submittingList ? "Guardando..." : "Guardar lista"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RENOMBRAR LISTA */}
      {renamingList && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Cambiar nombre de la lista
            </h3>
            <form onSubmit={handleRenameList} className="space-y-4 mt-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nuevo nombre
                </label>
                <input
                  type="text"
                  value={renameValue}
                  maxLength={MAX_LIST_NAME_LENGTH}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
              </div>
              {renameError && (
                <p className="text-xs font-medium text-red-600">{renameError}</p>
              )}
              <div className="flex justify-end gap-[0.55rem] pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingList(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingList}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submittingList ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR ELIMINACIÓN DE LISTA */}
      {deletingList && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">
              Confirmar eliminación de lista
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              ¿Estás seguro de que querés eliminar la lista{" "}
              <strong className="text-slate-900">{deletingList.name}</strong>?{" "}
              Esta acción eliminará también todas sus actividades (
              {deletingList.activities.length}) de forma permanente.
            </p>
            <div className="flex justify-end gap-[0.55rem]">
              <button
                type="button"
                onClick={() => setDeletingList(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submittingList}
                onClick={handleConfirmDeleteList}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {submittingList ? "Eliminando..." : "Sí, eliminar lista"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREAR / EDITAR ACTIVIDAD */}
      {showActivityModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 my-8">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {editingActivity ? "Editar actividad" : "Nueva actividad"}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              {editingActivityHasChildren
                ? "Esta actividad tiene actividades hijas: su tiempo, período y estado se calculan a partir de sus tareas finales."
                : "La fecha y hora de finalización estimada se calcula automáticamente."}
            </p>
            <form onSubmit={handleSaveActivity} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nombre de la actividad
                </label>
                <input
                  type="text"
                  value={actName}
                  maxLength={MAX_ACTIVITY_NAME_LENGTH}
                  onChange={(e) => setActName(e.target.value)}
                  placeholder="Ej: Diseñar base de datos"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Actividad padre (opcional)
                </label>
                <select
                  value={actParentId}
                  onChange={(e) => setActParentId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white"
                >
                  <option value="">— Ninguna (actividad principal) —</option>
                  {parentOptions.map((n) => (
                    <option key={n.activity.id} value={n.activity.id}>
                      {"   ".repeat(n.depth)}
                      {n.depth > 0 ? "└ " : ""}
                      {n.activity.name}
                    </option>
                  ))}
                </select>
                {parentLosingSchedule && (
                  <p className="mt-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    <strong>{parentLosingSchedule.name}</strong> hoy es una tarea
                    final. Al agregarle esta actividad pasará a tener hijas y
                    perderá su horario
                    {parentLosingSchedule.actualEndDate
                      ? (parentLosingSchedule.completionNotes?.length ?? 0) > 0
                        ? ", su finalización y sus observaciones de finalización"
                        : " y su finalización"
                      : ""}
                    : su tiempo y su estado se calcularán desde sus tareas finales.
                  </p>
                )}
              </div>

              {!editingActivityHasChildren && (
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={actNoSchedule}
                    onChange={(e) => setActNoSchedule(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  Sin horario por ahora (cuenta 0 horas)
                </label>
              )}

              {!editingActivityHasChildren && !actNoSchedule && (
              <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Fecha de inicio
                  </label>
                  <input
                    type="date"
                    value={actStartDate.split("T")[0] || ""}
                    onChange={(e) => {
                      const datePart = e.target.value;
                      const timePart = actStartDate.split("T")[1] || "00:00";
                      setActStartDate(datePart ? `${datePart}T${timePart}` : "");
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  {!actStartDate && (
                    <p className="mt-1 text-xs text-slate-500">
                      Sin fecha: la tarea queda sin horario. Elegí una fecha para
                      asignárselo.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Horario de inicio (cada 15 min)
                  </label>
                  <select
                    value={actStartDate.split("T")[1] || "00:00"}
                    onChange={(e) => {
                      const datePart =
                        actStartDate.split("T")[0] || formatDateKey(new Date());
                      setActStartDate(`${datePart}T${e.target.value}`);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white"
                  >
                    {TIME_SLOTS_15_MIN.map((slot) => {
                      const isOccupied = occupiedStartSlots.has(slot.value);
                      return (
                        <option
                          key={slot.value}
                          value={slot.value}
                          title={
                            isOccupied
                              ? "Ya hay otra actividad asignada en este horario"
                              : undefined
                          }
                          style={
                            isOccupied
                              ? { backgroundColor: "#cbd5e1", color: "#475569" }
                              : undefined
                          }
                        >
                          {isOccupied ? `${slot.label}  • ocupado` : slot.label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Cantidad (tiempo estimado)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    value={actEstAmount}
                    onChange={(e) => setActEstAmount(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Unidad (tipo de tiempo)
                  </label>
                  <select
                    value={actEstUnit}
                    onChange={(e) => setActEstUnit(e.target.value as TimeUnit)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white"
                  >
                    <option value="MINUTES">Minutos</option>
                    <option value="HOURS">Horas</option>
                    <option value="DAYS">Días</option>
                  </select>
                </div>
              </div>

              {/* Cálculo automático en vivo de fecha y hora de finalización estimada */}
              <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-sm">
                <span className="block text-xs font-medium text-indigo-700">
                  Fecha y hora de finalización estimada (calculada
                  automáticamente):
                </span>
                <span className="font-bold text-indigo-900">
                  {previewEstimatedEndDate
                    ? formatDateTimeDisplay(previewEstimatedEndDate)
                    : "Complete una fecha de inicio y una cantidad mayor a 0"}
                </span>
              </div>

              {/* Selector opcional para tildar varios días al crear la actividad */}
              {!editingActivity && (
                <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      ¿Agendar esta misma actividad en varios días?
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setShowCreateMultiDaysPicker((prev) => !prev)
                      }
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      {showCreateMultiDaysPicker
                        ? "Ocultar calendario"
                        : "Tildar varios días"}
                    </button>
                  </div>

                  {showCreateMultiDaysPicker && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <button
                          type="button"
                          onClick={() => {
                            if (pickerMonth === 0) {
                              setPickerYear((y) => y - 1);
                              setPickerMonth(11);
                            } else {
                              setPickerMonth((m) => m - 1);
                            }
                          }}
                          className="px-2 py-1 rounded bg-white border border-slate-300"
                        >
                          ←
                        </button>
                        <span>
                          {MONTH_NAMES_ES[pickerMonth]} {pickerYear}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (pickerMonth === 11) {
                              setPickerYear((y) => y + 1);
                              setPickerMonth(0);
                            } else {
                              setPickerMonth((m) => m + 1);
                            }
                          }}
                          className="px-2 py-1 rounded bg-white border border-slate-300"
                        >
                          →
                        </button>
                      </div>

                      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500">
                        {WEEKDAY_NAMES_ES.map((w) => (
                          <div key={w}>{w}</div>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1">
                        {getCalendarGridDays(pickerYear, pickerMonth).map(
                          (cell) => {
                            const primaryKey = actStartDate
                              ? formatDateKey(actStartDate)
                              : "";
                            const isPrimary = cell.dateKey === primaryKey;
                            const isChecked =
                              isPrimary || actExtraDates.includes(cell.dateKey);

                            return (
                              <label
                                key={cell.dateKey}
                                className={`flex items-center justify-center gap-1 py-1.5 rounded text-xs cursor-pointer border ${isChecked
                                    ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                                    : cell.isCurrentMonth
                                      ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                                      : "bg-slate-100 text-slate-400 border-slate-200"
                                  }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isPrimary}
                                  onChange={() =>
                                    toggleCreateExtraDate(cell.dateKey)
                                  }
                                  className="sr-only"
                                />
                                <span>{cell.dayNumber}</span>
                              </label>
                            );
                          }
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Observación (opcional)
                </label>
                <textarea
                  value={actObservation}
                  onChange={(e) => setActObservation(e.target.value)}
                  rows={3}
                  placeholder="Ej: usar la llave ed25519 del servidor"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none resize-y"
                />
              </div>

              {activityFormError && (
                <p className="text-xs font-medium text-red-600">
                  {activityFormError}
                </p>
              )}

              <div className="flex justify-end gap-[0.55rem] pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowActivityModal(false);
                    setEditingActivity(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingActivity}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submittingActivity
                    ? "Guardando..."
                    : editingActivity
                      ? "Guardar cambios"
                      : "Crear actividad"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TILDAR UNA MISMA ACTIVIDAD PARA VARIOS DÍAS */}
      {multiDayActivity && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 my-8">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Tildar actividad para varios días
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              Actividad:{" "}
              <strong className="text-slate-900">{multiDayActivity.name}</strong>
              . Tildá los días del calendario en los que querés agendar esta
              actividad.
            </p>

            <form onSubmit={handleSaveMultiDayModal} className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (multiDayCalMonth === 0) {
                      setMultiDayCalYear((y) => y - 1);
                      setMultiDayCalMonth(11);
                    } else {
                      setMultiDayCalMonth((m) => m - 1);
                    }
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  ← Mes anterior
                </button>
                <span className="text-sm font-bold text-slate-900">
                  {MONTH_NAMES_ES[multiDayCalMonth]} {multiDayCalYear}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (multiDayCalMonth === 11) {
                      setMultiDayCalYear((y) => y + 1);
                      setMultiDayCalMonth(0);
                    } else {
                      setMultiDayCalMonth((m) => m + 1);
                    }
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Mes siguiente →
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-bold text-slate-600">
                {WEEKDAY_NAMES_ES.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {getCalendarGridDays(multiDayCalYear, multiDayCalMonth).map(
                  (cell) => {
                    const baseKey = formatDateKey(multiDayActivity.startDate);
                    const isBase = cell.dateKey === baseKey;
                    const isChecked = multiDayCheckedKeys.includes(
                      cell.dateKey
                    );

                    return (
                      <label
                        key={cell.dateKey}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border text-xs cursor-pointer transition ${isChecked
                            ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                            : cell.isCurrentMonth
                              ? "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                              : "bg-slate-50 text-slate-400 border-slate-200"
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isBase}
                          onChange={() => toggleMultiDayKey(cell.dateKey)}
                          className="h-3.5 w-3.5 mb-1 accent-white cursor-pointer"
                        />
                        <span>{cell.dayNumber}</span>
                      </label>
                    );
                  }
                )}
              </div>

              <p className="text-xs text-slate-500">
                Total de días tildados:{" "}
                <strong className="text-indigo-700">
                  {multiDayCheckedKeys.length}
                </strong>
              </p>

              {multiDayError && (
                <p className="text-xs font-medium text-red-600">
                  {multiDayError}
                </p>
              )}

              <div className="flex justify-end gap-[0.55rem] pt-2">
                <button
                  type="button"
                  onClick={() => setMultiDayActivity(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingMultiDay}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submittingMultiDay
                    ? "Guardando..."
                    : "Guardar días tildados"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: FINALIZAR ACTIVIDAD / MODIFICAR FINALIZACIÓN REAL */}
      {finalizingActivity && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 my-8">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {finalizingActivity.actualEndDate
                ? "Modificar fecha y hora de finalización real"
                : "Finalizar actividad"}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Actividad:{" "}
              <strong className="text-slate-800">
                {finalizingActivity.name}
              </strong>
            </p>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 mb-4 space-y-1">
              {isScheduled(finalizingActivity) ? (
                <>
                  <div>
                    <span>Fecha de inicio: </span>
                    <strong className="text-slate-800">
                      {formatDateTimeDisplay(finalizingActivity.startDate)}
                    </strong>
                  </div>
                  <div>
                    <span>Finalización estimada: </span>
                    <strong className="text-indigo-700">
                      {formatDateTimeDisplay(finalizingActivity.estimatedEndDate)}
                    </strong>{" "}
                    (
                    {formatDurationWithUnit(
                      finalizingActivity.estimatedAmount,
                      finalizingActivity.estimatedUnit
                    )}
                    )
                  </div>
                </>
              ) : (
                <div className="italic">Tarea sin horario.</div>
              )}
            </div>

            <form onSubmit={handleSaveFinalize} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Fecha de finalización real
                  </label>
                  <input
                    type="date"
                    value={actualEndDateInput.split("T")[0] || ""}
                    onChange={(e) => {
                      const datePart = e.target.value;
                      const timePart =
                        actualEndDateInput.split("T")[1] || "00:00";
                      setActualEndDateInput(
                        datePart ? `${datePart}T${timePart}` : ""
                      );
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Horario de finalización (cada 15 min)
                  </label>
                  <select
                    value={actualEndDateInput.split("T")[1] || "00:00"}
                    onChange={(e) => {
                      const datePart =
                        actualEndDateInput.split("T")[0] ||
                        formatDateKey(new Date());
                      setActualEndDateInput(`${datePart}T${e.target.value}`);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white"
                  >
                    {TIME_SLOTS_15_MIN.map((slot) => (
                      <option key={slot.value} value={slot.value}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Observaciones de finalización: una por renglón */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Observaciones (opcional, una por renglón)
                </label>
                {finalizeNotes.length > 0 && (
                  <ul className="mb-2 space-y-1.5">
                    {finalizeNotes.map((note, i) => (
                      <li
                        key={`${i}-${note}`}
                        className="flex items-start justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-sm text-slate-800"
                      >
                        <span className="break-words min-w-0">{note}</span>
                        <button
                          type="button"
                          onClick={() => removeFinalizeNote(i)}
                          title="Quitar observación"
                          className="shrink-0 text-slate-400 hover:text-red-600 font-bold leading-none px-1"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={finalizeNoteInput}
                    onChange={(e) => setFinalizeNoteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addFinalizeNote();
                      }
                    }}
                    placeholder="Ej: Contraseñas desactivadas"
                    className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addFinalizeNote}
                    disabled={!finalizeNoteInput.trim()}
                    className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition"
                  >
                    + Agregar
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Escribí una observación y tocá &quot;+ Agregar&quot; (o Enter)
                  para sumar otra. Se muestran en el árbol conectadas a la tarea.
                </p>
              </div>

              {finalizeError && (
                <p className="text-xs font-medium text-red-600">
                  {finalizeError}
                </p>
              )}

              <div className="flex justify-end gap-[0.55rem] pt-2">
                <button
                  type="button"
                  onClick={() => setFinalizingActivity(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingFinalize}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submittingFinalize
                    ? "Guardando..."
                    : "Confirmar finalización"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR ELIMINACIÓN DE ACTIVIDAD */}
      {deletingActivity && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">
              Confirmar eliminación de actividad
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              ¿Estás seguro de que querés eliminar la actividad{" "}
              <strong className="text-slate-900">
                {deletingActivity.name}
              </strong>
              ?
            </p>
            {(() => {
              const childCount =
                nodeById.get(deletingActivity.id)?.children.length ?? 0;
              if (childCount === 0) return null;
              const parentName =
                deletingActivity.parentId !== null
                  ? nodeById.get(deletingActivity.parentId)?.activity.name
                  : null;
              return (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  Tiene {childCount}{" "}
                  {childCount === 1 ? "actividad hija, que subirá" : "actividades hijas, que subirán"}{" "}
                  un nivel y {childCount === 1 ? "quedará" : "quedarán"}{" "}
                  {parentName ? (
                    <>
                      dentro de <strong>{parentName}</strong>
                    </>
                  ) : (
                    "como actividades principales de la lista"
                  )}
                  . No se borra ninguna hija.
                </p>
              );
            })()}
            <div className="flex justify-end gap-[0.55rem]">
              <button
                type="button"
                onClick={() => setDeletingActivity(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submittingActivity}
                onClick={handleConfirmDeleteActivity}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {submittingActivity
                  ? "Eliminando..."
                  : "Sí, eliminar actividad"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
