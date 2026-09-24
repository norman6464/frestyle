import apiClient from '@/shared/api/axios';
import axios from 'axios';
import { TICKET_API } from '@/shared/config/apiRoutes';
import { toArray } from '@/shared/lib/toArray';
import { readCommentBody, buildCommentBody } from '../lib/commentBody';
import type {
  AssignedTicket,
  MyAssignedTicket,
  TicketReference,
  TicketWatchState,
  EnableTicketsResult,
  Label,
  ResolvedTicket,
  Ticket,
  TicketAssignment,
  TicketChangeGroup,
  TicketComment,
  TicketCommentEdit,
  TicketCommentEditWire,
  TicketCommentBlock,
  TicketCommentWire,
  TicketCounts,
  TicketHierarchyLevel,
  TicketListFilter,
  TicketAttachment,
  TicketPriority,
  TicketResolution,
  TicketSavedFilter,
  TicketSavedFilterInput,
  TicketSavedFilterWire,
  TicketStatus,
  TicketStatusCategory,
  TicketStatusWire,
  TicketType,
  TicketTypeWire,
  TicketWire,
} from '../model/types';

/**
 * チケット・バックログの repository。`entities/kb/api/kbRepository.ts` と同じ形
 * （プレーンオブジェクト + default export、axios は `@/shared/api/axios` の 1 個だけを使う
 * ので認証ヘッダは何もしなくてよい）。
 *
 * 失敗は例外として投げる。ここで握り潰して null / false を返すと、呼び出し側は
 * 失敗を知りようがない。
 */

function normalizeTicket(wire: TicketWire): Ticket {
  return {
    id: wire.id,
    workspaceId: wire.workspaceId,
    projectId: wire.projectId,
    number: wire.number,
    typeId: wire.typeId,
    statusId: wire.statusId,
    parentId: wire.parentId ?? null,
    title: wire.title,
    doc: wire.doc,
    priority: wire.priority,
    storyPoints: wire.storyPoints ?? null,
    startDate: wire.startDate ?? null,
    dueDate: wire.dueDate ?? null,
    teamId: wire.teamId ?? null,
    position: wire.position,
    closedAt: wire.closedAt ?? null,
    resolution: wire.resolution ?? null,
    createdByUserId: wire.createdByUserId,
    archivedAt: wire.archivedAt ?? null,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    assigneePrincipalId: wire.assigneePrincipalId ?? null,
    labels: toArray<Label>(wire.labels),
  };
}

// 状態・種別の Create/Update 応答は activeTicketCount を持たない（backend が domain 構造体を
// そのまま返すだけの経路のため）。呼び出し側（useTicketMasters）はこの正規化のあとに
// 必ず一覧を取り直すので、ここでの 0 は一瞬しか見えない暫定値でよい（設計 Ⅶ「状態 / 種別の
// 変更 → マスタを取り直す」）。
function normalizeTicketStatus(wire: TicketStatusWire): TicketStatus {
  return {
    id: wire.id,
    workspaceId: wire.workspaceId,
    projectId: wire.projectId,
    name: wire.name,
    category: wire.category,
    color: wire.color,
    position: wire.position,
    isInitial: wire.isInitial,
    archivedAt: wire.archivedAt ?? null,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    activeTicketCount: wire.activeTicketCount ?? 0,
  };
}

function normalizeTicketType(wire: TicketTypeWire): TicketType {
  return {
    id: wire.id,
    workspaceId: wire.workspaceId,
    projectId: wire.projectId,
    name: wire.name,
    hierarchyLevel: wire.hierarchyLevel,
    color: wire.color,
    position: wire.position,
    isDefault: wire.isDefault,
    templateTitle: wire.templateTitle ?? null,
    templateDoc: wire.templateDoc ?? null,
    archivedAt: wire.archivedAt ?? null,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    activeTicketCount: wire.activeTicketCount ?? 0,
  };
}

