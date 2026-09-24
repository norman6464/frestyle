package kb

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrPagePermissionDenied はページに対する操作が実効権限で許されていないときに返す。
// handler はこれを 403（あるいは存在自体を隠すなら 404）にマップする。
var ErrPagePermissionDenied = errors.New("permission denied for this page")

// CheckPagePermissionUseCase は「このユーザーはこのページを閲覧 / 編集できるか」に答える。
// ナレッジの認可はすべてここを通す（呼び出し側に判定規則を写経させない）。複数ページを
// 扱う経路（ツリー取得等）では 1 ページ 1 往復にしないよう ListViewablePagesUseCase を使う。
type CheckPagePermissionUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCheckPagePermissionUseCase(r repository.KnowledgeBasePermissionRepository) *CheckPagePermissionUseCase {
	return &CheckPagePermissionUseCase{repo: r}
}

type CheckPagePermissionInput struct {
	WorkspaceID string
	PageID      string
	UserID      uint64
}

func (u *CheckPagePermissionUseCase) Execute(ctx context.Context, in CheckPagePermissionInput) (*domain.PagePermission, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return nil, errors.New("pageID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.PagePermissionFactsForUser(ctx, in.WorkspaceID, in.PageID, in.UserID)
	if err != nil {
		return nil, err
	}
	perm := domain.ResolvePagePermission(*facts)
	return &perm, nil
}

// IsWorkspaceMemberUseCase は「このユーザーはこのワークスペースのメンバーか」に答える。
// 所属は principals（kind='user'）の行の有無がすべてで、専用のメンバーシップ表は無い。
type IsWorkspaceMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewIsWorkspaceMemberUseCase(r repository.KnowledgeBasePermissionRepository) *IsWorkspaceMemberUseCase {
	return &IsWorkspaceMemberUseCase{repo: r}
}

type IsWorkspaceMemberInput struct {
	WorkspaceID string
	UserID      uint64
}

func (u *IsWorkspaceMemberUseCase) Execute(ctx context.Context, in IsWorkspaceMemberInput) (bool, error) {
	if in.WorkspaceID == "" {
		return false, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return false, errors.New("userID is required")
	}
	return u.repo.IsWorkspaceMember(ctx, in.WorkspaceID, in.UserID)
}

// ListViewablePagesUseCase はスペース配下の現役ページのうち、そのユーザーが閲覧できるものを返す
// （ツリー取得の土台。問い合わせはページ数によらず 1 回）。答えられるのは閲覧可否だけ。
// 編集可否が要る画面は CheckPagePermissionUseCase を使う。
type ListViewablePagesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListViewablePagesUseCase(r repository.KnowledgeBasePermissionRepository) *ListViewablePagesUseCase {
	return &ListViewablePagesUseCase{repo: r}
}

type ListViewablePagesInput struct {
	WorkspaceID string
	SpaceID     string
	UserID      uint64
	// Archived: 権限の見方は現役と同じで、クエリの絞り込みだけが変わる。
	Archived bool
}

// HiddenChildrenRootKey は ListViewablePagesOutput.HasHiddenChildren で
// 「スペース直下（親を持たない段）」を指すキー。ページ ID は必ず非空なので衝突しない。
const HiddenChildrenRootKey = ""

// ListViewablePagesOutput は閲覧できるページと、「その段に見えない子が居るか」の組
// （HasHiddenChildren のキーは親ページの ID。スペース直下は HiddenChildrenRootKey）。
// 見えない子の有無だけを知らせ、枚数は出さない — 枚数は伏せた量に比例して情報が漏れる
// （例: 「12 ページ」で規模が読める）が、有無だけなら利用者の行動は変わらない。
// 枚数はどこにも変数として作らない（数えてから丸めるのではなく最初の 1 枚で打ち切る）。
type ListViewablePagesOutput struct {
	Pages             []domain.Page
	HasHiddenChildren map[string]bool
	// ParentArchived: 復帰できるか（UnarchivePageUseCase の規則）を呼び出し側が判断するのに使う。
	// 現役の一覧では常に空。
	ParentArchived map[string]bool
}

func (u *ListViewablePagesUseCase) Execute(ctx context.Context, in ListViewablePagesInput) (ListViewablePagesOutput, error) {
	if in.WorkspaceID == "" {
		return ListViewablePagesOutput{}, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return ListViewablePagesOutput{}, errors.New("spaceID is required")
	}
	if in.UserID == 0 {
		return ListViewablePagesOutput{}, errors.New("userID is required")
	}
	rows, err := u.repo.ListSpacePageViewFacts(ctx, in.WorkspaceID, in.SpaceID, in.UserID, in.Archived)
	if err != nil {
		return ListViewablePagesOutput{}, err
	}

	pages := make([]domain.Page, 0, len(rows))
	viewable := make(map[string]bool, len(rows))
	parentArchived := make(map[string]bool)
	for _, row := range rows {
		if domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			viewable[row.Page.ID] = true
			pages = append(pages, row.Page)
			if row.ParentArchived {
				parentArchived[row.Page.ID] = true
			}
		}
	}

	// 画面に木が 1 本も出ないなら、見えない子の有無も返さない — 出すと「存在しないスペース」
	// と「中身が空のスペース」を撃ち分けられ、スペース ID の総当たりで実在を数え上げられる。
	// 見えるページが 0 枚かでは判定できない: pages には孤児（自分は見えるが親が見えない
	// ページ）も入り、BuildPageTree がそれを丸ごと落とすため pages が非空でも木は空になりうる
	// （実際に根が非公開・子だけ閲覧可のケースで撃ち分けを踏んだ）。木が空になるのは
	// 「見える根が 1 つも無いとき」なので、そこで判定する。
	hasVisibleRoot := false
	for i := range pages {
		if pages[i].ParentID == nil {
			hasVisibleRoot = true
			break
		}
	}
	if !hasVisibleRoot {
		return ListViewablePagesOutput{Pages: pages, HasHiddenChildren: map[string]bool{}, ParentArchived: parentArchived}, nil
	}

	hidden := make(map[string]bool)
	for _, row := range rows {
		if viewable[row.Page.ID] {
			continue
		}
		if row.Page.ParentID == nil {
			hidden[HiddenChildrenRootKey] = true
			continue
		}
		// 親も見えないなら数えない（利用者が現に見ている段の直下だけを数える）。
		if !viewable[*row.Page.ParentID] {
			continue
		}
		hidden[*row.Page.ParentID] = true
	}

	return ListViewablePagesOutput{Pages: pages, HasHiddenChildren: hidden, ParentArchived: parentArchived}, nil
}

