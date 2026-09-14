/**
 * チケット・バックログのドメイン型。backend の応答（`ticketResponse` 系。
 * `backend/internal/handler/ticket_handler.go` `ticket_status_handler.go` `ticket_type_handler.go`
 * 参照）と 1:1 対応させる。
 *
 * Go 側の `omitempty` フィールド（parentId / startDate / dueDate / closedAt / resolution /
 * archivedAt / assigneePrincipalId）は値が無いとキー自体が応答から消える。ここでは
 * `?: T | null` ではなく `?: T` のまま宣言し、`ticketRepository.ts` の normalize 関数が
 * `?? null` に畳んでから返す（entities/kb の TicketWire 相当のパターン）ので、
 * repository の外（hook / component）ではすべてのフィールドが `null` か値のどちらかで
 * 揃っている前提でよい。
 */

/** domain.TicketPriority（1=高 2=中(既定) 3=低）。 */
export type TicketPriority = 1 | 2 | 3;

/** domain.TicketStatusCategory。 */
export type TicketStatusCategory = 'todo' | 'in_progress' | 'done';

/** domain.TicketResolution。category = 'done' のときだけ意味を持つ。 */
export type TicketResolution = 'done' | 'wont_do' | 'invalid' | 'duplicate' | 'cannot_reproduce';

/** domain.TicketType.HierarchyLevel（1=束ね 0=標準 -1=小作業）。 */
export type TicketHierarchyLevel = 1 | 0 | -1;

/** domain.TicketChangeField。 */
export type TicketChangeField =
  | 'title'
  | 'doc'
  | 'status'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'parent'
  | 'start_date'
  | 'due_date'
  | 'resolution'
  | 'position'
  | 'archived'
  | 'category'
  | 'milestone'
  | 'link';

/**
 * ラベル（ワークスペースごとに定義し、ページとチケットへ付け外しする）。
 *
 * color は `#rrggbb` の小文字 7 桁で、利用者が自由に決める。読みやすさの担保は
 * 画面側の仕事になる（shared/lib/labelPaint.ts）。
 */
export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * チケット添付ファイル 1 件（メタデータのみ。本体は Cloud Storage）。
 *
 * `key`（保存先のオブジェクトキー）は応答に含まれない — ダウンロードは
 * 都度期限付き URL を発行する専用の口を通す（`fetchTicketAttachmentDownloadUrl`）。
 */
export interface TicketAttachment {
  id: string;
  ticketId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: number;
  createdAt: string;
}

/**
 * チケット 1 件に対する実効権限。役割は閲覧 / 発言 / 編集 / 管理の 4 段で、
 * 編集できることと他人の発言を消せることは別の段。
 *
 * 詳細の応答にだけ入る（一覧には入らない — 権限はプロジェクト単位で行ごとに変わらない）。
 */
export interface TicketPermission {
  canView: boolean;
  canComment: boolean;
  canEdit: boolean;
  canManage: boolean;
}

/** backend の wire 形（ticketRepository.ts の内部でのみ使う。外へは Ticket として出す）。 */
export interface TicketWire {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  typeId: string;
  statusId: string;
  parentId?: string;
  title: string;
  doc: unknown;
  priority: TicketPriority;
  storyPoints?: number;
  startDate?: string;
  dueDate?: string;
  teamId?: string;
  position: string;
  closedAt?: string;
  resolution?: TicketResolution;
  createdByUserId: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  assigneePrincipalId?: string;
  labels?: Label[] | null;
  /** 根から順の祖先（自分自身は含まない）。詳細の応答にだけ入る。 */
  ancestors?: TicketWire[] | null;
  permission?: TicketPermission | null;
}

/** normalizeTicket 後の形。すべてのフィールドが揃っている（省略は無い）。 */
export interface Ticket {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  typeId: string;
  statusId: string;
  parentId: string | null;
  title: string;
  doc: unknown;
  priority: TicketPriority;
  /** 見積り。未見積りは null（0 とは別物 —— 0 は「0 ポイント」）。 */
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
  /** 担当チーム。未設定は null。選べるのは同じプロジェクトのチームだけ（DB が守る）。 */
  teamId: string | null;
  position: string;
  closedAt: string | null;
  resolution: TicketResolution | null;
  createdByUserId: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assigneePrincipalId: string | null;
  /** 付いているラベル。一覧・詳細のどちらの応答にも入っている（0 件なら空配列）。 */
  labels: Label[];
}

/** チケットの表示キー（例 FRESTYLE-12）。projectKey + number から組み立てる（lib/ticketKey.ts）。 */
export type TicketKey = string;

export interface TicketStatusWire {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  category: TicketStatusCategory;
  color: string;
  position: string;
  isInitial: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  activeTicketCount: number;
}

export interface TicketStatus {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  category: TicketStatusCategory;
  color: string;
  position: string;
  isInitial: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 現役チケットでの使用数（管理画面の「使用中 N 件」）。 */
  activeTicketCount: number;
}

export interface TicketTypeWire {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  hierarchyLevel: TicketHierarchyLevel;
  color: string;
  position: string;
  isDefault: boolean;
  templateTitle?: string;
  templateDoc?: unknown;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  activeTicketCount: number;
}

export interface TicketType {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  hierarchyLevel: TicketHierarchyLevel;
  color: string;
  position: string;
  isDefault: boolean;
  templateTitle: string | null;
  templateDoc: unknown | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeTicketCount: number;
}

/** PUT .../tickets/:id/assignee の応答（domain.TicketAssignment）。 */
export interface TicketAssignment {
  workspaceId: string;
  ticketId: string;
  assigneePrincipalId: string;
  assignedByUserId: number;
  createdAt: string;
}

