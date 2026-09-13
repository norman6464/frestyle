import axios from 'axios';
import apiClient from '@/shared/api/axios';
import { toArray } from '@/shared/lib/toArray';
import { KB_API } from '@/shared/config/apiRoutes';
import type { CommentAnchor } from '@/shared/ui/RichTextEditor';
import type {
  KbAdminWorkspaceMember,
  KbComment,
  KbCommentThread,
  KbFavoritePage,
  KbGrantablePrincipal,
  KbGrantRole,
  KbIcon,
  KbMySpace,
  KbPage,
  KbPageContentSaveResult,
  KbPageDoc,
  KbPageGrant,
  KbPageSuggestion,
  KbPageTemplate,
  KbPageTree,
  KbPageVersion,
  KbPageVersionDetail,
  KbResolvedCover,
  KbResolvedPage,
  KbSearchResult,
  KbSpace,
  KbSpaceMember,
  KbWorkspace,
  KbWorkspaceMember,
} from '../model/types';

/**
 * ナレッジの API（/api/v2/kb/…）の薄いラッパ。
 *
 * 認可はすべて backend が持つ。ここでフィルタを掛けないこと。返ってくる一覧は
 * **既に「その人に見えるものだけ」**になっていて、見えないものは応答に存在しない。
 * フロントで絞り込みを重ねると、同じ判断が 2 箇所に分かれて必ずずれる。
 *
 * 「無い」と「見えない」はどちらも 404 で返る（撃ち分けると ID の総当たりで実在が分かるため）。
 * したがって 404 を「あなたには見えません」と表示してはいけない。存在しないかもしれない。
 */
/**
 * comment-threads 系エンドポイントの生の応答形。
 *
 * backend は resolvedAt / resolvedBy を Go の `*time.Time` / ポインタ + `omitempty` で
 * 返すため、**未解決のスレッドではキー自体が応答に無い**（`null` ではなく丸ごと欠ける）。
 * entities/kb の KbCommentThread は `string | null` / `… | null` で固定しているので、
 * ここで正規化する（呼び出し側が `=== null` で判定できるようにするため）。
 */
type KbCommentThreadWire = Omit<KbCommentThread, 'resolvedAt' | 'resolvedBy' | 'comments'> & {
  resolvedAt?: string | null;
  resolvedBy?: KbCommentThread['resolvedBy'];
  comments?: KbComment[];
};

function normalizeCommentThread(raw: KbCommentThreadWire): KbCommentThread {
  return {
    id: raw.id,
    createdBy: raw.createdBy,
    createdAt: raw.createdAt,
    resolvedAt: raw.resolvedAt ?? null,
    resolvedBy: raw.resolvedBy ?? null,
    comments: toArray<KbComment>(raw.comments),
    // 錨付きコメントだけが持つ4つ。page-level のスレッドは応答にキー自体が無く、
    // raw.blockId 等は undefined になる（そのまま undefined を渡してよい —
    // KbCommentThread 側も任意フィールドとして定義してある）。
    blockId: raw.blockId,
    anchorFrom: raw.anchorFrom,
    anchorTo: raw.anchorTo,
    quote: raw.quote,
  };
}

/**
 * 版（バージョン）一覧・単体取得・作成の生の応答形。
 *
 * backend は note を Go の `*string` + `omitempty` で返すため、**メモを付けていない版では
 * キー自体が応答に無い**（`null` ではなく丸ごと欠ける — KbCommentThreadWire の
 * resolvedAt/resolvedBy と同じ理由）。entities/kb の KbPageVersion は note を
 * `string | null` で固定しているので、ここで正規化する。
 */
type KbPageVersionWire = Omit<KbPageVersion, 'note'> & { note?: string };
type KbPageVersionDetailWire = Omit<KbPageVersionDetail, 'note'> & { note?: string };

function normalizeVersion(raw: KbPageVersionWire): KbPageVersion {
  return {
    seq: raw.seq,
    author: raw.author,
    note: raw.note ?? null,
    createdAt: raw.createdAt,
  };
}

function normalizeVersionDetail(raw: KbPageVersionDetailWire): KbPageVersionDetail {
  return { ...normalizeVersion(raw), doc: raw.doc };
}