// CanEditPageSubtreeUseCase は「このユーザーは、このページと全子孫を編集できるか」に答える。
// アーカイブ / 復帰など、ページを名指しして子孫ごと書き換える操作の入口で使う。
//
// いまの権限モデルでは役割は木を下るほど弱くならない（子孫の経路は必ず親の経路を含む）ため、
// 根を編集できれば全子孫も編集できこの検査は実質断らない。それでも残しているのは、事実を
// 集めるクエリが経路を取り違えたときの回帰を捕まえる網になるため（呼ぶのはアーカイブ / 復帰の
// 1 回だけで代償は小さい）。
type CanEditPageSubtreeUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCanEditPageSubtreeUseCase(r repository.KnowledgeBasePermissionRepository) *CanEditPageSubtreeUseCase {
	return &CanEditPageSubtreeUseCase{repo: r}
}

type CanEditPageSubtreeInput struct {
	WorkspaceID string
	PageID      string
	UserID      uint64
}

func (u *CanEditPageSubtreeUseCase) Execute(ctx context.Context, in CanEditPageSubtreeInput) (bool, error) {
	if in.WorkspaceID == "" {
		return false, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return false, errors.New("pageID is required")
	}
	if in.UserID == 0 {
		return false, errors.New("userID is required")
	}
	rows, err := u.repo.ListSubtreePagePermissionFacts(ctx, in.WorkspaceID, in.PageID, in.UserID)
	if err != nil {
		return false, err
	}
	if len(rows) == 0 {
		// closure は自分自身（depth 0）を必ず含むので、0 行は「ページが無い」を意味する。
		// 許可には倒さない（呼び出し側は先に根の権限を確かめている前提で、ここは安全弁）。
		return false, nil
	}
	for _, row := range rows {
		if !domain.ResolvePagePermission(row.Facts).CanEdit {
			return false, nil
		}
	}
	return true, nil
}

// SearchMatchFieldTitle / SearchMatchFieldBody は SearchViewablePageResult.MatchField の値。
// どちらでヒットしたかをフロントが区別する（題名一致は抜粋を出さない・本文一致は
// 抜粋とヒット位置を出す）。
const (
	SearchMatchFieldTitle = "title"
	SearchMatchFieldBody  = "body"
)

// searchExcerptWindowRunes は本文一致の抜粋で、ヒット位置の前後に残す rune 数。
// 日本語を含む本文を想定するため rune 単位（バイト単位ではない）。
const searchExcerptWindowRunes = 30

// SearchViewablePageResult は検索結果 1 件（ページ本体 + どこにヒットしたか）。
type SearchViewablePageResult struct {
	Page domain.Page
	// MatchField はヒットした場所。題名・本文の両方が一致していても "title" を優先する。
	MatchField string
	// Excerpt は MatchField が "body" のときだけ非空（前後 searchExcerptWindowRunes 文字の窓）。
	Excerpt string
	// MatchStart / MatchLen は Excerpt の中でのヒット位置・長さ（rune 単位。フロントの mark 用）。
	MatchStart int
	MatchLen   int
}

// SearchViewablePagesUseCase はワークスペース全体を題名または本文で検索し、閲覧できる
// ページだけを返す。ふるいは一覧（ListViewablePages）と同じ domain.ResolvePageView
// （別の判定を持つと「一覧には出ないのに検索では出る」で伏せたページの実在が漏れる）。
// SQL 側は候補に上限を掛けない（可視判定より先に切ると見えるはずの一致を取りこぼす）。
type SearchViewablePagesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewSearchViewablePagesUseCase(r repository.KnowledgeBasePermissionRepository) *SearchViewablePagesUseCase {
	return &SearchViewablePagesUseCase{repo: r}
}

type SearchViewablePagesInput struct {
	WorkspaceID string
	UserID      uint64
	// Query は題名 / 本文の部分一致（大文字小文字は区別しない）。空白だけは呼び出し側で弾く。
	Query string
	// Limit は返す最大件数。0 以下なら既定の 20。上限 50。
	Limit int
}