function normalizeComment(wire: TicketCommentWire): TicketComment {
  return {
    id: wire.id,
    parentCommentId: wire.parentCommentId ?? null,
    author: wire.author,
    body: readCommentBody(wire.body),
    edited: wire.edited,
    // 応答は必ず配列（0 件でも []）。それでも防御的に toArray を通す
    // （編集応答は reactions を運ばないので、呼び出し側が手元の値を残す判断をする）。
    reactions: toArray(wire.reactions),
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

function normalizeSavedFilter(wire: TicketSavedFilterWire): TicketSavedFilter {
  return {
    id: wire.id,
    name: wire.name,
    statusId: wire.statusId ?? null,
    typeId: wire.typeId ?? null,
    labelId: wire.labelId ?? null,
    assigneePrincipalId: wire.assigneePrincipalId ?? null,
    unassigned: wire.unassigned,
    assignedToMe: wire.assignedToMe,
    overdue: wire.overdue,
    q: wire.q ?? null,
    count: wire.count,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

/** 保存・更新の入力を送る形にする。null は「指定なし」で、backend は空文字も同じに読む。 */
function savedFilterBody(input: TicketSavedFilterInput) {
  return {
    name: input.name,
    statusId: input.statusId ?? null,
    typeId: input.typeId ?? null,
    labelId: input.labelId ?? null,
    assigneePrincipalId: input.assigneePrincipalId ?? null,
    unassigned: input.unassigned ?? false,
    assignedToMe: input.assignedToMe ?? false,
    overdue: input.overdue ?? false,
    q: input.q ?? null,
  };
}

function normalizeCommentEdit(wire: TicketCommentEditWire): TicketCommentEdit {
  return {
    id: wire.id,
    editor: wire.editor,
    previousBody: readCommentBody(wire.previousBody),
    editedAt: wire.editedAt,
  };
}

export interface CreateTicketInput {
  parentId?: string;
  typeId?: string;
  statusId?: string;
  title: string;
  doc?: unknown;
  priority?: TicketPriority;
  startDate?: string;
  dueDate?: string;
}

export interface UpdateTicketInput {
  title: string;
  doc: unknown;
  typeId: string;
  priority: TicketPriority;
  /** 未見積りにするなら null（省略も同じ）。0 は「0 ポイント」で別物。 */
  storyPoints?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface MoveTicketInput {
  anchorTicketId?: string;
  anchorAfter?: boolean;
}

export interface ChangeTicketStatusInput {
  statusId: string;
  resolution?: TicketResolution;
}

export interface LabelInput {
  name: string;
  /** `#rrggbb` の小文字 7 桁。 */
  color: string;
}

/** アップロード URL 発行の応答。key は Create の呼び出しにそのまま渡す。 */
export interface AttachmentUploadUrl {
  url: string;
  key: string;
  expiresIn: number;
}

export interface AttachmentDownloadUrl {
  url: string;
  expiresIn: number;
}

export interface TicketStatusInput {
  name: string;
  category: TicketStatusCategory;
  color: string;
}

export interface TicketTypeInput {
  name: string;
  hierarchyLevel: TicketHierarchyLevel;
  color: string;
}

const TicketRepository = {
  async enable(
    workspaceSlug: string,
    projectId: string,
    sourceSpaceId?: string,
  ): Promise<EnableTicketsResult> {
    const res = await apiClient.post<EnableTicketsResult>(TICKET_API.enable(workspaceSlug, projectId), {
      sourceSpaceId: sourceSpaceId ?? '',
    });
    return res.data;
  },

  async fetchTickets(
    workspaceSlug: string,
    projectId: string,
    filter: TicketListFilter = {},
  ): Promise<Ticket[]> {
    const params: Record<string, string> = {};
    if (filter.statusId) params.statusId = filter.statusId;
    if (filter.typeId) params.typeId = filter.typeId;
    if (filter.assigneePrincipalId) params.assigneePrincipalId = filter.assigneePrincipalId;
    if (filter.labelId) params.label = filter.labelId;
    if (filter.archived) params.archived = 'true';
    if (filter.unassigned) params.unassigned = 'true';
    if (filter.assignedToMe) params.assignedToMe = 'true';
    if (filter.overdue) params.overdue = 'true';
    if (filter.q) params.q = filter.q;
    const res = await apiClient.get<{ tickets: TicketWire[] }>(TICKET_API.tickets(workspaceSlug, projectId), {
      params,
    });
    return toArray<TicketWire>(res.data?.tickets).map(normalizeTicket);
  },

  /**
   * 「自分の担当」。ワークスペース全体を横断して、呼び出した本人に割り当たっている
   * 現役のチケットを返す。並びは backend が決める（状態の枠 → 状態 → 期限）ので、
   * 画面側は返ってきた順のまま束ねて出せばよい。
   */
  async fetchAssignedTickets(workspaceSlug: string): Promise<AssignedTicket[]> {
    const res = await apiClient.get<{ tickets: AssignedTicket[] }>(TICKET_API.assignedTickets(workspaceSlug));
    return toArray<AssignedTicket>(res.data?.tickets);
  },

  /** GET — 全ワークスペース横断の自分の担当（未完了・期限の近い順・上限つき）。 */
  async fetchMyAssignedTickets(limit: number, signal?: AbortSignal): Promise<MyAssignedTicket[]> {
    const res = await apiClient.get<{ tickets: MyAssignedTicket[] }>(TICKET_API.myAssignedTickets(limit), { signal });
    return toArray<MyAssignedTicket>(res.data?.tickets);
  },

  /** GET — そのページを本文で参照しているチケット（更新の新しい順・上限つき）。 */
  async fetchPageTicketReferences(
    workspaceSlug: string,
    pageId: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TicketReference[]> {
    const res = await apiClient.get<{ tickets: TicketReference[] }>(
      TICKET_API.pageTicketReferences(workspaceSlug, pageId, limit),
      { signal },
    );
    return toArray<TicketReference>(res.data?.tickets);
  },

  /** GET — 監視の状態（自分が監視しているか・何人が監視しているか）。 */
  async fetchTicketWatchState(workspaceSlug: string, ticketId: string): Promise<TicketWatchState> {
    const res = await apiClient.get<TicketWatchState>(TICKET_API.ticketWatch(workspaceSlug, ticketId));
    return res.data;
  },

  /**
   * PUT — 自分の監視を付け外しする。押すたびに切り替えるのではなく「どちらにしたいか」を
   * 送る（二重送信で意図せず外れるのを防ぐ）。
   */
  async setTicketWatching(workspaceSlug: string, ticketId: string, watching: boolean): Promise<TicketWatchState> {
    const res = await apiClient.put<TicketWatchState>(TICKET_API.ticketWatch(workspaceSlug, ticketId), { watching });
    return res.data;
  },

  /** サイドバー「保存した絞り込み」の件数バッジ。 */
  async fetchTicketCounts(workspaceSlug: string, projectId: string): Promise<TicketCounts> {
    const res = await apiClient.get<TicketCounts>(TICKET_API.ticketCounts(workspaceSlug, projectId));
    return res.data;
  },

  /** 本人がそのプロジェクトで保存した絞り込み。作った順・件数付き。0 件は []。 */
  async fetchSavedFilters(workspaceSlug: string, projectId: string): Promise<TicketSavedFilter[]> {
    const res = await apiClient.get<{ savedFilters: TicketSavedFilterWire[] }>(
      TICKET_API.savedFilters(workspaceSlug, projectId),
    );
    return toArray<TicketSavedFilterWire>(res.data?.savedFilters).map(normalizeSavedFilter);
  },

  /**
   * 絞り込みに名前を付けて保存する。同名は 409 saved_filter_name_taken、上限（20 件）は
   * 409 saved_filter_limit_reached、条件なしは 400 filter_has_no_condition。
   */
  async createSavedFilter(
    workspaceSlug: string,
    projectId: string,
    input: TicketSavedFilterInput,
  ): Promise<TicketSavedFilter> {
    const res = await apiClient.post<TicketSavedFilterWire>(
      TICKET_API.savedFilters(workspaceSlug, projectId),
      savedFilterBody(input),
    );
    return normalizeSavedFilter(res.data);
  },

  /** 名前と条件を丸ごと差し替える（部分更新は無い）。他人の分・別プロジェクトは 404。 */
  async updateSavedFilter(
    workspaceSlug: string,
    projectId: string,
    filterId: string,
    input: TicketSavedFilterInput,
  ): Promise<TicketSavedFilter> {
    const res = await apiClient.put<TicketSavedFilterWire>(
      TICKET_API.savedFilter(workspaceSlug, projectId, filterId),
      savedFilterBody(input),
    );
    return normalizeSavedFilter(res.data);
  },

  /** 204 応答。他人の分・別プロジェクトは 404。 */
  async deleteSavedFilter(workspaceSlug: string, projectId: string, filterId: string): Promise<void> {
    await apiClient.delete(TICKET_API.savedFilter(workspaceSlug, projectId, filterId));
  },

  /** 直下の子だけ（孫は含まない）。並び順は一覧と同じ position 準拠。 */
  async fetchTicketChildren(workspaceSlug: string, ticketId: string): Promise<Ticket[]> {
    const res = await apiClient.get<{ tickets: TicketWire[] }>(TICKET_API.ticketChildren(workspaceSlug, ticketId));
    return toArray<TicketWire>(res.data?.tickets).map(normalizeTicket);
  },

  async createTicket(workspaceSlug: string, projectId: string, input: CreateTicketInput): Promise<Ticket> {
    const res = await apiClient.post<TicketWire>(TICKET_API.tickets(workspaceSlug, projectId), {
      parentId: input.parentId ?? '',
      typeId: input.typeId ?? '',
      statusId: input.statusId ?? '',
      title: input.title,
      doc: input.doc,
      priority: input.priority ?? 0,
      startDate: input.startDate,
      dueDate: input.dueDate,
    });
    return normalizeTicket(res.data);
  },

  async fetchTicket(workspaceSlug: string, ticketId: string): Promise<Ticket> {
    const res = await apiClient.get<TicketWire>(TICKET_API.ticket(workspaceSlug, ticketId));
    return normalizeTicket(res.data);
  },

  async fetchTicketByKey(workspaceSlug: string, key: string): Promise<Ticket> {
    const res = await apiClient.get<TicketWire>(TICKET_API.ticketByKey(workspaceSlug, key));
    return normalizeTicket(res.data);
  },

  async resolveTicket(ticketId: string): Promise<ResolvedTicket> {
    const res = await apiClient.get<{
      workspaceSlug: string;
      workspaceName: string;
      ticket: TicketWire;
      canEdit: boolean;
    }>(TICKET_API.resolveTicket(ticketId));
    const wire = res.data.ticket;
    return {
      workspaceSlug: res.data.workspaceSlug,
      workspaceName: res.data.workspaceName,
      ticket: normalizeTicket(wire),
      canEdit: res.data.canEdit,
      ancestors: toArray<TicketWire>(wire.ancestors).map(normalizeTicket),
      // 権限が応答に無いときは、発言は塞がず・他人の発言への操作は出さない側へ倒す。
      // 塞ぐ方の間違い（権限があるのに使えない）は気づかれにくく、直す手立ても無い。
      permission: wire.permission ?? {
        canView: true,
        canComment: true,
        canEdit: res.data.canEdit,
        canManage: false,
      },
    };
  },

  async updateTicket(workspaceSlug: string, ticketId: string, input: UpdateTicketInput): Promise<Ticket> {
    const res = await apiClient.put<TicketWire>(TICKET_API.ticket(workspaceSlug, ticketId), {
      title: input.title,
      doc: input.doc,
      typeId: input.typeId,
      priority: input.priority,
      storyPoints: input.storyPoints ?? undefined,
      startDate: input.startDate ?? undefined,
      dueDate: input.dueDate ?? undefined,
    });
    return normalizeTicket(res.data);
  },

  /** 204 応答。並び替え後の順位は一覧の取り直しでしか分からない（設計 Ⅶ）。 */
  async moveTicket(workspaceSlug: string, ticketId: string, input: MoveTicketInput): Promise<void> {
    await apiClient.post(TICKET_API.moveTicket(workspaceSlug, ticketId), {
      anchorTicketId: input.anchorTicketId ?? '',
      anchorAfter: input.anchorAfter ?? false,
    });
  },

  async archiveTicket(workspaceSlug: string, ticketId: string): Promise<Ticket> {
    const res = await apiClient.post<TicketWire>(TICKET_API.archiveTicket(workspaceSlug, ticketId));
    return normalizeTicket(res.data);
  },

  async restoreTicket(workspaceSlug: string, ticketId: string): Promise<Ticket> {
    const res = await apiClient.post<TicketWire>(TICKET_API.restoreTicket(workspaceSlug, ticketId));
    return normalizeTicket(res.data);
  },

  async changeTicketStatus(
    workspaceSlug: string,
    ticketId: string,
    input: ChangeTicketStatusInput,
  ): Promise<Ticket> {
    const res = await apiClient.post<TicketWire>(TICKET_API.changeTicketStatus(workspaceSlug, ticketId), {
      statusId: input.statusId,
      resolution: input.resolution,
    });
    return normalizeTicket(res.data);
  },

  /** parentId に null（またはキー省略）を渡すとトップレベルへ戻す。 */
  async changeTicketParent(workspaceSlug: string, ticketId: string, parentId: string | null): Promise<Ticket> {
    const res = await apiClient.put<TicketWire>(TICKET_API.changeTicketParent(workspaceSlug, ticketId), {
      parentId: parentId ?? '',
    });
    return normalizeTicket(res.data);
  },

  async assignTicket(
    workspaceSlug: string,
    ticketId: string,
    assigneePrincipalId: string,
  ): Promise<TicketAssignment> {
    const res = await apiClient.put<TicketAssignment>(TICKET_API.ticketAssignee(workspaceSlug, ticketId), {
      assigneePrincipalId,
    });
    return res.data;
  },

  /** 204 応答。 */
  async unassignTicket(workspaceSlug: string, ticketId: string): Promise<void> {
    await apiClient.delete(TICKET_API.ticketAssignee(workspaceSlug, ticketId));
  },

  async fetchTicketHistory(workspaceSlug: string, ticketId: string): Promise<TicketChangeGroup[]> {
    const res = await apiClient.get<{ groups: TicketChangeGroup[] }>(
      TICKET_API.ticketHistory(workspaceSlug, ticketId),
    );
    return toArray<TicketChangeGroup>(res.data?.groups);
  },

  async fetchTicketStatuses(
    workspaceSlug: string,
    projectId: string,
    archived = false,
  ): Promise<TicketStatus[]> {
    const res = await apiClient.get<{ statuses: TicketStatusWire[] }>(
      TICKET_API.ticketStatuses(workspaceSlug, projectId),
      { params: archived ? { archived: 'true' } : undefined },
    );
    return toArray<TicketStatusWire>(res.data?.statuses).map(normalizeTicketStatus);
  },

  async createTicketStatus(workspaceSlug: string, projectId: string, input: TicketStatusInput): Promise<TicketStatus> {
    const res = await apiClient.post<TicketStatusWire>(TICKET_API.ticketStatuses(workspaceSlug, projectId), input);
    return normalizeTicketStatus(res.data);
  },

  async updateTicketStatus(
    workspaceSlug: string,
    projectId: string,
    statusId: string,
    input: TicketStatusInput,
  ): Promise<TicketStatus> {
    const res = await apiClient.put<TicketStatusWire>(
      TICKET_API.ticketStatus(workspaceSlug, projectId, statusId),
      input,
    );
    return normalizeTicketStatus(res.data);
  },

  /** 204 応答。 */
  async setInitialTicketStatus(workspaceSlug: string, projectId: string, statusId: string): Promise<void> {
    await apiClient.post(TICKET_API.setInitialTicketStatus(workspaceSlug, projectId, statusId));
  },

  /** 204 応答。使用中は 409 status_in_use。 */
  async archiveTicketStatus(workspaceSlug: string, projectId: string, statusId: string): Promise<void> {
    await apiClient.post(TICKET_API.archiveTicketStatus(workspaceSlug, projectId, statusId));
  },

  /** 204 応答。 */
  async restoreTicketStatus(workspaceSlug: string, projectId: string, statusId: string): Promise<void> {
    await apiClient.post(TICKET_API.restoreTicketStatus(workspaceSlug, projectId, statusId));
  },

  async fetchTicketTypes(workspaceSlug: string, projectId: string, archived = false): Promise<TicketType[]> {
    const res = await apiClient.get<{ types: TicketTypeWire[] }>(TICKET_API.ticketTypes(workspaceSlug, projectId), {
      params: archived ? { archived: 'true' } : undefined,
    });
    return toArray<TicketTypeWire>(res.data?.types).map(normalizeTicketType);
  },

  async createTicketType(workspaceSlug: string, projectId: string, input: TicketTypeInput): Promise<TicketType> {
    const res = await apiClient.post<TicketTypeWire>(TICKET_API.ticketTypes(workspaceSlug, projectId), input);
    return normalizeTicketType(res.data);
  },

  async updateTicketType(
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    input: TicketTypeInput,
  ): Promise<TicketType> {
    const res = await apiClient.put<TicketTypeWire>(TICKET_API.ticketType(workspaceSlug, projectId, typeId), input);
    return normalizeTicketType(res.data);
  },

  /** 204 応答。 */
  async setDefaultTicketType(workspaceSlug: string, projectId: string, typeId: string): Promise<void> {
    await apiClient.post(TICKET_API.setDefaultTicketType(workspaceSlug, projectId, typeId));
  },

  /** 204 応答。使用中は 409 type_in_use。 */
  async archiveTicketType(workspaceSlug: string, projectId: string, typeId: string): Promise<void> {
    await apiClient.post(TICKET_API.archiveTicketType(workspaceSlug, projectId, typeId));
  },

  /** 204 応答。 */
  async restoreTicketType(workspaceSlug: string, projectId: string, typeId: string): Promise<void> {
    await apiClient.post(TICKET_API.restoreTicketType(workspaceSlug, projectId, typeId));
  },

  /** 古い順（backend の並びのまま）。 */
  async fetchTicketComments(workspaceSlug: string, ticketId: string): Promise<TicketComment[]> {
    const res = await apiClient.get<{ comments: TicketCommentWire[] }>(TICKET_API.ticketComments(workspaceSlug, ticketId));
    return toArray<TicketCommentWire>(res.data?.comments).map(normalizeComment);
  },

  async createTicketComment(
    workspaceSlug: string,
    ticketId: string,
    body: TicketCommentBlock[],
    parentCommentId?: string,
  ): Promise<TicketComment> {
    const res = await apiClient.post<TicketCommentWire>(TICKET_API.ticketComments(workspaceSlug, ticketId), {
      parentCommentId,
      body: buildCommentBody(body),
    });
    return normalizeComment(res.data);
  },

  /**
   * 本文を置き換える。応答は反応を運ばない（backend が常に空配列で返す）ので、
   * 呼び出し側は応答の reactions を使わず、手元の値を残すこと。
   */
  async updateTicketComment(
    workspaceSlug: string,
    ticketId: string,
    commentId: string,
    body: TicketCommentBlock[],
  ): Promise<TicketComment> {
    const res = await apiClient.put<TicketCommentWire>(TICKET_API.ticketComment(workspaceSlug, ticketId, commentId), {
      body: buildCommentBody(body),
    });
    return normalizeComment(res.data);
  },

  /** 204 応答。 */
  async deleteTicketComment(workspaceSlug: string, ticketId: string, commentId: string): Promise<void> {
    await apiClient.delete(TICKET_API.ticketComment(workspaceSlug, ticketId, commentId));
  },

  /** 新しい順（backend の並びのまま）。 */
  async fetchTicketCommentEdits(workspaceSlug: string, ticketId: string, commentId: string): Promise<TicketCommentEdit[]> {
    const res = await apiClient.get<{ edits: TicketCommentEditWire[] }>(
      TICKET_API.ticketCommentEdits(workspaceSlug, ticketId, commentId),
    );
    return toArray<TicketCommentEditWire>(res.data?.edits).map(normalizeCommentEdit);
  },

  /** 204 応答・冪等。 */
  async addTicketCommentReaction(workspaceSlug: string, ticketId: string, commentId: string, emoji: string): Promise<void> {
    await apiClient.put(TICKET_API.ticketCommentReaction(workspaceSlug, ticketId, commentId, emoji));
  },

  /** 204 応答・冪等。 */
  async removeTicketCommentReaction(workspaceSlug: string, ticketId: string, commentId: string, emoji: string): Promise<void> {
    await apiClient.delete(TICKET_API.ticketCommentReaction(workspaceSlug, ticketId, commentId, emoji));
  },

  async fetchLabels(workspaceSlug: string): Promise<Label[]> {
    const res = await apiClient.get<{ labels: Label[] }>(TICKET_API.labels(workspaceSlug));
    return toArray<Label>(res.data?.labels);
  },

  async createLabel(workspaceSlug: string, input: LabelInput): Promise<Label> {
    const res = await apiClient.post<Label>(TICKET_API.labels(workspaceSlug), input);
    return res.data;
  },

  async updateLabel(workspaceSlug: string, labelId: string, input: LabelInput): Promise<Label> {
    const res = await apiClient.put<Label>(TICKET_API.label(workspaceSlug, labelId), input);
    return res.data;
  },

  /** 204 応答。使用中でも通る（付け外しの中間行は CASCADE で外れる）。 */
  async deleteLabel(workspaceSlug: string, labelId: string): Promise<void> {
    await apiClient.delete(TICKET_API.label(workspaceSlug, labelId));
  },

  /** 204 応答・冪等。 */
  async addTicketLabel(workspaceSlug: string, ticketId: string, labelId: string): Promise<void> {
    await apiClient.put(TICKET_API.ticketLabel(workspaceSlug, ticketId, labelId));
  },

  /** 204 応答・冪等（付いていなくても成功扱い）。 */
  async removeTicketLabel(workspaceSlug: string, ticketId: string, labelId: string): Promise<void> {
    await apiClient.delete(TICKET_API.ticketLabel(workspaceSlug, ticketId, labelId));
  },

  async fetchTicketAttachments(workspaceSlug: string, ticketId: string): Promise<TicketAttachment[]> {
    const res = await apiClient.get<{ attachments: TicketAttachment[] }>(
      TICKET_API.ticketAttachments(workspaceSlug, ticketId),
    );
    return toArray<TicketAttachment>(res.data?.attachments);
  },

  async issueTicketAttachmentUploadUrl(
    workspaceSlug: string,
    ticketId: string,
    contentType: string,
    size: number,
  ): Promise<AttachmentUploadUrl> {
    const res = await apiClient.post<AttachmentUploadUrl>(TICKET_API.ticketAttachmentUploadUrl(workspaceSlug, ticketId), {
      contentType,
      size,
    });
    return res.data;
  },

  /**
   * 発行済みの署名付き URL へ File を直接 PUT する（Cloud Storage への実アップロード）。
   *
   * `apiClient` ではなく素の axios を使う — baseURL も認証ヘッダも乗せてはいけない宛先
   * （`entities/user/api/imageUploadRepository.ts` と同じ理由）。Content-Type は
   * upload-url 発行時に渡した値と厳密に一致させる（GCS V4 署名に含まれる）。
   */
  async putTicketAttachmentFile(uploadUrl: string, file: File): Promise<void> {
    await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type } });
  },

  /** アップロード後の確定（メタデータの記録）。 */
  async createTicketAttachment(
    workspaceSlug: string,
    ticketId: string,
    input: { key: string; filename: string; contentType: string; sizeBytes: number },
  ): Promise<TicketAttachment> {
    const res = await apiClient.post<TicketAttachment>(TICKET_API.ticketAttachments(workspaceSlug, ticketId), input);
    return res.data;
  },

  async issueTicketAttachmentDownloadUrl(
    workspaceSlug: string,
    ticketId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadUrl> {
    const res = await apiClient.get<AttachmentDownloadUrl>(
      TICKET_API.ticketAttachmentDownloadUrl(workspaceSlug, ticketId, attachmentId),
    );
    return res.data;
  },

  /** 204 応答。Cloud Storage の実ファイルは消えない（kb ページ画像と同じ割り切り）。 */
  async deleteTicketAttachment(workspaceSlug: string, ticketId: string, attachmentId: string): Promise<void> {
    await apiClient.delete(TICKET_API.ticketAttachment(workspaceSlug, ticketId, attachmentId));
  },
};

export default TicketRepository;