const KbRepository = {
  /** 自分が所属しているワークスペースの一覧。所属が無ければ空配列。 */
  async fetchWorkspaces(): Promise<KbWorkspace[]> {
    const res = await apiClient.get<KbWorkspace[]>(KB_API.workspaces);
    return toArray<KbWorkspace>(res.data);
  },

  /**
   * ワークスペース配下の、自分に見えるスペースの一覧。
   *
   * ワークスペースのメンバーなら誰でも叩けて、返る中身が権限で変わる（サイドバーの入口なので
   * admin では絞っていない）。未所属・存在しない slug はどちらも 404。
   */
  async fetchSpaces(workspaceSlug: string): Promise<KbSpace[]> {
    const res = await apiClient.get<KbSpace[]>(KB_API.spaces(workspaceSlug));
    return toArray<KbSpace>(res.data);
  },

  /**
   * 自分がアクセスできるスペースの一覧（段 14。id・name・role）。fetchSpaces と可視集合は
   * ほぼ同じだが、こちらは自分の役割も返す。サイドバーのスペース切替・入口解決に使う。
   */
  async fetchMySpaces(workspaceSlug: string): Promise<KbMySpace[]> {
    const res = await apiClient.get<KbMySpace[]>(KB_API.mySpaces(workspaceSlug));
    return toArray<KbMySpace>(res.data);
  },

  /**
   * スペース配下のページツリー。**一度に全件**返る（子を個別に取る経路はまだ配線していない）。
   *
   * 実データで重くなったら遅延読み込みへ切り替える余地はあるが、先に作り込む理由が無い。
   */
  async fetchPageTree(
    workspaceSlug: string,
    spaceId: string,
    options: { archived?: boolean } = {},
  ): Promise<KbPageTree> {
    const res = await apiClient.get<KbPageTree>(KB_API.pages(workspaceSlug, spaceId), {
      // 既定は現役。別の口ではなく同じ口のスコープなので、応答の形も同じ。
      params: options.archived ? { archived: 'true' } : undefined,
    });
    // pages が欠けた応答（想定外）でも描画側が落ちないよう、配列だけは必ず用意する。
    return {
      pages: toArray(res.data?.pages),
      hasHiddenChildren: res.data?.hasHiddenChildren ?? false,
    };
  },

  /**
   * ワークスペースを作る。作った本人がそのワークスペースの admin になる。
   *
   * slug は**テナントをまたいで一意**なので、使われていれば 409 で返る
   * （この応答自体は今後見直す予定）。**失敗は例外として投げる。**
   */
  /**
   * ワークスペースを配下ごと消す。**戻せない。**
   * 会社に紐づくワークスペースはサーバーが 403 で断る（誰であっても消せない）。
   */
  async deleteWorkspace(workspaceSlug: string): Promise<void> {
    await apiClient.delete(KB_API.workspace(workspaceSlug));
  },

  async createWorkspace(input: { name: string }): Promise<KbWorkspace> {
    const res = await apiClient.post<KbWorkspace>(KB_API.workspaces, input);
    return res.data;
  },

  /**
   * スペースを作る。ワークスペースの admin だけが叩ける。
   *
   * key はワークスペース内で一意。**失敗は例外として投げる。**
   */
  async createSpace(
    workspaceSlug: string,
    input: { name: string; visibility?: 'workspace' | 'private' },
  ): Promise<KbSpace> {
    const res = await apiClient.post<KbSpace>(KB_API.spaces(workspaceSlug), input);
    return res.data;
  },

  /**
   * スペースの表示名を変える。key は URL・権限の参照に使うので変えられない。
   * 管理権限が無ければ 403、見えないスペースは 404。**失敗は例外として投げる。**
   */
  async renameSpace(workspaceSlug: string, spaceId: string, name: string): Promise<KbSpace> {
    const res = await apiClient.patch<KbSpace>(KB_API.space(workspaceSlug, spaceId), {
      name,
    });
    return res.data;
  },

  /**
   * ワークスペース全体を題名・本文で検索する。返るのは閲覧できる現役ページだけ。
   * 見える範囲の判定はツリーと同じ規則をサーバーが持つ。
   *
   * 各要素の matchField で題名一致("title")か本文一致("body")かが分かる。本文一致のときだけ
   * excerpt（抜粋）・matchStart・matchLen（excerpt 文字列内での一致位置）が付く。
   * **失敗は例外として投げる。**
   */
  async searchPages(
    workspaceSlug: string,
    query: string,
    limit?: number,
  ): Promise<KbSearchResult[]> {
    const res = await apiClient.get<KbSearchResult[]>(KB_API.search(workspaceSlug), {
      params: { q: query, ...(limit ? { limit } : {}) },
    });
    return toArray(res.data);
  },

  /**
   * このページを参照している（本文からリンクしている）ページの一覧を返す（逆リンク）。
   * 応答は KbPage[] と同じ形（追加フィールドなし）。見える範囲の判定は検索・ツリーと
   * 同じ規則をサーバーが持つ。**失敗は例外として投げる。**
   */
  async listBacklinks(workspaceSlug: string, pageId: string): Promise<KbPage[]> {
    const res = await apiClient.get<KbPage[]>(KB_API.pageBacklinks(workspaceSlug, pageId));
    return toArray(res.data);
  },

  /**
   * ページを作る。parentId を省くとスペース直下、渡すとその子として作る。
   *
   * **失敗は例外として投げる**（axios がそうする）。ここで握り潰して null や false を返すと、
   * 呼び出し側は失敗を知りようがない。このリポジトリには「操作は失敗したのに成功の表示が出る」
   * 轍が既にあり、原因はどれも操作関数が失敗を投げなかったことだった。
   */
  async createPage(
    workspaceSlug: string,
    spaceId: string,
    input: { title: string; parentId?: string },
  ): Promise<KbPage> {
    const res = await apiClient.post<KbPage>(KB_API.pages(workspaceSlug, spaceId), {
      title: input.title,
      // backend は空文字を「親なし」として扱う（binding が omitempty ではないため必ず送る）。
      parentId: input.parentId ?? '',
    });
    return res.data;
  },

  /**
   * ページを子孫ごと物理削除する。アーカイブと違い戻せない。
   * **失敗は例外として投げる**（createPage と同じ理由）。
   */
  async deletePage(workspaceSlug: string, pageId: string): Promise<void> {
    await apiClient.delete(KB_API.page(workspaceSlug, pageId));
  },

  /** ページの題名を変える。**失敗は例外として投げる**（createPage と同じ理由）。 */
  async renamePage(workspaceSlug: string, pageId: string, title: string): Promise<KbPage> {
    const res = await apiClient.patch<KbPage>(KB_API.page(workspaceSlug, pageId), { title });
    return res.data;
  },

  /**
   * ページを（子孫ごと）動かす。**失敗は例外として投げる。**
   *
   * parentId を空にするとスペース直下へ戻す。位置は隣のページの ID で表す
   * （並び順のキーは持っていない。応答に入っていないため）。
   */
  async movePage(
    workspaceSlug: string,
    pageId: string,
    input: { parentId: string; beforePageId?: string; afterPageId?: string },
  ): Promise<KbPage> {
    const res = await apiClient.post<KbPage>(
      `${KB_API.page(workspaceSlug, pageId)}/move`,
      input,
    );
    return res.data;
  },

  /**
   * ページを（子孫ごと）アーカイブする。冪等。**失敗は例外として投げる。**
   */
  async archivePage(workspaceSlug: string, pageId: string): Promise<void> {
    await apiClient.post(`${KB_API.page(workspaceSlug, pageId)}/archive`);
  },

  /**
   * アーカイブしたページを（同時にアーカイブされた子孫ごと）現役へ戻す。
   *
   * 親がまだアーカイブ中なら backend が断る（子だけを戻すと、ツリーに現れない
   * 迷子ページができるため）。**失敗は例外として投げる。**
   */
  async unarchivePage(workspaceSlug: string, pageId: string): Promise<KbPage> {
    const res = await apiClient.post<KbPage>(
      `${KB_API.page(workspaceSlug, pageId)}/unarchive`,
    );
    return res.data;
  },

  /**
   * ページ 1 枚をメタ情報と本文込みで取得する。
   *
   * 閲覧できないページと存在しないページはどちらも 404。祖先に例外が張られていれば
   * 直リンクでも開けない（継承する）。
   */
  async fetchPage(workspaceSlug: string, pageId: string): Promise<KbPageDoc> {
    const res = await apiClient.get<KbPageDoc>(KB_API.page(workspaceSlug, pageId));
    return res.data;
  },

  /**
   * ページ ID だけでページと所属ワークスペースを解決する（/kb/{pageId} の入口）。
   *
   * 閲覧できないページと存在しないページはどちらも 404（実在を読ませない）。
   * 応答の workspaceSlug を以降の呼び出し（木・保存）に使う。
   */
  async resolvePage(pageId: string): Promise<KbResolvedPage> {
    const res = await apiClient.get<KbResolvedPage>(KB_API.resolvePage(pageId));
    return res.data;
  },

  /**
   * ページ本文（ProseMirror doc）を丸ごと置き換える。編集権限が要る。
   * 保存されるのは行スキーマから組み立て直した正規形で、応答はその正規形を返す。
   */
  /**
   * そのページ自身に張られた既定の役割を返す。
   *
   * **「このページを見られる人の一覧」ではない。** 上の段（ワークスペース / スペース /
   * 祖先のページ）から届いている相手は含まれず、空でも「誰も見られない」の意味にならない。
   * 画面はそれが分かる見せ方をすること。
   */
  async listPageGrants(workspaceSlug: string, pageId: string): Promise<KbPageGrant[]> {
    const res = await apiClient.get<KbPageGrant[]>(KB_API.pageGrants(workspaceSlug, pageId));
    return toArray<KbPageGrant>(res.data);
  },

  /**
   * 権限を張れる相手を表示名つきで返す（相手選び用）。
   *
   * name は空文字で返り得る（名前を引けなかった相手）。行は落とさないこと。
   */
  async listGrantablePrincipals(
    workspaceSlug: string,
    pageId: string,
  ): Promise<KbGrantablePrincipal[]> {
    const res = await apiClient.get<KbGrantablePrincipal[]>(
      KB_API.pagePrincipals(workspaceSlug, pageId),
    );
    return toArray<KbGrantablePrincipal>(res.data);
  },

  /**
   * ワークスペースに属する人を表示名つきで返す（発言での名指し・担当の表示名解決用）。
   * 所属していれば誰でも叩ける（ページ管理権限は要らない）。
   */
  async fetchMembers(workspaceSlug: string): Promise<KbWorkspaceMember[]> {
    const res = await apiClient.get<KbWorkspaceMember[]>(KB_API.members(workspaceSlug));
    return toArray<KbWorkspaceMember>(res.data);
  },

  /**
   * メンバー管理画面（段 7）向けの一覧。fetchMembers と違い admin だけが叩ける。
   * 停止中のアカウントも含み、ワークスペース全体の役割も一緒に返す。
   */
  async fetchAdminMembers(workspaceSlug: string): Promise<KbAdminWorkspaceMember[]> {
    const res = await apiClient.get<KbAdminWorkspaceMember[]>(KB_API.adminMembers(workspaceSlug));
    return toArray<KbAdminWorkspaceMember>(res.data);
  },

  /**
   * スペースに届いている権限を人に解決した一覧（段 9。読み取り専用）。
   * 判定はスペース単位の CanView（fetchMembers/fetchAdminMembers とは軸が違う）。
   */
  async fetchSpaceMembers(workspaceSlug: string, spaceId: string): Promise<KbSpaceMember[]> {
    const res = await apiClient.get<KbSpaceMember[]>(KB_API.spaceMembers(workspaceSlug, spaceId));
    return toArray<KbSpaceMember>(res.data);
  },

  /** 自分のお気に入りページの一覧（段 7）。ワークスペースに所属していれば誰でも叩ける。 */
  async fetchFavorites(workspaceSlug: string): Promise<KbFavoritePage[]> {
    const res = await apiClient.get<KbFavoritePage[]>(KB_API.favorites(workspaceSlug));
    return toArray<KbFavoritePage>(res.data);
  },

  /** ページをお気に入りに入れる（冪等）。 */
  async addFavorite(workspaceSlug: string, pageId: string): Promise<void> {
    await apiClient.put(KB_API.favorite(workspaceSlug, pageId));
  },

  /** お気に入りから外す（冪等）。 */
  async removeFavorite(workspaceSlug: string, pageId: string): Promise<void> {
    await apiClient.delete(KB_API.favorite(workspaceSlug, pageId));
  },

  /** ワークスペース全体の既定の役割を主体に与える（上書き）。admin だけが叩ける。 */
  async grantWorkspaceRole(
    workspaceSlug: string,
    principalId: string,
    role: KbGrantRole,
  ): Promise<void> {
    await apiClient.put(KB_API.workspaceGrant(workspaceSlug, principalId), { role });
  },

  /** ワークスペース全体の既定の役割を剥がす。最後の admin は断られる（409）。 */
  async revokeWorkspaceRole(workspaceSlug: string, principalId: string): Promise<void> {
    await apiClient.delete(KB_API.workspaceGrant(workspaceSlug, principalId));
  },

  /** メンバーをワークスペースから外す（冪等）。最後の admin は断られる（409）。 */
  async removeMember(workspaceSlug: string, userId: number): Promise<void> {
    await apiClient.delete(KB_API.member(workspaceSlug, userId));
  },

  /**
   * アカウントを停止する（段 7）。効果は全ワークスペースに及ぶ。自分自身は指定できない
   * （400）。対象がこのワークスペースの現在のメンバーでなければ断られる（404）。
   */
  async suspendMember(workspaceSlug: string, userId: number): Promise<void> {
    await apiClient.put(KB_API.memberSuspend(workspaceSlug, userId));
  },

  /** 停止したアカウントを復帰する（段 7）。権限境界は suspendMember と同じ。 */
  async restoreMember(workspaceSlug: string, userId: number): Promise<void> {
    await apiClient.put(KB_API.memberRestore(workspaceSlug, userId));
  },

  /**
   * ページでの既定の役割を主体に与える（同じ主体には 1 行だけなので上書きになる）。
   *
   * **これで誰かを弱めることはできない。** 既定は 3 段から届いて最も強いものが実効に
   * なるので、上位で editor を得ている相手に viewer を張っても editor のまま。
   */
  async grantPageRole(
    workspaceSlug: string,
    pageId: string,
    principalId: string,
    role: KbGrantRole,
  ): Promise<KbPageGrant> {
    const res = await apiClient.put<KbPageGrant>(
      KB_API.pageGrant(workspaceSlug, pageId, principalId),
      { role },
    );
    return res.data;
  },

  /** ページでの既定の役割を剥がす（冪等）。上の段から届いている分は残る。 */
  async revokePageRole(workspaceSlug: string, pageId: string, principalId: string): Promise<void> {
    await apiClient.delete(KB_API.pageGrant(workspaceSlug, pageId, principalId));
  },

  async replaceContent(
    workspaceSlug: string,
    pageId: string,
    doc: unknown,
  ): Promise<KbPageContentSaveResult> {
    const res = await apiClient.put<KbPageContentSaveResult>(
      KB_API.pageContent(workspaceSlug, pageId),
      { doc },
    );
    return res.data;
  },

  /**
   * ページのアイコンを設定する（絵文字）。編集権限が要る。**失敗は例外として投げる。**
   */
  async setPageIcon(workspaceSlug: string, pageId: string, icon: KbIcon): Promise<KbPage> {
    const res = await apiClient.put<KbPage>(KB_API.pageIcon(workspaceSlug, pageId), icon);
    return res.data;
  },

  /**
   * ページのアイコンを外す。編集権限が要る。**失敗は例外として投げる。**
   *
   * 200 で確定後のページ本体が返る（204 にしないのは、木の更新イベントに確定後の
   * ページが要るため — backend 側の判断で、応答の形はそれに合わせてある）。
   */
  async clearPageIcon(workspaceSlug: string, pageId: string): Promise<KbPage> {
    const res = await apiClient.delete<KbPage>(KB_API.pageIcon(workspaceSlug, pageId));
    return res.data;
  },

  /**
   * 画像アップロード用の S3 PUT 署名 URL を発行する（current user 名義。編集権限が要る）。
   * **失敗は例外として投げる。**
   */
  async issuePageImageUploadURL(
    workspaceSlug: string,
    pageId: string,
    contentType: string,
    size: number,
  ): Promise<{ url: string; key: string; expiresIn: number }> {
    const res = await apiClient.post<{ url: string; key: string; expiresIn: number }>(
      KB_API.pageImageUploadUrl(workspaceSlug, pageId),
      { contentType, size },
    );
    return res.data;
  },

  /**
   * doc に保存された S3 key を表示用の期限付き URL へ解決する。
   * 存在しない/参照されていない key は 404 になり得る。**失敗は例外として投げる。**
   */
  async issuePageImageDownloadURL(
    workspaceSlug: string,
    pageId: string,
    key: string,
  ): Promise<{ url: string; expiresIn: number }> {
    const res = await apiClient.get<{ url: string; expiresIn: number }>(
      KB_API.pageImageDownloadUrl(workspaceSlug, pageId, key),
    );
    return res.data;
  },

  /**
   * 画像ファイルを S3 へ直接アップロードし、durable な保存形式（key）を返す。
   *
   * 署名 URL の発行だけ自前の apiClient（Cookie 認証付き）で行い、実際の PUT は
   * 素の axios で S3 へ直接送る（S3 は自前 API とは別オリジンで、Cookie 認証を
   * 持ち込む必要も持ち込んではいけない理由も無い — entities/user/imageUploadRepository と同じ形）。
   *
   * **戻り値は key であって URL ではない**（publicUrl は無い — カバー画像・本文の画像は
   * どちらも非公開バケットで、表示のたびに issuePageImageDownloadURL で期限付き URL に
   * 解決する必要があるため）。**失敗は例外として投げる。**
   */
  async uploadPageImage(workspaceSlug: string, pageId: string, file: File): Promise<string> {
    // this. ではなく const 名で呼ぶ（分割代入で単体の関数として渡されても壊れないように）。
    const { url, key } = await KbRepository.issuePageImageUploadURL(
      workspaceSlug,
      pageId,
      file.type || 'image/png',
      file.size,
    );
    await axios.put(url, file, {
      headers: { 'Content-Type': file.type || 'image/png' },
    });
    return key;
  },

  /**
   * ページのカバー画像を設定する（アップロード済みの key を指す）。編集権限が要る。
   * **失敗は例外として投げる。**
   */
  async setPageCover(
    workspaceSlug: string,
    pageId: string,
    key: string,
  ): Promise<{ page: KbPage; cover: KbResolvedCover | null }> {
    const res = await apiClient.put<{ page: KbPage; cover: KbResolvedCover | null }>(
      KB_API.pageCover(workspaceSlug, pageId),
      { type: 'file', key },
    );
    return res.data;
  },

  /**
   * ページのカバー画像を外す。編集権限が要る。**失敗は例外として投げる。**
   */
  async clearPageCover(
    workspaceSlug: string,
    pageId: string,
  ): Promise<{ page: KbPage; cover: null }> {
    const res = await apiClient.delete<{ page: KbPage; cover: null }>(
      KB_API.pageCover(workspaceSlug, pageId),
    );
    return res.data;
  },

  /**
   * ページに張られたコメントスレッドの一覧（作成日時昇順）。各スレッドは comments 配列
   * 込みで返る。読むことは canComment に関わらず誰でもできる（書き込み系だけが絞られる）。
   * **失敗は例外として投げる。**
   */
  async listCommentThreads(workspaceSlug: string, pageId: string): Promise<KbCommentThread[]> {
    const res = await apiClient.get<{ threads: KbCommentThreadWire[] }>(
      KB_API.commentThreads(workspaceSlug, pageId),
    );
    return toArray<KbCommentThreadWire>(res.data?.threads).map(normalizeCommentThread);
  },

  /**
   * 新しいコメントスレッドを作る。body は ProseMirror のインラインノードの配列。
   * 作成した最初の 1 件を含むスレッドが返る。コメント権限が要る。**失敗は例外として投げる。**
   *
   * anchor を渡すと「錨付きコメント」（本文の特定ブロック・文字範囲へのコメント）になる。
   * 渡さなければ従来通り page-level（ページ全体へのコメント）。4 つのフィールドは
   * 揃うかどれも無いかのどちらかで送る（backend 側もその前提で受ける）。
   */
  async createCommentThread(
    workspaceSlug: string,
    pageId: string,
    body: unknown[],
    anchor?: CommentAnchor,
  ): Promise<KbCommentThread> {
    const res = await apiClient.post<KbCommentThreadWire>(
      KB_API.commentThreads(workspaceSlug, pageId),
      anchor
        ? {
            body,
            blockId: anchor.blockId,
            anchorFrom: anchor.anchorFrom,
            anchorTo: anchor.anchorTo,
            quote: anchor.quote,
          }
        : { body },
    );
    return normalizeCommentThread(res.data);
  },

  /**
   * スレッドへ返信を 1 件足す。追加した comment 自身（スレッド全体ではない）が返る。
   * コメント権限が要る。**失敗は例外として投げる。**
   */
  async addComment(
    workspaceSlug: string,
    pageId: string,
    threadId: string,
    body: unknown[],
  ): Promise<KbComment> {
    const res = await apiClient.post<KbComment>(
      KB_API.comments(workspaceSlug, pageId, threadId),
      { body },
    );
    return res.data;
  },

  /**
   * スレッドを解決済みにする。更新後のスレッドを返す。**comments は空で返る**
   * （backend の Resolve/Reopen ハンドラは発言を引き直さない設計 — 呼び出し側で
   * 手元の comments を上書きしないこと）。**失敗は例外として投げる。**
   */
  async resolveCommentThread(
    workspaceSlug: string,
    pageId: string,
    threadId: string,
  ): Promise<KbCommentThread> {
    const res = await apiClient.post<KbCommentThreadWire>(
      KB_API.resolveCommentThread(workspaceSlug, pageId, threadId),
    );
    return normalizeCommentThread(res.data);
  },

  /**
   * 解決済みのスレッドを未解決へ戻す。更新後のスレッドを返す。**comments は空で返る**
   * （resolveCommentThread と同じ注意）。**失敗は例外として投げる。**
   */
  async reopenCommentThread(
    workspaceSlug: string,
    pageId: string,
    threadId: string,
  ): Promise<KbCommentThread> {
    const res = await apiClient.post<KbCommentThreadWire>(
      KB_API.reopenCommentThread(workspaceSlug, pageId, threadId),
    );
    return normalizeCommentThread(res.data);
  },

  /**
   * ページの版（バージョン）の一覧を返す（新しい順）。doc は含まない
   * （一覧で毎回本文込みを引くと重くなるため — 単体取得で必要なときだけ引く）。
   * 閲覧できれば誰でもできる（canView）。**失敗は例外として投げる。**
   */
  async listPageVersions(workspaceSlug: string, pageId: string): Promise<KbPageVersion[]> {
    const res = await apiClient.get<KbPageVersionWire[]>(KB_API.pageVersions(workspaceSlug, pageId));
    return toArray<KbPageVersionWire>(res.data).map(normalizeVersion);
  },

  /**
   * 版 1 件を doc 込みで取得する。閲覧できれば誰でもできる（canView）。
   * **失敗は例外として投げる。**
   */
  async getPageVersion(
    workspaceSlug: string,
    pageId: string,
    seq: number,
  ): Promise<KbPageVersionDetail> {
    const res = await apiClient.get<KbPageVersionDetailWire>(
      KB_API.pageVersion(workspaceSlug, pageId, seq),
    );
    return normalizeVersionDetail(res.data);
  },

  /**
   * 今の本文を明示的な版として残す。note は空でもよい（backend は空文字を送っても
   * 未記入として null 相当に扱う想定 — note を渡さないときはキー自体を送らない）。
   * 編集権限が要る。作った版そのもの（doc 込み）が返る。**失敗は例外として投げる。**
   */
  async createPageVersion(
    workspaceSlug: string,
    pageId: string,
    note?: string,
  ): Promise<KbPageVersionDetail> {
    const res = await apiClient.post<KbPageVersionDetailWire>(
      KB_API.pageVersions(workspaceSlug, pageId),
      note ? { note } : {},
    );
    return normalizeVersionDetail(res.data);
  },

  /**
   * 過去の版を今の本文として復元する（body 無し）。編集権限が要る。
   * **復元自体も新しい版として残る**（backend 側の設計 — 呼び出し側は復元後に版一覧を
   * 引き直すと、復元でできた版が先頭に増えて見える）。
   * 応答は本文保存（replaceContent）と同じ形。**失敗は例外として投げる。**
   */
  async restorePageVersion(
    workspaceSlug: string,
    pageId: string,
    seq: number,
  ): Promise<KbPageContentSaveResult> {
    const res = await apiClient.post<KbPageContentSaveResult>(
      KB_API.restorePageVersion(workspaceSlug, pageId, seq),
    );
    return res.data;
  },

  /**
   * テンプレートの一覧。spaceId を渡すと、そのスペース専用のテンプレート + ワークスペース
   * 全体のテンプレートの両方が返る想定（backend 未実装の段階の想定であり確定ではない）。
   * doc は含まない軽い形。ワークスペース所属者なら誰でも読める。**失敗は例外として投げる。**
   */
  async listPageTemplates(workspaceSlug: string, spaceId?: string): Promise<KbPageTemplate[]> {
    const res = await apiClient.get<KbPageTemplate[]>(KB_API.templates(workspaceSlug), {
      params: spaceId ? { spaceId } : undefined,
    });
    return toArray<KbPageTemplate>(res.data);
  },

  /**
   * 今のページの内容からテンプレートを作る。ワークスペースの編集者（editor）以上が要る。
   * spaceId を渡すとそのスペース専用、省く（null）とワークスペース全体で使えるテンプレートになる。
   * 名前が重複していれば 409。**失敗は例外として投げる。**
   */
  async createPageTemplate(
    workspaceSlug: string,
    pageId: string,
    input: { name: string; spaceId?: string | null },
  ): Promise<KbPageTemplate> {
    const res = await apiClient.post<KbPageTemplate>(KB_API.pageTemplates(workspaceSlug, pageId), input);
    return res.data;
  },

  /** テンプレートを削除する。ワークスペースの編集者（editor）以上が要る。**失敗は例外として投げる。** */
  async deletePageTemplate(workspaceSlug: string, templateId: string): Promise<void> {
    await apiClient.delete(KB_API.template(workspaceSlug, templateId));
  },

  /**
   * テンプレートから新しいページを作る。応答は通常のページ作成と同じ形（KbPage）。
   * 一覧・使用はワークスペース所属者なら誰でもできる。**失敗は例外として投げる。**
   */
  async createPageFromTemplate(
    workspaceSlug: string,
    spaceId: string,
    input: { templateId: string; parentId?: string; title: string },
  ): Promise<KbPage> {
    const res = await apiClient.post<KbPage>(KB_API.pageFromTemplate(workspaceSlug, spaceId), input);
    return res.data;
  },

  /**
   * 本文を提案として保存する（CanComment が要る）。**1 回の POST が 1 回の提案** — 既存の
   * open な提案を更新する API は無い（作成のみ）。連投すると提案行が量産される。
   * **失敗は例外として投げる。**
   */
  async createSuggestion(
    workspaceSlug: string,
    pageId: string,
    doc: unknown,
  ): Promise<KbPageSuggestion> {
    const res = await apiClient.post<KbPageSuggestion>(
      KB_API.pageSuggestions(workspaceSlug, pageId),
      { doc },
    );
    return res.data;
  },

  /**
   * open な提案の一覧を返す（作成日時昇順）。閲覧できれば誰でも読める（canView）。
   * 0 件でも空配列。**失敗は例外として投げる。**
   */
  async listOpenSuggestions(workspaceSlug: string, pageId: string): Promise<KbPageSuggestion[]> {
    const res = await apiClient.get<KbPageSuggestion[]>(KB_API.pageSuggestions(workspaceSlug, pageId));
    return toArray<KbPageSuggestion>(res.data);
  },

  /**
   * 提案を採用する（編集権限が要る）。本文へ反映し版を 1 つ切る。応答の doc は
   * 反映後の本文そのもの。**失敗は例外として投げる。**
   */
  async acceptSuggestion(
    workspaceSlug: string,
    pageId: string,
    suggestionId: string,
  ): Promise<KbPageSuggestion> {
    const res = await apiClient.post<KbPageSuggestion>(
      KB_API.acceptPageSuggestion(workspaceSlug, pageId, suggestionId),
    );
    return res.data;
  },

  /**
   * 提案を却下する（編集権限が要る）。本文は一切変えない。**失敗は例外として投げる。**
   */
  async rejectSuggestion(
    workspaceSlug: string,
    pageId: string,
    suggestionId: string,
  ): Promise<KbPageSuggestion> {
    const res = await apiClient.post<KbPageSuggestion>(
      KB_API.rejectPageSuggestion(workspaceSlug, pageId, suggestionId),
    );
    return res.data;
  },
};

export default KbRepository;