func (u *SearchViewablePagesUseCase) Execute(ctx context.Context, in SearchViewablePagesInput) ([]SearchViewablePageResult, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	query := strings.TrimSpace(in.Query)
	if query == "" {
		return nil, errors.New("query is required")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	rows, err := u.repo.SearchWorkspacePageViewFacts(ctx, in.WorkspaceID, in.UserID, query)
	if err != nil {
		return nil, err
	}
	// 確保量は行数で決める。利用者由来の limit を確保量に使う余地は持たせない。
	results := make([]SearchViewablePageResult, 0, len(rows))
	for _, row := range rows {
		if !domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			continue
		}
		results = append(results, buildSearchViewablePageResult(row, query))
		if len(results) >= limit {
			break
		}
	}
	return results, nil
}

// buildSearchViewablePageResult は 1 行の検索候補（題名 + 本文）と query から、
// どこにヒットしたか（MatchField）と本文一致なら抜粋を組み立てる。両方一致する場合は
// 判断材料として明確な題名一致を優先する。
func buildSearchViewablePageResult(row repository.PageSearchViewFact, query string) SearchViewablePageResult {
	if strings.Contains(strings.ToLower(row.Page.Title), strings.ToLower(query)) {
		return SearchViewablePageResult{Page: row.Page, MatchField: SearchMatchFieldTitle}
	}
	excerpt, start, length, found := computeSearchExcerpt(row.Body, query)
	if !found {
		// SQL の ILIKE 一致と Go 側の判定がずれて見つからない場合の安全弁。
		// 「一致した」事実自体は SQL が保証しているので、抜粋なしの本文一致として返す。
		return SearchViewablePageResult{Page: row.Page, MatchField: SearchMatchFieldBody}
	}
	return SearchViewablePageResult{
		Page:       row.Page,
		MatchField: SearchMatchFieldBody,
		Excerpt:    excerpt,
		MatchStart: start,
		MatchLen:   length,
	}
}

// computeSearchExcerpt は body の中から query に大文字小文字を無視して部分一致する最初の
// 位置を探し、その前後 searchExcerptWindowRunes rune の窓を切り出す（byte 単位で
// スライスすると日本語等のマルチバイト文字が境界で壊れるため rune 単位で処理する）。
// 戻り値の start / length は切り出した excerpt の中での rune 位置・長さ。見つからなければ found=false。
func computeSearchExcerpt(body, query string) (excerpt string, start, length int, found bool) {
	lowerBody := strings.ToLower(body)
	lowerQuery := strings.ToLower(query)
	if lowerQuery == "" || lowerBody == "" {
		return "", 0, 0, false
	}
	byteIdx := strings.Index(lowerBody, lowerQuery)
	if byteIdx < 0 {
		return "", 0, 0, false
	}
	idx := utf8.RuneCountInString(lowerBody[:byteIdx]) // バイト位置 → rune 位置へ変換

	queryLen := utf8.RuneCountInString(lowerQuery)
	bodyRunes := []rune(body)
	winStart := idx - searchExcerptWindowRunes
	if winStart < 0 {
		winStart = 0
	}
	winEnd := idx + queryLen + searchExcerptWindowRunes
	if winEnd > len(bodyRunes) {
		winEnd = len(bodyRunes)
	}
	return string(bodyRunes[winStart:winEnd]), idx - winStart, queryLen, true
}

// ListPageBacklinksUseCase は、対象ページを参照している（page_links.target_page_id）
// ページのうち、閲覧できるものだけを返す（逆リンク）。ふるいは検索・一覧と同じ
// domain.ResolvePageView。対象ページ自体を見られるかは handler が
// requirePagePermission で先に確かめる。SQL に LIMIT は掛けず、可視判定後の応答件数を
// listPageBacklinksMaxResults で打ち切る（見えるはずの参照元を取りこぼさないため）。
type ListPageBacklinksUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListPageBacklinksUseCase(r repository.KnowledgeBasePermissionRepository) *ListPageBacklinksUseCase {
	return &ListPageBacklinksUseCase{repo: r}
}

// listPageBacklinksMaxResults は応答に含める逆リンク元ページの上限。
const listPageBacklinksMaxResults = 200

type ListPageBacklinksInput struct {
	WorkspaceID string
	UserID      uint64
	// PageID は逆リンクを求める対象（参照先）ページ。
	PageID string
}

func (u *ListPageBacklinksUseCase) Execute(ctx context.Context, in ListPageBacklinksInput) ([]domain.Page, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if in.PageID == "" {
		return nil, errors.New("pageID is required")
	}
	rows, err := u.repo.ListPageLinkSourcePageViewFacts(ctx, in.WorkspaceID, in.UserID, in.PageID)
	if err != nil {
		return nil, err
	}
	pages := make([]domain.Page, 0, len(rows))
	for _, row := range rows {
		if !domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			continue
		}
		pages = append(pages, row.Page)
		if len(pages) >= listPageBacklinksMaxResults {
			break
		}
	}
	return pages, nil
}

// ListPagesReferencingTicketUseCase は ListPageBacklinksUseCase のチケット版。対象チケットを
// 本文の ticketRef ノードで埋め込んでいる（page_ticket_links.target_ticket_id）ページのうち、
// 閲覧できるものだけを返す（判定・上限は ListPageBacklinksUseCase と同一）。対象チケット自体を
// 見られるかは handler（requireTicketPermission）が先に確かめる。ticketID はここでは opaque
// な文字列として扱う（usecase/kb は usecase/ticket を import しない規約のため）。
type ListPagesReferencingTicketUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListPagesReferencingTicketUseCase(r repository.KnowledgeBasePermissionRepository) *ListPagesReferencingTicketUseCase {
	return &ListPagesReferencingTicketUseCase{repo: r}
}