export interface TicketChangeItem {
  id: string;
  groupId: string;
  field: TicketChangeField;
  oldValue: string | null;
  newValue: string | null;
  oldLabel: string | null;
  newLabel: string | null;
}

export interface TicketChangeGroup {
  id: string;
  workspaceId: string;
  ticketId: string;
  actorUserId: number;
  createdAt: string;
  items: TicketChangeItem[];
}

/** 発言・編集履歴の書き手（backend が userId から名前まで解決して返す）。 */
export interface TicketCommentAuthor {
  userId: number;
  name: string;
}

/** 1 人 1 絵文字ぶんの反応。同じ発言に同じ人が複数の絵文字を付けられる。 */
export interface TicketCommentReaction {
  userId: number;
  emoji: string;
}

/**
 * 発言の本文を組み立てる 1 単位。
 *
 * backend の本文はチケット本体の `doc` とは別物で、段落を持たないインラインノードの配列
 * （`[{type:'text',text:'…'},{type:'mention',attrs:{userId:'42'}}]`）。ここではその配列を
 * 画面が扱いやすい形へ畳んだものを持つ。往復は `lib/commentBody.ts` が受け持つ。
 */
/**
 * 発言の文字区間に付く書式。
 *
 * **ここに無い marks は読み込みの時点で捨てる。** backend は marks を検証しないので、
 * 保存されている値が画面の書いたものだとは限らない（commentBody.ts の readCommentBody
 * 参照）。許可リストで受けることで、知らない飾りは自動的に不許可側へ倒れる。
 */
export interface TicketCommentMarks {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** リンク先。読み込み時に安全なもの（http / https / mailto / tel）だけが残る。 */
  href?: string;
}

export type TicketCommentSegment =
  | { kind: 'text'; text: string; marks?: TicketCommentMarks }
  | { kind: 'mention'; userId: string };

/**
 * 発言の本文の 1 塊。段落か、箇条書き（番号付きを含む）のどちらか。
 *
 * 以前の本文は「段落を持たない一列」（TicketCommentSegment[]）だった。箇条書きを
 * 書けるようにするため塊の列へ広げたが、**古い一列の本文も読める**ようにしてある
 * （読み込みが 1 つの段落として畳む。commentBody.ts の readCommentBody 参照）。
 */
export type TicketCommentBlock =
  | { kind: 'paragraph'; segments: TicketCommentSegment[] }
  | {
      kind: 'list';
      /** true なら番号付き、false なら箇条書き。 */
      ordered: boolean;
      /** 項目 1 つが段落 1 つ分の区間の列。 */
      items: TicketCommentSegment[][];
    };

export interface TicketCommentWire {
  id: string;
  parentCommentId?: string;
  author: TicketCommentAuthor;
  body: unknown;
  edited: boolean;
  reactions?: TicketCommentReaction[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketComment {
  id: string;
  /** 返信先。トップレベルの発言は null。 */
  parentCommentId: string | null;
  author: TicketCommentAuthor;
  body: TicketCommentBlock[];
  /** 一度でも編集されていれば true（編集前の本文は別の口で引く）。 */
  edited: boolean;
  reactions: TicketCommentReaction[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketCommentEditWire {
  id: string;
  editor: TicketCommentAuthor;
  previousBody: unknown;
  editedAt: string;
}

export interface TicketCommentEdit {
  id: string;
  editor: TicketCommentAuthor;
  previousBody: TicketCommentBlock[];
  editedAt: string;
}

/** GET /api/v2/tickets/:ticketId（slug 無し解決）の応答。 */
export interface ResolvedTicket {
  workspaceSlug: string;
  workspaceName: string;
  ticket: Ticket;
  canEdit: boolean;
  /** 根から順の祖先（自分自身は含まない）。親が無ければ空配列。 */
  ancestors: Ticket[];
  permission: TicketPermission;
}

/** チケット一覧の絞り込み（List のクエリパラメータに対応）。 */
export interface TicketListFilter {
  statusId?: string;
  typeId?: string;
  assigneePrincipalId?: string;
  labelId?: string;
  /** true でアーカイブ済みだけを返す（現役との「込み」は取れない。設計 Ⅳ-C）。 */
  archived?: boolean;
  /** 担当が付いていないチケットだけ。assigneePrincipalId / assignedToMe とは互いに排他。 */
  unassigned?: boolean;
  /** 自分が担当のチケットだけ。principal の解決は backend が行う（フロントでは計算しない）。 */
  assignedToMe?: boolean;
  /** 期限が今日より前、かつ状態が完了(done)ではないチケットだけ。 */
  overdue?: boolean;
  /** 題名・本文のあいまい検索（ILIKE 中間一致 + word_similarity）。 */
  q?: string;
}

/** GET .../tickets/counts の応答。サイドバー「保存した絞り込み」の件数バッジ。 */
export interface TicketCounts {
  total: number;
  assignedToMe: number;
  overdue: number;
  unassigned: number;
}

/** POST .../tickets/enable の応答。 */
export interface EnableTicketsResult {
  statusCount: number;
  typeCount: number;
}

/**
 * AssignedTicket は「自分の担当」1 行。プロジェクトを横断する画面なので、行を読むのに
 * 要る隣の値（プロジェクト・状態・種別）が同じ行に入っている。本文（doc）は載らない
 * —— 一覧で本文は読まないため（開けばチケット本体が取れる）。
 */
export interface AssignedTicket {
  id: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  number: number;
  title: string;
  typeName: string;
  statusName: string;
  /** 'todo' | 'in_progress' | 'done'。束ねる見出しはこれで決める（名前では束ねない）。 */
  statusCategory: string;
  statusColor: string;
  priority: number;
  dueDate: string | null;
}

/** 監視の状態（自分が監視しているか・全体で何人か）。 */
export interface TicketWatchState {
  watching: boolean;
  count: number;
}