type ListPagesReferencingTicketInput struct {
	WorkspaceID string
	UserID      uint64
	TicketID    string
}

func (u *ListPagesReferencingTicketUseCase) Execute(ctx context.Context, in ListPagesReferencingTicketInput) ([]domain.Page, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	rows, err := u.repo.ListPageTicketLinkSourcePageViewFacts(ctx, in.WorkspaceID, in.UserID, in.TicketID)
	if err != nil {
		return nil, err
	}
	pages := make([]domain.Page, 0, len(rows))
	for _, row := range rows {
		if !domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			continue
		}
		pages = append(pages, row.Page)
		if len(pages) >= listPageBacklinksMaxResults {
			break
		}
	}
	return pages, nil
}

// ErrInvalidGrantRole は既知でない役割を指定したときに返す。
var ErrInvalidGrantRole = errors.New("invalid grant role")

// ErrInvalidCapability は既知でないケイパビリティを指定したときに返す。
var ErrInvalidCapability = errors.New("invalid capability")

// GrantWorkspaceRoleUseCase はワークスペース全体での既定の役割を主体に与える。
// 配下の全スペースに効くので、テナント全体の管理者はここで 1 行張れば足りる。
type GrantWorkspaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewGrantWorkspaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *GrantWorkspaceRoleUseCase {
	return &GrantWorkspaceRoleUseCase{repo: r}
}

type GrantWorkspaceRoleInput struct {
	WorkspaceID string
	PrincipalID string
	Role        domain.GrantRole
	// ActorUserID は誰がこの役割を与えたか（監査用）。
	ActorUserID uint64
}

func (u *GrantWorkspaceRoleUseCase) Execute(ctx context.Context, in GrantWorkspaceRoleInput) (*domain.WorkspaceGrant, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PrincipalID == "" {
		return nil, errors.New("principalID is required")
	}
	if !in.Role.Valid() {
		return nil, ErrInvalidGrantRole
	}
	// 先に引いて「別ワークスペースの ID」を FK 違反ではなく not found として返す。
	if _, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, in.PrincipalID); err != nil {
		return nil, err
	}
	return u.repo.UpsertWorkspaceGrant(ctx, in.WorkspaceID, in.PrincipalID, in.Role, in.ActorUserID)
}

// RevokeWorkspaceRoleUseCase はワークスペース全体での既定の役割を剥がす（冪等）。
type RevokeWorkspaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRevokeWorkspaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *RevokeWorkspaceRoleUseCase {
	return &RevokeWorkspaceRoleUseCase{repo: r}
}

type RevokeWorkspaceRoleInput struct {
	WorkspaceID string
	PrincipalID string
	// ActorUserID は誰がこの役割を剥がしたか（監査用）。
	ActorUserID uint64
}

func (u *RevokeWorkspaceRoleUseCase) Execute(ctx context.Context, in RevokeWorkspaceRoleInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.PrincipalID == "" {
		return errors.New("principalID is required")
	}
	return u.repo.DeleteWorkspaceGrant(ctx, in.WorkspaceID, in.PrincipalID, in.ActorUserID)
}

// GrantSpaceRoleUseCase はスペースでの既定の役割を主体に与える。
type GrantSpaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewGrantSpaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *GrantSpaceRoleUseCase {
	return &GrantSpaceRoleUseCase{repo: r}
}

type GrantSpaceRoleInput struct {
	WorkspaceID string
	SpaceID     string
	PrincipalID string
	Role        domain.GrantRole
}

func (u *GrantSpaceRoleUseCase) Execute(ctx context.Context, in GrantSpaceRoleInput) (*domain.SpaceGrant, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	if in.PrincipalID == "" {
		return nil, errors.New("principalID is required")
	}
	if !in.Role.Valid() {
		return nil, ErrInvalidGrantRole
	}
	if _, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, in.PrincipalID); err != nil {
		return nil, err
	}
	return u.repo.UpsertSpaceGrant(ctx, in.WorkspaceID, in.SpaceID, in.PrincipalID, in.Role)
}

// RevokeSpaceRoleUseCase はスペースでの既定の役割を剥がす（冪等）。
type RevokeSpaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRevokeSpaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *RevokeSpaceRoleUseCase {
	return &RevokeSpaceRoleUseCase{repo: r}
}

type RevokeSpaceRoleInput struct {
	WorkspaceID string
	SpaceID     string
	PrincipalID string
}

func (u *RevokeSpaceRoleUseCase) Execute(ctx context.Context, in RevokeSpaceRoleInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return errors.New("spaceID is required")
	}
	if in.PrincipalID == "" {
		return errors.New("principalID is required")
	}
	return u.repo.DeleteSpaceGrant(ctx, in.WorkspaceID, in.SpaceID, in.PrincipalID)
}

// GrantPageRoleUseCase はページでの既定の役割を主体に与える（既定の 3 段目。
// ワークスペース → スペース → ページで、このページとその子孫に効く）。
//
// **これで誰かを弱めることはできない。** 付与はどこまでも足し算で打ち消す層は持たない
// （domain.GrantRole.Rank / domain.PagePermissionFacts 参照）。狭めたい内容は private の
// スペースへ置く。
type GrantPageRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewGrantPageRoleUseCase(r repository.KnowledgeBasePermissionRepository) *GrantPageRoleUseCase {
	return &GrantPageRoleUseCase{repo: r}
}

type GrantPageRoleInput struct {
	WorkspaceID string
	PageID      string
	PrincipalID string
	Role        domain.GrantRole
}

func (u *GrantPageRoleUseCase) Execute(ctx context.Context, in GrantPageRoleInput) (*domain.PageGrant, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return nil, errors.New("pageID is required")
	}
	if in.PrincipalID == "" {
		return nil, errors.New("principalID is required")
	}
	if !in.Role.Valid() {
		return nil, ErrInvalidGrantRole
	}
	if _, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, in.PrincipalID); err != nil {
		return nil, err
	}
	return u.repo.UpsertPageGrant(ctx, in.WorkspaceID, in.PageID, in.PrincipalID, in.Role)
}

// RevokePageRoleUseCase はページでの既定の役割を剥がす（冪等）。消えるのはこの段で
// 足した分だけで、ワークスペース / スペース / 祖先のページから届いている役割は残る
// （「このページだけ見せない」は書けない — 狭めたい内容は private のスペースへ置く）。
// 「最後の admin」の検査は要らない。ワークスペースの admin は配下の全ページに届くため、
// ページの grant を全部消してもワークスペース admin が 0 人になることはない。
type RevokePageRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRevokePageRoleUseCase(r repository.KnowledgeBasePermissionRepository) *RevokePageRoleUseCase {
	return &RevokePageRoleUseCase{repo: r}
}

type RevokePageRoleInput struct {
	WorkspaceID string
	PageID      string
	PrincipalID string
}

func (u *RevokePageRoleUseCase) Execute(ctx context.Context, in RevokePageRoleInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return errors.New("pageID is required")
	}
	if in.PrincipalID == "" {
		return errors.New("principalID is required")
	}
	return u.repo.DeletePageGrant(ctx, in.WorkspaceID, in.PageID, in.PrincipalID)
}

// ListPageGrantsUseCase はそのページ自身に張られた既定の役割の一覧を返す。
// **返るのは「このページを見られる人の一覧」ではない。** この段で足した行だけで、
// 上の段や祖先のページから届いている相手は含まれない。空でも「誰も見られない」ではなく
// 「この段では何も足していない」の意味になる。呼び出し側の画面はそれが分かる見せ方をすること。
type ListPageGrantsUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListPageGrantsUseCase(r repository.KnowledgeBasePermissionRepository) *ListPageGrantsUseCase {
	return &ListPageGrantsUseCase{repo: r}
}

type ListPageGrantsInput struct {
	WorkspaceID string
	PageID      string
}

func (u *ListPageGrantsUseCase) Execute(ctx context.Context, in ListPageGrantsInput) ([]domain.PageGrant, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return nil, errors.New("pageID is required")
	}
	return u.repo.ListPageGrants(ctx, in.WorkspaceID, in.PageID)
}

// ListGrantablePrincipalsUseCase は権限を張れる相手を表示名つきで返す。返るのはワークスペース
// 全体の主体で、ページでは絞らない（ページ単位の付与も相手はワークスペースの主体なので、
// 絞ると「同じ人に張れるはずなのに一覧に出ない」というずれが生まれる）。呼べる範囲・
// 認可は handler 側の gate がページ単位で決める。
type ListGrantablePrincipalsUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListGrantablePrincipalsUseCase(r repository.KnowledgeBasePermissionRepository) *ListGrantablePrincipalsUseCase {
	return &ListGrantablePrincipalsUseCase{repo: r}
}

type ListGrantablePrincipalsInput struct {
	WorkspaceID string
}

func (u *ListGrantablePrincipalsUseCase) Execute(
	ctx context.Context, in ListGrantablePrincipalsInput,
) ([]domain.GrantablePrincipal, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListGrantablePrincipals(ctx, in.WorkspaceID)
}

// ListWorkspaceMembersUseCase はワークスペースに属する人を表示名つきで返す。
// ListGrantablePrincipalsUseCase とは呼べる範囲が違う: あちらは権限を張る画面用で
// ページの管理権限を要るが、こちらは担当の表示名・名指し用途なので所属していれば読める。
type ListWorkspaceMembersUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListWorkspaceMembersUseCase(r repository.KnowledgeBasePermissionRepository) *ListWorkspaceMembersUseCase {
	return &ListWorkspaceMembersUseCase{repo: r}
}

func (u *ListWorkspaceMembersUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.WorkspaceMember, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListWorkspaceMembers(ctx, workspaceID)
}

// ListWorkspaceMembersForAdminUseCase はメンバー管理画面向けの一覧を返す。
// ListWorkspaceMembersUseCase と違い、停止中のアカウントも含み、現在のワークスペース
// 全体の役割も一緒に返す。呼べるのは admin だけ（handler 側の判定を参照）。
type ListWorkspaceMembersForAdminUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListWorkspaceMembersForAdminUseCase(r repository.KnowledgeBasePermissionRepository) *ListWorkspaceMembersForAdminUseCase {
	return &ListWorkspaceMembersForAdminUseCase{repo: r}
}

func (u *ListWorkspaceMembersForAdminUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.AdminWorkspaceMember, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListWorkspaceMembersForAdmin(ctx, workspaceID)
}

// ListSpaceMembersUseCase はそのスペースに届いている権限を人に解決して返す（段 9）。
// 可視判定（CanView）は handler 側が checkSpace で確かめてから呼ぶ（RenameSpace と同じ形）。
type ListSpaceMembersUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListSpaceMembersUseCase(r repository.KnowledgeBasePermissionRepository) *ListSpaceMembersUseCase {
	return &ListSpaceMembersUseCase{repo: r}
}

func (u *ListSpaceMembersUseCase) Execute(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceMember, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if spaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	return u.repo.ListSpaceMembers(ctx, workspaceID, spaceID)
}

// ListMySpacesUseCase は ListSpaceMembersUseCase の向きを逆にしたもの（GET /me/spaces 用）。
// 可視判定は要らない（自分自身の grants しか見ないため）。
type ListMySpacesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListMySpacesUseCase(r repository.KnowledgeBasePermissionRepository) *ListMySpacesUseCase {
	return &ListMySpacesUseCase{repo: r}
}

func (u *ListMySpacesUseCase) Execute(ctx context.Context, workspaceID string, userID uint64) ([]domain.MySpace, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if userID == 0 {
		return nil, errors.New("userID is required")
	}
	return u.repo.ListMySpaces(ctx, workspaceID, userID)
}

// ErrPrincipalKindMismatch は主体の種類が操作に合わないときに返す
// （グループでないものをグループとして扱おうとした等）。
var ErrPrincipalKindMismatch = errors.New("principal kind does not match the operation")

// kbGroupNameMaxLen は principals.name (varchar(200)) の上限。DB エラーの前に入口で弾く。
const kbGroupNameMaxLen = 200

// RemoveWorkspaceMemberUseCase はユーザーをワークスペースから外す（招待中なら取り消す）。
// principal があれば消え、grant / グループ所属も FK の CASCADE で消える（権限だけが
// 残らない）。workspace_members は消さず left として記録に残す。
type RemoveWorkspaceMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRemoveWorkspaceMemberUseCase(r repository.KnowledgeBasePermissionRepository) *RemoveWorkspaceMemberUseCase {
	return &RemoveWorkspaceMemberUseCase{repo: r}
}

type RemoveWorkspaceMemberInput struct {
	WorkspaceID string
	UserID      uint64
	// ActorUserID: UserID と同じなら本人の退会、違えば admin による除名として記録される。
	ActorUserID uint64
}

func (u *RemoveWorkspaceMemberUseCase) Execute(ctx context.Context, in RemoveWorkspaceMemberInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return errors.New("userID is required")
	}
	return u.repo.LeaveWorkspaceMembership(ctx, in.WorkspaceID, in.UserID, in.ActorUserID)
}

// ListMembershipEventsUseCase は所属・権限の変更履歴を新しい順で返す。
// 「なぜこの人が admin なのか」を後から説明できるようにするための読み取り専用の口。
type ListMembershipEventsUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListMembershipEventsUseCase(r repository.KnowledgeBasePermissionRepository) *ListMembershipEventsUseCase {
	return &ListMembershipEventsUseCase{repo: r}
}

func (u *ListMembershipEventsUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.MembershipEvent, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListMembershipEvents(ctx, workspaceID)
}

// CreatePrincipalGroupUseCase は権限をまとめて張るためのグループを作る。
// 名前はワークスペース内で一意（同名が 2 つあると権限を張る先を人が選べない）。
type CreatePrincipalGroupUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCreatePrincipalGroupUseCase(r repository.KnowledgeBasePermissionRepository) *CreatePrincipalGroupUseCase {
	return &CreatePrincipalGroupUseCase{repo: r}
}

type CreatePrincipalGroupInput struct {
	WorkspaceID string
	Name        string
}

func (u *CreatePrincipalGroupUseCase) Execute(ctx context.Context, in CreatePrincipalGroupInput) (*domain.Principal, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.Name == "" {
		return nil, errors.New("name is required")
	}
	if utf8.RuneCountInString(in.Name) > kbGroupNameMaxLen {
		return nil, errors.New("name is too long")
	}
	return u.repo.CreateGroupPrincipal(ctx, in.WorkspaceID, in.Name)
}

// AddGroupMemberUseCase はグループにユーザーを加える。加える相手を主体 ID ではなくユーザー
// ID で受けるのは、グループの入れ子をこの入口から作れないようにするため（DB 側も複合 FK で
// member を kind='user' に固定している。入れ子を許すと権限解決に再帰と循環防止が要る）。
type AddGroupMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewAddGroupMemberUseCase(r repository.KnowledgeBasePermissionRepository) *AddGroupMemberUseCase {
	return &AddGroupMemberUseCase{repo: r}
}

type AddGroupMemberInput struct {
	WorkspaceID string
	// GroupPrincipalID は kind='group' の主体。
	GroupPrincipalID string
	// MemberUserID は加えるユーザー。メンバーでなければ主体が無いのでエラーになる。
	MemberUserID uint64
}

func (u *AddGroupMemberUseCase) Execute(ctx context.Context, in AddGroupMemberInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.GroupPrincipalID == "" {
		return errors.New("groupPrincipalID is required")
	}
	if in.MemberUserID == 0 {
		return errors.New("memberUserID is required")
	}
	group, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, in.GroupPrincipalID)
	if err != nil {
		return err
	}
	if group.Kind != domain.PrincipalKindGroup {
		return ErrPrincipalKindMismatch
	}
	member, err := u.repo.FindUserPrincipal(ctx, in.WorkspaceID, in.MemberUserID)
	if err != nil {
		return err
	}
	return u.repo.AddGroupMember(ctx, in.WorkspaceID, group.ID, member.ID)
}

// RemoveGroupMemberUseCase はグループからユーザーを外す（冪等）。
type RemoveGroupMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRemoveGroupMemberUseCase(r repository.KnowledgeBasePermissionRepository) *RemoveGroupMemberUseCase {
	return &RemoveGroupMemberUseCase{repo: r}
}

type RemoveGroupMemberInput struct {
	WorkspaceID      string
	GroupPrincipalID string
	MemberUserID     uint64
}

func (u *RemoveGroupMemberUseCase) Execute(ctx context.Context, in RemoveGroupMemberInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.GroupPrincipalID == "" {
		return errors.New("groupPrincipalID is required")
	}
	if in.MemberUserID == 0 {
		return errors.New("memberUserID is required")
	}
	member, err := u.repo.FindUserPrincipal(ctx, in.WorkspaceID, in.MemberUserID)
	if err != nil {
		if errors.Is(err, repository.ErrPrincipalNotFound) {
			return nil // 非メンバーはどのグループにも属していない（冪等）
		}
		return err
	}
	return u.repo.RemoveGroupMember(ctx, in.WorkspaceID, in.GroupPrincipalID, member.ID)
}

// EnsureSpaceEveryonePrincipalUseCase はスペースの「全員」を表す主体を用意する（冪等）。
// 「既定でチーム全員が編集できる」を 1 行の grant で表すための下ごしらえ。
type EnsureSpaceEveryonePrincipalUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewEnsureSpaceEveryonePrincipalUseCase(r repository.KnowledgeBasePermissionRepository) *EnsureSpaceEveryonePrincipalUseCase {
	return &EnsureSpaceEveryonePrincipalUseCase{repo: r}
}

type EnsureSpaceEveryonePrincipalInput struct {
	WorkspaceID string
	SpaceID     string
}

func (u *EnsureSpaceEveryonePrincipalUseCase) Execute(ctx context.Context, in EnsureSpaceEveryonePrincipalInput) (*domain.Principal, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	return u.repo.EnsureSpaceEveryonePrincipal(ctx, in.WorkspaceID, in.SpaceID)
}

// CanRemoveWorkspaceAdminUseCase は「この相手からワークスペースの admin を外しても、
// admin が 1 人以上残るか」に答える。権限を減らす操作の前に呼び、false なら断る。
//
// ナレッジの権限に「アプリの super_admin なら通る」という抜け道は無いため、admin が
// 0 人になると誰もそのワークスペースの権限を変えられなくなり、復旧は DB を直接触るしかない。
// 数えるのは kind='user' の主体が持つ admin だけ（グループ宛ての admin を数えると、
// メンバーが 0 人のグループが「最後の admin」として残り同じ詰みが起きる。安全側に外れる）。
//
// **この確認だけでは競合を防げない**（判定と書き換えが別トランザクションのため。実測:
// admin 2 人をほぼ同時に外すと 60 回中 59 回 0 人になった）。実際に 0 人を防いでいるのは
// repository 側の行ロック（withLastAdminGuard）で、競合時は repository.ErrLastWorkspaceAdmin
// が同じ 409 に落ちる。この usecase を残すのは、日常の誤操作を書き換えを試みる前に
// 断れるようにするため — 「読んで確かめる口」と「書きながら守る歯止め」は役割が違う。
type CanRemoveWorkspaceAdminUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCanRemoveWorkspaceAdminUseCase(r repository.KnowledgeBasePermissionRepository) *CanRemoveWorkspaceAdminUseCase {
	return &CanRemoveWorkspaceAdminUseCase{repo: r}
}

// CanRemoveWorkspaceAdminInput は対象を主体 ID かユーザー ID のどちらかで指す。
// grant の取り消しは主体 ID を、メンバーの削除はユーザー ID を持っているため両方を受ける。
type CanRemoveWorkspaceAdminInput struct {
	WorkspaceID string
	// PrincipalID は admin を外す相手の主体。空なら UserID から引き直す。
	PrincipalID string
	// UserID は admin を外す相手をユーザーで指すときに使う。
	UserID uint64
}

func (u *CanRemoveWorkspaceAdminUseCase) Execute(ctx context.Context, in CanRemoveWorkspaceAdminInput) (bool, error) {
	if in.WorkspaceID == "" {
		return false, errors.New("workspaceID is required")
	}
	if in.PrincipalID == "" && in.UserID == 0 {
		return false, errors.New("principalID or userID is required")
	}

	target := in.PrincipalID
	if target == "" {
		principal, err := u.repo.FindUserPrincipal(ctx, in.WorkspaceID, in.UserID)
		if err != nil {
			if errors.Is(err, repository.ErrPrincipalNotFound) {
				// 非メンバーは grant を 1 つも持たない。外しても admin は減らない。
				return true, nil
			}
			return false, err
		}
		target = principal.ID
	}

	grants, err := u.repo.ListWorkspaceGrants(ctx, in.WorkspaceID)
	if err != nil {
		return false, err
	}
	targetIsAdmin := false
	others := make([]string, 0, len(grants))
	for _, g := range grants {
		if g.Role != domain.GrantRoleAdmin {
			continue
		}
		if g.PrincipalID == target {
			targetIsAdmin = true
			continue
		}
		others = append(others, g.PrincipalID)
	}
	if !targetIsAdmin {
		// 元から admin ではない相手なので、この操作で admin は 1 人も減らない。
		return true, nil
	}

	// 残る admin のうち、実際に人が入っていると確実に言えるもの（kind='user'）を探す。
	// 1 人でも見つかればそこで打ち切る（admin は多くないが、全件引く必要もない）。
	for _, principalID := range others {
		p, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, principalID)
		if err != nil {
			if errors.Is(err, repository.ErrPrincipalNotFound) {
				// grant を読んでから主体を引くまでの間に消えた。数に入れない（安全側）。
				continue
			}
			return false, err
		}
		if p.Kind == domain.PrincipalKindUser {
			return true, nil
		}
	}
	return false, nil
}

// CheckSpacePermissionUseCase は「このユーザーはこのスペースで既定で何ができるか」に答える。
// ページを名指しできない操作（スペース直下へのページ作成）の入口で使う。
// **ページの可否をこれで決めてはいけない**（page_grants を見ないため必ず狭い側へ倒れる。
// ページには CheckPagePermissionUseCase を使う）。判定規則は domain.ResolveScopePermission にある。
type CheckSpacePermissionUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCheckSpacePermissionUseCase(r repository.KnowledgeBasePermissionRepository) *CheckSpacePermissionUseCase {
	return &CheckSpacePermissionUseCase{repo: r}
}

type CheckSpacePermissionInput struct {
	WorkspaceID string
	SpaceID     string
	UserID      uint64
}

func (u *CheckSpacePermissionUseCase) Execute(ctx context.Context, in CheckSpacePermissionInput) (*domain.ScopePermission, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, repository.ErrSpaceNotFound
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.SpacePermissionFactsForUser(ctx, in.WorkspaceID, in.SpaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	perm := domain.ResolveScopePermission(*facts)
	return &perm, nil
}

// CheckWorkspacePermissionUseCase は「このユーザーはこのワークスペースで既定で何ができるか」に答える。
// どのスペースにも属さない操作（スペースの作成）の入口で使う。
type CheckWorkspacePermissionUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCheckWorkspacePermissionUseCase(r repository.KnowledgeBasePermissionRepository) *CheckWorkspacePermissionUseCase {
	return &CheckWorkspacePermissionUseCase{repo: r}
}

type CheckWorkspacePermissionInput struct {
	WorkspaceID string
	UserID      uint64
}

func (u *CheckWorkspacePermissionUseCase) Execute(ctx context.Context, in CheckWorkspacePermissionInput) (*domain.ScopePermission, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.WorkspacePermissionFactsForUser(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	perm := domain.ResolveScopePermission(*facts)
	return &perm, nil
}

// ListViewableSpacesUseCase はワークスペース配下のスペースのうち、そのユーザーが
// 中身を閲覧できるものだけを返す。
//
// スペースは「誰に何を見せるか」を分ける入れ物そのもの（key と name が並ぶだけでも
// 「人事」「M&A 準備」といった進行中の情報が伝わる）ため、一覧も権限でふるう。判定は
// domain.ResolveScopePermission だけが持ち、ここに書き足すと CheckSpacePermissionUseCase の
// 単体解決と食い違う。ページに張った付与（page_grants）は見ない — スペースが見えるかは
// そのスペース自体の役割で決まるため。**この結果をページの可否に使ってはいけない**
// （必ず狭い側へ倒れる）。
type ListViewableSpacesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListViewableSpacesUseCase(r repository.KnowledgeBasePermissionRepository) *ListViewableSpacesUseCase {
	return &ListViewableSpacesUseCase{repo: r}
}

type ListViewableSpacesInput struct {
	WorkspaceID string
	UserID      uint64
}

// Execute は閲覧できるスペースだけを返す（repository が返す順序＝ key 順を保つ）。
// 存在しないワークスペースでも空スライスを返す（エラーにしない）。実在の撃ち分けは
// URL の slug を解決する middleware がすでに 404 に畳んでおり、ここで別の応答を作ると
// その差がこの口だけで復活する。
func (u *ListViewableSpacesUseCase) Execute(ctx context.Context, in ListViewableSpacesInput) ([]domain.Space, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	rows, err := u.repo.ListWorkspaceSpaceScopeFacts(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Space, 0, len(rows))
	for _, row := range rows {
		// ここが権限のふるい。repository は役割の届いていないスペースも返してくるので、
		// これを外すと閲覧権限の無いスペースがそのまま応答に載る。
		if !domain.ResolveScopePermission(row.Facts).CanView {
			continue
		}
		out = append(out, row.Space)
	}
	return out, nil
}

// ListMemberWorkspacesUseCase は自分が所属するワークスペースを返す。
// ナレッジのほかの経路と違い URL に slug を持たない（どの slug を開けるかを知るための口）。
type ListMemberWorkspacesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListMemberWorkspacesUseCase(r repository.KnowledgeBasePermissionRepository) *ListMemberWorkspacesUseCase {
	return &ListMemberWorkspacesUseCase{repo: r}
}

type ListMemberWorkspacesInput struct {
	UserID uint64
}

func (u *ListMemberWorkspacesUseCase) Execute(ctx context.Context, in ListMemberWorkspacesInput) ([]domain.MemberWorkspace, error) {
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.ListMemberWorkspaces(ctx, in.UserID)
	if err != nil {
		return nil, err
	}
	// 役割の事実を実効権限へ解く規則は domain にだけある。1 件ずつの判定
	// （CheckWorkspacePermissionUseCase）と同じ関数を通すので、一覧の出し分けと入口の判定が揃う。
	out := make([]domain.MemberWorkspace, 0, len(facts))
	for _, f := range facts {
		out = append(out, domain.MemberWorkspace{
			Workspace:  f.Workspace,
			Permission: domain.ResolveScopePermission(f.Facts),
		})
	}
	return out, nil
}
