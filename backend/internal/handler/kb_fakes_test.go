package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ナレッジ handler テスト用の fake repository。
//
// 権限は「事実」まで組み立てて domain.ResolvePagePermission に通す（判定結果を直接返さない）。
// fake が判定を肩代わりすると、本番と違う規則でテストが緑になってしまうため。

// kbFakePages は repository.KnowledgeBaseRepository の in-memory fake。
type kbFakePages struct {
	workspaces map[string]*domain.Workspace // slug -> workspace
	spaces     map[string]*domain.Space     // spaceID -> space
	pages      map[string]*domain.Page      // pageID -> page
	snapshots  map[string]string            // pageID -> doc
	nextID     int
	// failWith は次の書き込み系呼び出しを失敗させる（500 経路の確認用）。
	failWith error
	// moveErr は MovePage を指定のエラーで失敗させる。移動でしか起きないセンチネル
	// （スペース全員宛ての例外が失効する移動）を handler 越しに見るために分けてある。
	moveErr error
	// replaceBlocksErr は ReplacePageBlocks を指定のエラーで失敗させる。本文保存でしか
	// 起きないセンチネル（他ページの block id を乗っ取ろうとする保存の拒否）を
	// handler 越しに見るために分けてある。
	replaceBlocksErr error
	// findPageCalls は FindPage が呼ばれた回数。権限の入口が「認可の前に対象を読む」形へ
	// 戻っていないことをテストから確かめるために数える。
	findPageCalls int
}

var _ repository.KnowledgeBaseRepository = (*kbFakePages)(nil)

func newKbFakePages() *kbFakePages {
	return &kbFakePages{
		workspaces: map[string]*domain.Workspace{},
		spaces:     map[string]*domain.Space{},
		pages:      map[string]*domain.Page{},
		snapshots:  map[string]string{},
	}
}

func (f *kbFakePages) addWorkspace(id, slug string) {
	f.workspaces[slug] = &domain.Workspace{ID: id, Slug: slug, Name: slug, IsActive: true}
}

func (f *kbFakePages) addSpace(workspaceID, spaceID string) {
	f.spaces[spaceID] = &domain.Space{
		ID: spaceID, WorkspaceID: workspaceID, Key: spaceID, Name: spaceID,
		Visibility: domain.SpaceVisibilityWorkspace,
	}
}

func (f *kbFakePages) addPage(p domain.Page) *domain.Page {
	if p.Position == "" {
		p.Position = "a0"
	}
	stored := p
	f.pages[p.ID] = &stored
	return &stored
}

func copyPage(p *domain.Page) *domain.Page {
	c := *p
	return &c
}

func (f *kbFakePages) FindWorkspaceByID(_ context.Context, workspaceID string) (*domain.Workspace, error) {
	for _, ws := range f.workspaces {
		if ws.ID == workspaceID {
			c := *ws
			return &c, nil
		}
	}
	return nil, repository.ErrWorkspaceNotFound
}

func (f *kbFakePages) FindWorkspaceBySlug(_ context.Context, slug string) (*domain.Workspace, error) {
	ws, ok := f.workspaces[slug]
	if !ok {
		return nil, repository.ErrWorkspaceNotFound
	}
	c := *ws
	return &c, nil
}

// FindPersonalWorkspaceByOwner はこのフェイクでは使わない（個人ワークスペースの確保は
// サインアップ経路のテストが別途持つ）。インターフェースを満たすためだけに実装する。
func (f *kbFakePages) FindPersonalWorkspaceByOwner(_ context.Context, _ uint64) (*domain.Workspace, error) {
	return nil, repository.ErrWorkspaceNotFound
}

// hasWorkspaceID は ID でワークスペースの実在を確かめる（マップの鍵は slug なので走査する）。
func (f *kbFakePages) hasWorkspaceID(workspaceID string) bool {
	for _, ws := range f.workspaces {
		if ws.ID == workspaceID {
			return true
		}
	}
	return false
}

func (f *kbFakePages) FindPageByIDAcrossWorkspaces(_ context.Context, pageID string) (*domain.Page, error) {
	p, ok := f.pages[pageID]
	if !ok {
		return nil, repository.ErrPageNotFound
	}
	c := *p
	return &c, nil
}

// workspacesWithMembers は「所属している人がいるワークスペース」の集合
// （本番の users.workspace_id が指しているもの）。本番は DeleteWorkspace の SQL の
// WHERE NOT EXISTS が守るので、fake でも同じ規則をここで写す。
var workspacesWithMembers = map[string]bool{}

func (f *kbFakePages) DeleteWorkspace(_ context.Context, workspaceID string) error {
	if f.failWith != nil {
		return f.failWith
	}
	// 実在しないものは「無かった」。消えたことにしない。
	var found *domain.Workspace
	for _, ws := range f.workspaces {
		if ws.ID == workspaceID {
			found = ws
			break
		}
	}
	if found == nil {
		return repository.ErrWorkspaceNotFound
	}
	// 人が居るものは誰であっても消せない（本番と同じ順序: 実在 → 人が居るか）。
	if workspacesWithMembers[workspaceID] {
		return repository.ErrWorkspaceHasMembers
	}
	delete(f.workspaces, found.Slug)
	// 配下は本番では FK の CASCADE で消える。fake でも同じ結果にする。
	for id, sp := range f.spaces {
		if sp.WorkspaceID == workspaceID {
			delete(f.spaces, id)
		}
	}
	for id, pg := range f.pages {
		if pg.WorkspaceID == workspaceID {
			delete(f.pages, id)
		}
	}
	return nil
}

func (f *kbFakePages) DeletePageSubtree(_ context.Context, workspaceID, pageID string) error {
	if f.failWith != nil {
		return f.failWith
	}
	root, ok := f.pages[pageID]
	if !ok || root.WorkspaceID != workspaceID {
		return repository.ErrPageNotFound
	}
	doomed := map[string]bool{pageID: true}
	// 子孫を親リンクで数え上げる（数が変わらなくなるまで）。
	for {
		grew := false
		for id, p := range f.pages {
			if doomed[id] || p.ParentID == nil {
				continue
			}
			if doomed[*p.ParentID] {
				doomed[id] = true
				grew = true
			}
		}
		if !grew {
			break
		}
	}
	for id := range doomed {
		delete(f.pages, id)
		delete(f.snapshots, id)
	}
	return nil
}

// ListAncestorPageIDs は親の連鎖を根から順に返す（closure table の代わりに素直に辿る）。
func (f *kbFakePages) ListAncestorPageIDs(_ context.Context, workspaceID, pageID string) ([]string, error) {
	out := []string{}
	current, ok := f.pages[pageID]
	if !ok || current.WorkspaceID != workspaceID {
		return out, nil
	}
	for current.ParentID != nil {
		parent, ok := f.pages[*current.ParentID]
		if !ok {
			break
		}
		out = append([]string{parent.ID}, out...)
		current = parent
	}
	return out, nil
}

func (f *kbFakePages) FindSpace(_ context.Context, workspaceID, spaceID string) (*domain.Space, error) {
	s, ok := f.spaces[spaceID]
	if !ok || s.WorkspaceID != workspaceID {
		return nil, repository.ErrSpaceNotFound
	}
	c := *s
	return &c, nil
}

func (f *kbFakePages) UpdateSpaceName(_ context.Context, workspaceID, spaceID, name string) error {
	s, ok := f.spaces[spaceID]
	if !ok || s.WorkspaceID != workspaceID {
		return repository.ErrSpaceNotFound
	}
	s.Name = name
	return nil
}

func (f *kbFakePages) CreateSpace(_ context.Context, space *domain.Space) error {
	if f.failWith != nil {
		return f.failWith
	}
	// 実在しないワークスペースへの作成は本番だと FK 違反 →「無い」に翻訳される。
	// fake が黙って保存すると、本番では通らない作成要求で緑になるテストが書ける。
	if !f.hasWorkspaceID(space.WorkspaceID) {
		return repository.ErrWorkspaceNotFound
	}
	for _, s := range f.spaces {
		if s.WorkspaceID == space.WorkspaceID && s.Key == space.Key {
			return repository.ErrSpaceKeyTaken
		}
	}
	f.nextID++
	space.ID = "space-" + strconv.Itoa(f.nextID)
	space.CreatedAt = time.Now()
	space.UpdatedAt = space.CreatedAt
	stored := *space
	f.spaces[space.ID] = &stored
	return nil
}

func (f *kbFakePages) FindPage(_ context.Context, workspaceID, pageID string) (*domain.Page, error) {
	f.findPageCalls++
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return nil, repository.ErrPageNotFound
	}
	return copyPage(p), nil
}

func (f *kbFakePages) ListActivePagesBySpace(_ context.Context, workspaceID, spaceID string) ([]domain.Page, error) {
	return f.activePages(workspaceID, spaceID), nil
}

// ListAllWorkspaceIDs / ListActivePageIDsByWorkspace は cmd/rebuildsearchindex 専用。
// この handler パッケージの単体テストでは使わないが、interface を
// 満たすために最小限の実装を用意する。
func (f *kbFakePages) ListAllWorkspaceIDs(_ context.Context) ([]string, error) {
	ids := make([]string, 0, len(f.workspaces))
	for _, ws := range f.workspaces {
		ids = append(ids, ws.ID)
	}
	return ids, nil
}

func (f *kbFakePages) ListActivePageIDsByWorkspace(_ context.Context, workspaceID string) ([]string, error) {
	ids := make([]string, 0)
	for _, p := range f.pages {
		if p.WorkspaceID == workspaceID && p.ArchivedAt == nil {
			ids = append(ids, p.ID)
		}
	}
	return ids, nil
}

// activePages は position 順に並んだ現役ページを返す（本番の ORDER BY "position" と同じ並び）。
func (f *kbFakePages) activePages(workspaceID, spaceID string) []domain.Page {
	return f.pagesInSpace(workspaceID, spaceID, false)
}

// parentArchived は親がアーカイブ済みかを返す（親を持たない行は false）。本番の LEFT JOIN と同じ。
func (f *kbFakePages) parentArchived(p domain.Page) bool {
	if p.ParentID == nil {
		return false
	}
	parent, ok := f.pages[*p.ParentID]
	return ok && parent.ArchivedAt != nil
}

// pagesInSpace は position 順に並んだページを返す。archived で現役／アーカイブ済みを切り替える
// （本番のクエリが 1 本で両方を返すのと同じ形にする — 別実装にすると fake だけ挙動がずれる）。
func (f *kbFakePages) pagesInSpace(workspaceID, spaceID string, archived bool) []domain.Page {
	out := make([]domain.Page, 0, len(f.pages))
	for _, p := range f.pages {
		if p.WorkspaceID == workspaceID && p.SpaceID == spaceID && (p.ArchivedAt != nil) == archived {
			out = append(out, *p)
		}
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Position < out[j-1].Position; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// LastActiveSiblingPosition は現役の兄弟の末尾キーを返す（兄弟がいなければ空文字）。
// 本番と同じ値を返さないと、「末尾に足す」経路のテストが実際には何も確かめない。
func (f *kbFakePages) LastActiveSiblingPosition(
	_ context.Context, workspaceID, spaceID string, parentID *string,
) (string, error) {
	last := ""
	for _, p := range f.pages {
		if p.WorkspaceID != workspaceID || p.SpaceID != spaceID || p.ArchivedAt != nil {
			continue
		}
		if (p.ParentID == nil) != (parentID == nil) {
			continue
		}
		if p.ParentID != nil && *p.ParentID != *parentID {
			continue
		}
		if p.Position > last {
			last = p.Position
		}
	}
	return last, nil
}

// SiblingPositionsAround は本番と同じく「その親の現役の子」に限って隣を探す。
// 動かす当人は必ず除く（自分自身との中間値を計算しないため）。
// 伏せられている兄弟も並びには居るので数える（本番のクエリは権限を見ない）。
func (f *kbFakePages) SiblingPositionsAround(
	_ context.Context, workspaceID, spaceID string, parentID *string, anchorPageID, movingPageID string,
) (bool, string, string, string, error) {
	siblings := make([]domain.Page, 0, len(f.pages))
	for _, p := range f.pages {
		if p.WorkspaceID != workspaceID || p.SpaceID != spaceID || p.ArchivedAt != nil {
			continue
		}
		if p.ID == movingPageID {
			continue
		}
		if (p.ParentID == nil) != (parentID == nil) {
			continue
		}
		if p.ParentID != nil && *p.ParentID != *parentID {
			continue
		}
		siblings = append(siblings, *p)
	}
	anchorPos := ""
	for _, p := range siblings {
		if p.ID == anchorPageID {
			anchorPos = p.Position
		}
	}
	if anchorPos == "" {
		return false, "", "", "", nil
	}
	prev, next := "", ""
	for _, p := range siblings {
		if p.Position < anchorPos && p.Position > prev {
			prev = p.Position
		}
		if p.Position > anchorPos && (next == "" || p.Position < next) {
			next = p.Position
		}
	}
	return true, prev, anchorPos, next, nil
}

func (f *kbFakePages) HasActiveSiblingPosition(_ context.Context, _, _ string, _ *string, _, _ string) (bool, error) {
	return false, nil
}

func (f *kbFakePages) HasDescendant(_ context.Context, workspaceID, pageID, candidateID string) (bool, error) {
	cur, ok := f.pages[candidateID]
	for ok && cur.WorkspaceID == workspaceID {
		if cur.ID == pageID {
			return true, nil
		}
		if cur.ParentID == nil {
			break
		}
		cur, ok = f.pages[*cur.ParentID]
	}
	return false, nil
}

func (f *kbFakePages) CreatePage(_ context.Context, page *domain.Page) error {
	f.nextID++
	page.ID = "created-page-" + string(rune('a'+f.nextID-1))
	page.CreatedAt = time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	page.UpdatedAt = page.CreatedAt
	stored := *page
	f.pages[page.ID] = &stored
	return nil
}

func (f *kbFakePages) UpdatePageTitle(_ context.Context, workspaceID, pageID, title string) (*domain.Page, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return nil, repository.ErrPageNotFound
	}
	p.Title = title
	return copyPage(p), nil
}

func (f *kbFakePages) UpdatePageIcon(_ context.Context, workspaceID, pageID string, icon *domain.PageIcon) (*domain.Page, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return nil, repository.ErrPageNotFound
	}
	p.Icon = icon
	return copyPage(p), nil
}

func (f *kbFakePages) UpdatePageCover(_ context.Context, workspaceID, pageID string, cover *domain.PageCover) (*domain.Page, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	p, ok := f.pages[pageID]
	// 本番の UpdatePageCover と同じく archived_at IS NULL も見る（アーカイブ済みは 0 行 = ErrPageNotFound）。
	if !ok || p.WorkspaceID != workspaceID || p.ArchivedAt != nil {
		return nil, repository.ErrPageNotFound
	}
	p.Cover = cover
	return copyPage(p), nil
}

func (f *kbFakePages) UpdatePageVisibility(_ context.Context, workspaceID, pageID string, visibility domain.PageVisibility) (*domain.Page, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	p, ok := f.pages[pageID]
	// 本番の UpdatePageVisibility と同じく archived_at IS NULL も見る（アーカイブ済みは 0 行 = ErrPageNotFound）。
	if !ok || p.WorkspaceID != workspaceID || p.ArchivedAt != nil {
		return nil, repository.ErrPageNotFound
	}
	p.Visibility = visibility
	return copyPage(p), nil
}

func (f *kbFakePages) TouchPageLastEditedBy(_ context.Context, workspaceID, pageID string, userID uint64) error {
	if f.failWith != nil {
		return f.failWith
	}
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return repository.ErrPageNotFound
	}
	p.LastEditedByUserID = &userID
	return nil
}

func (f *kbFakePages) MovePage(_ context.Context, workspaceID, pageID string, newParentID *string, newSpaceID, newPosition string) error {
	if f.moveErr != nil {
		return f.moveErr
	}
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return repository.ErrPageNotFound
	}
	p.ParentID = newParentID
	p.SpaceID = newSpaceID
	p.Position = newPosition
	return nil
}

func (f *kbFakePages) ArchivePageSubtree(ctx context.Context, workspaceID, pageID string) error {
	if f.failWith != nil {
		return f.failWith
	}
	at := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	for id, p := range f.pages {
		if p.WorkspaceID != workspaceID || p.ArchivedAt != nil {
			continue
		}
		desc, _ := f.HasDescendant(ctx, workspaceID, pageID, id)
		if desc {
			t := at
			p.ArchivedAt = &t
		}
	}
	return nil
}

func (f *kbFakePages) UnarchivePageSubtree(ctx context.Context, workspaceID, pageID string, archivedSince time.Time, newRootPosition *string) error {
	for id, p := range f.pages {
		if p.WorkspaceID != workspaceID || p.ArchivedAt == nil || !p.ArchivedAt.Equal(archivedSince) {
			continue
		}
		desc, _ := f.HasDescendant(ctx, workspaceID, pageID, id)
		if !desc {
			continue
		}
		p.ArchivedAt = nil
		if id == pageID && newRootPosition != nil {
			p.Position = *newRootPosition
		}
	}
	return nil
}

func (f *kbFakePages) ListBlocksByPage(_ context.Context, _, _ string) ([]domain.Block, error) {
	return []domain.Block{}, nil
}

func (f *kbFakePages) ReplacePageBlocks(
	_ context.Context, workspaceID, pageID string, _ []repository.BlockWrite, snapshotDoc, _, _ string,
	_ []repository.PageLinkWrite, _ []repository.PageTicketLinkWrite,
) error {
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return repository.ErrPageNotFound
	}
	if f.replaceBlocksErr != nil {
		return f.replaceBlocksErr
	}
	f.snapshots[pageID] = snapshotDoc
	return nil
}

// RebuildPageSearchAndLinks はこのパッケージの handler テストでは使わない
// （page_search / page_links は結合テストが実 PostgreSQL で確かめる）。
func (f *kbFakePages) RebuildPageSearchAndLinks(_ context.Context, workspaceID, pageID string) error {
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return repository.ErrPageNotFound
	}
	return nil
}

func (f *kbFakePages) GetPageSnapshot(_ context.Context, workspaceID, pageID string) (*domain.PageSnapshot, error) {
	p, ok := f.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return nil, repository.ErrPageSnapshotNotFound
	}
	doc, ok := f.snapshots[pageID]
	if !ok {
		return nil, repository.ErrPageSnapshotNotFound
	}
	return &domain.PageSnapshot{
		PageID:  pageID,
		Doc:     doc,
		BuiltAt: time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC),
	}, nil
}

// ancestorsOf は対象ページから根までの経路を近い順に返す（本番の page_paths と同じ並びで、
// 先頭が対象ページ自身 = depth 0）。返る添字がそのまま depth になる。
func (f *kbFakePages) ancestorsOf(workspaceID, pageID string) []string {
	path := make([]string, 0, 4)
	seen := map[string]bool{}
	for cur, ok := f.pages[pageID], true; ok && cur != nil; {
		if cur.WorkspaceID != workspaceID || seen[cur.ID] {
			break
		}
		seen[cur.ID] = true
		path = append(path, cur.ID)
		if cur.ParentID == nil {
			break
		}
		cur, ok = f.pages[*cur.ParentID]
	}
	return path
}

// kbPermKey は「どのページを誰が」の組。
type kbPermKey struct {
	pageID string
	userID uint64
}

// errKbFakeNotModeled はこの fake が再現していない口を呼ばれたときのエラー。
//
// nil を返して黙って成功させない。ここが呼ばれるのは配線が変わったときだけなので、
// そのときは 500 として目に見えるようにする。
var errKbFakeNotModeled = errors.New("kb fake: この口は再現していない")

// kbFakePerms は repository.KnowledgeBasePermissionRepository の in-memory fake。
//
// 判定そのものはせず、domain.ResolvePagePermission がその答えを出すような「事実」を返す。
//
// 権限は 3 段の付与（ワークスペース / スペース / ページ）を足し合わせ、届いた中で最も強い
// 役割で決まる。打ち消す層は無いので、**同じスペースの中で 1 枚だけ隠すことはできない**
// （見せたくないものは別のスペースへ置く。hideInOwnPrivateSpace 参照）。
//
// 印を「allow 行があるか」で代用すると、主体を 1 つ消しただけで限定公開が解けるという
// 本番には無い挙動になり、その穴を踏むテストが緑のまま通ってしまう。
type kbFakePerms struct {
	pages *kbFakePages
	// principals は principalID -> 主体。実メンバー（招待を受諾済み）は kind='user' の
	// 行の有無で表す（本番と同じ。招待そのものは kbFakeInvitations が持つ）。
	principals map[string]*domain.Principal
	// groupMembers は groupPrincipalID -> memberPrincipalID の集合。
	groupMembers map[string]map[string]bool
	nextID       int
	// permReadCalls は「権限を決めるための読み取り」が呼ばれた回数（メソッド名ごと）。
	//
	// 権限操作の入口が **結果によらず同じ回数・同じ内訳で引く** ことをテストから確かめるために
	// 数える。回数が結果で変わると、応答のバイト列を揃えても返るまでの時間から
	// 対象の実在が読めてしまう。特定のメソッドだけ数えると、別のメソッドで前段の確認が
	// 復活したときに素通りするので、**入口が使いうる読み取りを全部**ここへ入れる。
	permReadCalls map[string]int
	// perPage は特定のページだけ別の既定にしたいときの上書き。
	perPage map[kbPermKey]domain.PagePermission
	// fallback は perPage に無いページの既定。
	fallback domain.PagePermission
	// membersErr は所属判定を失敗させる（middleware の 500 経路の確認用）。
	membersErr error
	// listFactsErr は一覧の事実収集を失敗させる（ツリー取得の 500 経路の確認用）。
	listFactsErr error
	// subtreeFactsErr はサブツリーの事実収集を失敗させる（アーカイブの 500 経路の確認用）。
	subtreeFactsErr error
	// scopeRoles は入れ物（ワークスペース / スペース）ごとの既定の役割。
	// ページ単位の perPage とは別に持つ（スペースの判定はページの例外を見ないため、
	// 同じ入れ物にまとめると fake が本番より賢くなってしまう）。
	scopeRoles map[kbScopeKey]domain.GrantRole
	// grants は workspace_grants / space_grants の行。入れ物 ID が
	// ワークスペースかスペースかの違いしかないので 1 つの map で持つ。
	grants map[kbGrantKey]domain.GrantRole
	// pageGrants は page_grants の行（既定の 3 段目）。入れ物の grant と別に持つのは、
	// 効く範囲が違うため — こちらは張ったページとその子孫にだけ届く。
	pageGrants map[kbGrantKey]domain.GrantRole
	// userNames は users.name の写し（相手選びの一覧で使う表示名）。
	// principals.name とは別に持つ。本番でも正本が別の表なので、
	// まとめると「グループ以外は名前が空」という挙動を再現できない。
	userNames map[uint64]string
	// shareLinks は share_links の行（linkID -> 行）。
	shareLinks map[string]*domain.ShareLink
	// scopeFactsErr は入れ物単位の事実収集を失敗させる（500 経路の確認用）。
	scopeFactsErr error
	// listWorkspacesErr は所属ワークスペース一覧を失敗させる（500 経路の確認用）。
	listWorkspacesErr error
	// revokeGrantErr は grant の取り消しを失敗させる。
	// 本物の repository が「最後の admin」を書き込みと同じトランザクションで断る経路
	// （競合で手前の検査をすり抜けたとき）を、fake でも再現するために使う。
	revokeGrantErr error
	// leaveWorkspaceErr は LeaveWorkspaceMembership を失敗させる。revokeGrantErr と同じ理由で、
	// 「最後の admin の退会」を本物の repository の実装をなぞらず fake から直接再現する。
	leaveWorkspaceErr error
}

// kbScopeKey は入れ物（ワークスペース ID / スペース ID）と利用者の組。
type kbScopeKey struct {
	scopeID string
	userID  uint64
}

// kbGrantKey は grant 1 行の主キー（入れ物 + 主体）。
type kbGrantKey struct {
	scopeID     string
	principalID string
}

var _ repository.KnowledgeBasePermissionRepository = (*kbFakePerms)(nil)

// kbFakePerms は ShareLinkRepository も兼ねる。principal の採番（f.newPrincipal）と
// ページの実在確認（f.pages）を共有リンクの発行がそのまま使うため、本番のように
// 別 struct へ分けるとこの 2 つを二重に持つことになる。
var _ repository.ShareLinkRepository = (*kbFakePerms)(nil)

func newKbFakePerms(pages *kbFakePages, fallback domain.PagePermission) *kbFakePerms {
	return &kbFakePerms{
		pages:        pages,
		principals:   map[string]*domain.Principal{},
		groupMembers: map[string]map[string]bool{},
		perPage:      map[kbPermKey]domain.PagePermission{},
		scopeRoles:   map[kbScopeKey]domain.GrantRole{},
		grants:       map[kbGrantKey]domain.GrantRole{},
		pageGrants:   map[kbGrantKey]domain.GrantRole{},
		userNames:    map[uint64]string{},
		shareLinks:   map[string]*domain.ShareLink{},
		fallback:     fallback,
	}
}

// addMember はユーザーをワークスペースに所属させる（kind='user' の主体を 1 行作る）。
func (f *kbFakePerms) addMember(workspaceID string, userID uint64) {
	_, _ = f.EnsureUserPrincipal(context.Background(), workspaceID, userID)
}

// denyPage はそのページに「この人だけ外す」例外（deny）を 1 行張る。
//
// 既定を弱く張り替える形では表せない。既定は 3 段（ワークスペース / スペース / ページ）
// から届いて**最も強いものが実効**になるので、弱い役割を足しても下がらない。
// hideInOwnPrivateSpace は対象ページを「自分が届かない private スペース」へ移し、
// その相手から見えなくする。
//
// **これが「見えないページ」を作る唯一のやり方**。権限は 3 段の付与を足し合わせて
// 最も強い役割で決まり、打ち消す層が無いので、同じスペースの中で 1 枚だけ隠すことはできない。
// 見せたくないものは別のスペースへ置く、という本番の運用をそのまま写している。
//
// 親子は DB の複合 FK（fk_pages_parent）でスペースが揃うので、子を持つページには使わない。
func (f *kbFakePerms) hideInOwnPrivateSpace(workspaceID, pageID string) {
	page, ok := f.pages.pages[pageID]
	if !ok || page.WorkspaceID != workspaceID {
		panic("hideInOwnPrivateSpace: そのページが無い")
	}
	for _, other := range f.pages.pages {
		if other.ParentID != nil && *other.ParentID == pageID {
			panic("hideInOwnPrivateSpace: 子を持つページには使えない（スペースは親子で揃う）")
		}
	}
	hidden := "0198a000-0000-7000-8000-0000000000ff"
	if _, exists := f.pages.spaces[hidden]; !exists {
		f.pages.spaces[hidden] = &domain.Space{
			ID: hidden, WorkspaceID: workspaceID, Key: "hidden", Name: "hidden",
			Visibility: domain.SpaceVisibilityPrivate,
		}
	}
	page.SpaceID = hidden
	page.ParentID = nil
}

// setPagePermission はそのページでの既定（役割）を差し替える。
//
// **これはテスト用の口で、ページの grant を張ったのに近いが子孫には伝わらない。**
// 本番のページ付与は子孫へ降りるので、「祖先より弱い子孫」を作れるのは fake の中だけ。
// サブツリー検査のような防御を突く回帰テストに使う（本番では起こらない状態を作って、
// 検査がまだ働くことを確かめる）。
func (f *kbFakePerms) setPagePermission(pageID string, userID uint64, perm domain.PagePermission) {
	f.perPage[kbPermKey{pageID: pageID, userID: userID}] = perm
}

// roleFor は望む実効権限になる既定の役割を返す（例外を使わずに表現する）。
func roleFor(perm domain.PagePermission) *domain.GrantRole {
	switch {
	case perm.CanManage:
		role := domain.GrantRoleAdmin
		return &role
	case perm.CanEdit:
		role := domain.GrantRoleEditor
		return &role
	case perm.CanComment:
		// CanComment だけを立てたい（viewer より強いが editor ではない）テストのための分岐。
		// commenter は CanView も含むので、下の CanView 分岐より先に見る必要がある。
		role := domain.GrantRoleCommenter
		return &role
	case perm.CanView:
		role := domain.GrantRoleViewer
		return &role
	default:
		return nil
	}
}

func (f *kbFakePerms) permFor(pageID string, userID uint64) domain.PagePermission {
	if perm, ok := f.perPage[kbPermKey{pageID: pageID, userID: userID}]; ok {
		return perm
	}
	return f.fallback
}

// newPrincipal は主体を 1 行作って複製を返す。
func (f *kbFakePerms) newPrincipal(p domain.Principal) *domain.Principal {
	f.nextID++
	p.ID = "principal-" + strconv.Itoa(f.nextID)
	stored := p
	f.principals[p.ID] = &stored
	c := stored
	return &c
}

// userPrincipal はそのユーザーの主体を引く（無ければ nil = 非メンバー）。
func (f *kbFakePerms) userPrincipal(workspaceID string, userID uint64) *domain.Principal {
	for _, p := range f.principals {
		if p.WorkspaceID == workspaceID && p.Kind == domain.PrincipalKindUser && p.UserID != nil && *p.UserID == userID {
			return p
		}
	}
	return nil
}

// mine は「そのユーザーとして扱われる主体」の集合（本人 / 所属グループ / そのスペースの全員）。
// 本番の権限クエリの mine CTE と同じ組み立て方で、非メンバーには空集合を返す。
func (f *kbFakePerms) mine(workspaceID, spaceID string, userID uint64) map[string]bool {
	self := f.userPrincipal(workspaceID, userID)
	if self == nil {
		return map[string]bool{}
	}
	out := map[string]bool{self.ID: true}
	for groupID, members := range f.groupMembers {
		if members[self.ID] {
			out[groupID] = true
		}
	}
	// private のスペースには space_all（そのスペースの全員）を届かせない（本番と同じ規則）。
	if sp, ok := f.pages.spaces[spaceID]; !ok || sp.Visibility != domain.SpaceVisibilityPrivate {
		for _, p := range f.principals {
			if p.WorkspaceID == workspaceID && p.Kind == domain.PrincipalKindSpaceAll && p.SpaceID != nil && *p.SpaceID == spaceID {
				out[p.ID] = true
			}
		}
	}
	return out
}

func (f *kbFakePerms) IsWorkspaceMember(_ context.Context, workspaceID string, userID uint64) (bool, error) {
	if f.membersErr != nil {
		return false, f.membersErr
	}
	return f.userPrincipal(workspaceID, userID) != nil, nil
}

func (f *kbFakePerms) IsWorkspaceMemberBulk(_ context.Context, workspaceID string, userIDs []uint64) (map[uint64]bool, error) {
	if f.membersErr != nil {
		return nil, f.membersErr
	}
	out := make(map[uint64]bool, len(userIDs))
	for _, userID := range userIDs {
		if f.userPrincipal(workspaceID, userID) != nil {
			out[userID] = true
		}
	}
	return out, nil
}

// InviteWorkspaceMember は招待中の行を作る（冪等。既に active/invited なら何もしない）。
// principal はまだ作らない（本番と同じ — 受諾するまで権限は届かない）。
// LeaveWorkspaceMembership は所属を終える（principal があれば消し、invited の行も消す）。
// actorUserID（段 6・監査）は fake では追跡しない — 実際の記録内容の検証は結合テストが持つ。
func (f *kbFakePerms) LeaveWorkspaceMembership(ctx context.Context, workspaceID string, userID, _ uint64) error {
	if f.leaveWorkspaceErr != nil {
		return f.leaveWorkspaceErr
	}
	principal := f.userPrincipal(workspaceID, userID)
	if principal == nil {
		return nil // 既に非メンバー
	}
	return f.DeletePrincipal(ctx, workspaceID, principal.ID)
}

// PagePermissionFactsForUser はそのページに届いている既定の役割と、経路上の例外を返す。
//
// 既定は 3 段（ワークスペース / スペース / ページ）から届き、**最も強いものが実効**になる。
// fake もその 3 つを合成する。片方しか見ないと、たとえばワークスペースの admin が
// ページの権限を変えられないといった、本番には無い挙動でテストが緑になる。
//
// perPage / fallback は「このページでの既定」をテストが直接指定するための口で、
// 合成の 3 つ目として混ぜる（ページの grant を張ったのと同じ扱い）。
func (f *kbFakePerms) PagePermissionFactsForUser(_ context.Context, workspaceID, pageID string, userID uint64) (*domain.PagePermissionFacts, error) {
	f.countPermRead("PagePermissionFactsForUser")
	// pages.FindPage は通さない。本番はこの解決が 1 本のクエリで完結し、ページを別途
	// 読みには行かない。fake が FindPage を呼ぶと、その回数を数えている検査
	//（認可より先にページを読まない）が fake の都合で赤くなる。
	page, ok := f.pages.pages[pageID]
	if !ok || page.WorkspaceID != workspaceID {
		return nil, repository.ErrPageNotFound
	}
	// 非メンバーには既定の役割を 1 つも届かせない。本番は主体（principals の
	// kind='user' の行）から役割を集めるので、その行が無ければ集めようがない。
	// ここを素通しにすると、fake の中でだけ非メンバーが役割を持ち、
	// 「非メンバーは 1 本も通せない」を確かめているテストが空振りする。
	if f.userPrincipal(workspaceID, userID) == nil {
		return &domain.PagePermissionFacts{}, nil
	}
	return &domain.PagePermissionFacts{
		Member: true,
		Role:   f.roleForPage(workspaceID, page, userID),
	}, nil
}

// roleForPage はそのページに届いている最も強い役割を返す（grant が 1 つも無ければ nil）。
//
// **1 ページ解決も一覧も検索もこれを通す。** 本番はどの経路も同じ 3 段の付与を同じ
// 畳み方で集めるので、fake がどれか 1 つだけ別の作り方をすると「開けるのに一覧に出ない」
// 側のずれをテストが見逃す。
//
// fallback / perPage は「このページでの既定」をテストが直接指定するための口で、
// 合成の 3 つ目として混ぜる（ページの grant を張ったのと同じ扱い）。
func (f *kbFakePerms) roleForPage(workspaceID string, page *domain.Page, userID uint64) *domain.GrantRole {
	if f.userPrincipal(workspaceID, userID) == nil {
		return nil
	}
	mine := f.mine(workspaceID, page.SpaceID, userID)
	roles := f.rolesAt(kbScopeKey{scopeID: page.SpaceID, userID: userID}, workspaceID, userID)
	roles = append(roles, f.pageGrantRoles(workspaceID, page.ID, mine)...)
	if role := roleFor(f.permFor(page.ID, userID)); role != nil {
		roles = append(roles, *role)
	}
	return domain.StrongestGrantRole(roles)
}

// pageGrantRoles は対象ページと祖先に張られた grant のうち、自分に効くものを返す。
// 経路は近い順に辿るが、合成が「最も強いもの」なので段の近さは効かない
// （例外の層と違い、grant には「最も近い段が勝つ」という規則が無い）。
func (f *kbFakePerms) pageGrantRoles(workspaceID, pageID string, mine map[string]bool) []domain.GrantRole {
	roles := make([]domain.GrantRole, 0, 2)
	for _, ancestorID := range f.pages.ancestorsOf(workspaceID, pageID) {
		for key, role := range f.pageGrants {
			if key.scopeID == ancestorID && mine[key.principalID] {
				roles = append(roles, role)
			}
		}
	}
	return roles
}

// SearchWorkspacePageViewFacts は本番のクエリと同じ見方で候補と事実を返す:
// 題名の部分一致（大文字小文字は区別しない）・現役のみ・ワークスペース境界。
// 事実（届いた中で最も強い役割）は一覧（ListSpacePageViewFacts）と同じ作り方にする —
// 検索だけ別の作り方をすると、届かないスペースのページが検索でだけ見える fake になり、
// 本番との差がテストの穴になる。判定（ふるい）は usecase が行う。
//
// この fake は page_search（本文の派生キャッシュ）を持たないため、本文一致
// は模していない — Body は常に空文字で返す。本文検索そのものの
// 確認は本物の PostgreSQL を使う結合テストが行う（knowledge_base_permission_repository_
// integration_test.go）。
func (f *kbFakePerms) SearchWorkspacePageViewFacts(
	_ context.Context, workspaceID string, userID uint64, query string,
) ([]repository.PageSearchViewFact, error) {
	f.countPermRead("SearchWorkspacePageViewFacts")
	needle := strings.ToLower(query)
	out := make([]repository.PageSearchViewFact, 0)
	if f.userPrincipal(workspaceID, userID) == nil {
		return out, nil
	}
	for _, p := range f.pages.pages {
		if p.WorkspaceID != workspaceID || p.ArchivedAt != nil {
			continue
		}
		if !strings.Contains(strings.ToLower(p.Title), needle) {
			continue
		}
		out = append(out, repository.PageSearchViewFact{
			PageWithViewFacts: repository.PageWithViewFacts{
				Page: *p,
				Role: f.roleForPage(workspaceID, p, userID),
			},
		})
	}
	// map の巡回順に依存しない並び（本番は題名順）。
	sort.Slice(out, func(i, j int) bool { return out[i].Page.Title < out[j].Page.Title })
	return out, nil
}

// ListPageLinkSourcePageViewFacts はこの fake では使わない
// （逆リンクは page_links を必要とし、この in-memory fake は持たない。逆リンクの確認は
// 本物の PostgreSQL を使う結合テストが行う）。呼ばれたら空を返す。
func (f *kbFakePerms) ListPageLinkSourcePageViewFacts(
	_ context.Context, _ string, _ uint64, _ string,
) ([]repository.PageWithViewFacts, error) {
	return []repository.PageWithViewFacts{}, nil
}

func (f *kbFakePerms) ListPageTicketLinkSourcePageViewFacts(
	_ context.Context, _ string, _ uint64, _ string,
) ([]repository.PageWithViewFacts, error) {
	return []repository.PageWithViewFacts{}, nil
}

// ListWorkspacePageViewFactsByIDs は ID 群の可視事実。事実の作り方は検索と同一
// （ここだけ別の作り方をすると、届かないスペースの参照が fake でだけ解決されてしまう）。
func (f *kbFakePerms) ListWorkspacePageViewFactsByIDs(
	_ context.Context, workspaceID string, userID uint64, pageIDs []string,
) ([]repository.PageWithViewFacts, error) {
	f.countPermRead("ListWorkspacePageViewFactsByIDs")
	out := make([]repository.PageWithViewFacts, 0)
	if f.userPrincipal(workspaceID, userID) == nil {
		return out, nil
	}
	wanted := map[string]bool{}
	for _, id := range pageIDs {
		wanted[id] = true
	}
	for _, p := range f.pages.pages {
		// アーカイブ済みも行として返す（本番と同じ）。除外の判断は呼び出し側が持つ。
		if p.WorkspaceID != workspaceID || !wanted[p.ID] {
			continue
		}
		out = append(out, repository.PageWithViewFacts{
			Page: *p,
			Role: f.roleForPage(workspaceID, p, userID),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Page.Title < out[j].Page.Title })
	return out, nil
}

func (f *kbFakePerms) ListSpacePageViewFacts(
	_ context.Context, workspaceID, spaceID string, userID uint64, archived bool,
) ([]repository.PageWithViewFacts, error) {
	if f.listFactsErr != nil {
		return nil, f.listFactsErr
	}
	pages := f.pages.pagesInSpace(workspaceID, spaceID, archived)
	out := make([]repository.PageWithViewFacts, 0, len(pages))
	for _, p := range pages {
		page := p
		out = append(out, repository.PageWithViewFacts{
			Page:           p,
			Role:           f.roleForPage(workspaceID, &page, userID),
			ParentArchived: f.pages.parentArchived(p),
		})
	}
	return out, nil
}

// ListSubtreePagePermissionFacts は対象ページ自身と全子孫の事実を返す（アーカイブ済みも含む）。
// 本番のクエリと同じく、主体の集合は根のスペースで決める（サブツリーは 1 スペースに収まる）。
func (f *kbFakePerms) ListSubtreePagePermissionFacts(
	ctx context.Context, workspaceID, pageID string, userID uint64,
) ([]repository.PageWithPermissionFacts, error) {
	if f.subtreeFactsErr != nil {
		return nil, f.subtreeFactsErr
	}
	root, ok := f.pages.pages[pageID]
	if !ok || root.WorkspaceID != workspaceID {
		// closure が 1 行も無い状態と同じ（呼び出し側はここを許可に倒さない）。
		return []repository.PageWithPermissionFacts{}, nil
	}
	member := f.userPrincipal(workspaceID, userID) != nil
	ids := make([]string, 0, len(f.pages.pages))
	for id, p := range f.pages.pages {
		if p.WorkspaceID != workspaceID {
			continue
		}
		if desc, _ := f.pages.HasDescendant(ctx, workspaceID, pageID, id); desc {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	out := make([]repository.PageWithPermissionFacts, 0, len(ids))
	for _, id := range ids {
		out = append(out, repository.PageWithPermissionFacts{
			PageID: id,
			Facts: domain.PagePermissionFacts{
				Member: member,
				Role:   f.roleForPage(workspaceID, f.pages.pages[id], userID),
			},
		})
	}
	return out, nil
}

// countPermRead は権限の読み取り 1 回を記録する。テストはこの内訳を比べて、
// 結果によって引く回数が変わっていないことを確かめる。
func (f *kbFakePerms) countPermRead(method string) {
	if f.permReadCalls == nil {
		f.permReadCalls = map[string]int{}
	}
	f.permReadCalls[method]++
}

// SpacePermissionFactsForUser はスペース単位の事実（届いている役割の集合）を返す。
// ページ付与（page_grants）は見ない — 本番の口と同じで、対象がまだ存在しない操作に使う。
func (f *kbFakePerms) SpacePermissionFactsForUser(
	_ context.Context, workspaceID, spaceID string, userID uint64,
) (*domain.ScopeFacts, error) {
	f.countPermRead("SpacePermissionFactsForUser")
	if f.scopeFactsErr != nil {
		return nil, f.scopeFactsErr
	}
	// 本番は空間の実在を確かめてから役割を集める（確かめないと workspace_grants が
	// 他テナントのスペースにも届いてしまう）。fake も同じ順で断る。
	s, ok := f.pages.spaces[spaceID]
	if !ok || s.WorkspaceID != workspaceID {
		return nil, repository.ErrSpaceNotFound
	}
	if f.userPrincipal(workspaceID, userID) == nil {
		return &domain.ScopeFacts{}, nil
	}
	return &domain.ScopeFacts{Roles: f.rolesAt(kbScopeKey{scopeID: spaceID, userID: userID}, workspaceID, userID)}, nil
}

// ListWorkspaceSpaceScopeFacts はワークスペース配下のスペース全件と、それぞれで
// 自分に届いている役割を返す。**役割が 1 つも無いスペースも落とさずに含める** —
// 本番のクエリが LEFT JOIN で全スペースを返すのと同じで、ふるいは呼び出し側にある。
// ここで見えないスペースを間引くと、ふるいを外しても緑のままになるテストが書ける。
func (f *kbFakePerms) ListWorkspaceSpaceScopeFacts(
	_ context.Context, workspaceID string, userID uint64,
) ([]repository.SpaceWithScopeFacts, error) {
	if f.scopeFactsErr != nil {
		return nil, f.scopeFactsErr
	}
	member := f.userPrincipal(workspaceID, userID) != nil
	spaces := make([]*domain.Space, 0, len(f.pages.spaces))
	for _, s := range f.pages.spaces {
		if s.WorkspaceID == workspaceID {
			spaces = append(spaces, s)
		}
	}
	// 本番は key 順で返す（ORDER BY s."key"）。map の走査順に依存させない。
	sort.Slice(spaces, func(i, j int) bool { return spaces[i].Key < spaces[j].Key })
	out := make([]repository.SpaceWithScopeFacts, 0, len(spaces))
	for _, s := range spaces {
		facts := domain.ScopeFacts{Roles: []domain.GrantRole{}}
		if member {
			facts.Roles = f.rolesAt(kbScopeKey{scopeID: s.ID, userID: userID}, workspaceID, userID)
		}
		out = append(out, repository.SpaceWithScopeFacts{Space: *s, Facts: facts})
	}
	return out, nil
}

// WorkspacePermissionFactsForUser はワークスペース単位の事実を返す。
func (f *kbFakePerms) WorkspacePermissionFactsForUser(
	_ context.Context, workspaceID string, userID uint64,
) (*domain.ScopeFacts, error) {
	f.countPermRead("WorkspacePermissionFactsForUser")
	if f.scopeFactsErr != nil {
		return nil, f.scopeFactsErr
	}
	if f.userPrincipal(workspaceID, userID) == nil {
		return &domain.ScopeFacts{}, nil
	}
	return &domain.ScopeFacts{Roles: f.rolesAt(kbScopeKey{scopeID: workspaceID, userID: userID}, workspaceID, userID)}, nil
}

// GrantWorkspaceRoleIfAbsent は grant 行が無いときだけ既定の役割を入れる。
// 「無い」の基準は本番（INSERT ... ON CONFLICT DO NOTHING）と同じく grant 行で、
// 実効権限の写し（scopeRoles）ではない。行を入れたときだけ読み取り側へも反映する。
func (f *kbFakePerms) GrantWorkspaceRoleIfAbsent(ctx context.Context, workspaceID, principalID string, role domain.GrantRole) error {
	// 本番は複合 FK が「別ワークスペースの主体」を弾く。fake も同じ形で断る。
	if _, err := f.FindPrincipal(ctx, workspaceID, principalID); err != nil {
		return err
	}
	grantKey := kbGrantKey{scopeID: workspaceID, principalID: principalID}
	if _, exists := f.grants[grantKey]; exists {
		return nil
	}
	f.grants[grantKey] = role
	f.mirrorGrant(workspaceID, principalID, &role)
	return nil
}

func (f *kbFakePerms) rolesAt(key kbScopeKey, workspaceID string, userID uint64) []domain.GrantRole {
	roles := make([]domain.GrantRole, 0, 2)
	if role, ok := f.scopeRoles[key]; ok {
		roles = append(roles, role)
	}
	if key.scopeID != workspaceID {
		// private のスペースにはワークスペース既定の役割を届かせない（本番のクエリと同じ規則。
		// ここを写さないと「fake では見えるが本番では見えない」逆向きの穴になる）。
		if sp, ok := f.pages.spaces[key.scopeID]; ok && sp.Visibility == domain.SpaceVisibilityPrivate {
			return roles
		}
		if role, ok := f.scopeRoles[kbScopeKey{scopeID: workspaceID, userID: userID}]; ok {
			roles = append(roles, role)
		}
	}
	return roles
}

// setScopeRole は入れ物（ワークスペース ID / スペース ID）ごとの既定の役割を差し替える。
func (f *kbFakePerms) setScopeRole(scopeID string, userID uint64, role domain.GrantRole) {
	f.scopeRoles[kbScopeKey{scopeID: scopeID, userID: userID}] = role
}

// ListMemberWorkspaces は kind='user' の主体があるワークスペースを slug 順で返す。
func (f *kbFakePerms) ListMemberWorkspaces(_ context.Context, userID uint64) ([]domain.MemberWorkspace, error) {
	if f.listWorkspacesErr != nil {
		return nil, f.listWorkspacesErr
	}
	out := []domain.MemberWorkspace{}
	for _, ws := range f.pages.workspaces {
		if f.userPrincipal(ws.ID, userID) != nil {
			role := f.scopeRoles[kbScopeKey{scopeID: ws.ID, userID: userID}]
			out = append(out, domain.MemberWorkspace{Workspace: *ws, CanManage: role == domain.GrantRoleAdmin})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

// kbFakeUsers は [repository.UserRepository] の最小 fake。
// user.LookupUserDisplayUseCase が読む FindDisplayByID の Name だけをテストが制御できればよく、
// それ以外のメソッドは kb 系のテストでは呼ばれないため未実装のスタブでよい。
type kbFakeUsers struct {
	// names は users.name の写し（LookupUserDisplayUseCase のテスト用の設定口）。
	names map[uint64]string
	// emails は users.email の写し（正規形）。招待の承諾は「確認済みの email が宛先と一致するか」で
	// 決まるので、テストが宛先側の状態を作るための設定口。
	emails map[uint64]string
	// failWith は次の FindByID / FindDisplayByID 呼び出しを失敗させる（LookupUserDisplayUseCase の
	// 「失敗は伝える」を確かめるため）。
	failWith error
}

var _ repository.UserRepository = (*kbFakeUsers)(nil)

func newKbFakeUsers() *kbFakeUsers {
	return &kbFakeUsers{names: map[uint64]string{}, emails: map[uint64]string{}}
}

// setUserEmail はそのユーザーの確認済み email を決める（本番の users.email。正規形で持つ）。
func (f *kbFakeUsers) setUserEmail(userID uint64, email string) {
	f.emails[userID] = domain.NormalizeEmail(email)
}

func (f *kbFakeUsers) FindActiveIDByEmail(_ context.Context, email string) (uint64, bool, error) {
	if f.failWith != nil {
		return 0, false, f.failWith
	}
	want := domain.NormalizeEmail(email)
	for id, e := range f.emails {
		if e == want {
			return id, true, nil
		}
	}
	return 0, false, nil
}

// setUserName はそのユーザーの表示名を決める（本番の users.name）。
func (f *kbFakeUsers) setUserName(userID uint64, name string) {
	f.names[userID] = name
}

func (f *kbFakeUsers) FindByID(_ context.Context, userID uint64) (*domain.User, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	name, hasName := f.names[userID]
	if !hasName {
		return nil, nil
	}
	return &domain.User{ID: userID, Name: name, Email: f.emails[userID]}, nil
}

// FindDisplayByID は user.LookupUserDisplayUseCase が読む経路（本番の GetUserDisplayByID
// 相当）。テストが制御できるのは names だけで、アイコン・状態メッセージは常に空文字。
func (f *kbFakeUsers) FindDisplayByID(_ context.Context, userID uint64) (*domain.UserDisplay, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	name, hasName := f.names[userID]
	if !hasName {
		return nil, nil
	}
	return &domain.UserDisplay{UserID: userID, Name: name}, nil
}

func (f *kbFakeUsers) FindByOidcSubject(context.Context, string) (*domain.User, error) {
	return nil, nil
}

func (f *kbFakeUsers) OidcSubjectByUserID(context.Context, uint64) (string, error) { return "", nil }

func (f *kbFakeUsers) Create(context.Context, *domain.User) error { return nil }

func (f *kbFakeUsers) UpdateActive(context.Context, uint64, bool) error { return nil }

func (f *kbFakeUsers) SoftDelete(context.Context, uint64) error { return nil }

func (f *kbFakeUsers) UpdateName(context.Context, uint64, string) error { return nil }

func (f *kbFakeUsers) UpdateEmail(context.Context, uint64, string) error { return nil }

// fakeTxManager は repository.TxManager のテスト用 no-op 実装。
// fn(ctx) をそのまま呼ぶだけで、実 DB もトランザクションも介さない。
// usecase の単体テストで、既存の repository fake/mock をそのまま使い続けるために使う。
type fakeTxManager struct{}

var _ repository.TxManager = fakeTxManager{}

func (fakeTxManager) DoInTx(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx)
}

func (f *kbFakePerms) EnsureUserPrincipal(_ context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	if p := f.userPrincipal(workspaceID, userID); p != nil {
		c := *p
		return &c, nil
	}
	uid := userID
	return f.newPrincipal(domain.Principal{
		WorkspaceID: workspaceID, Kind: domain.PrincipalKindUser, UserID: &uid,
	}), nil
}

func (f *kbFakePerms) EnsureSpaceEveryonePrincipal(_ context.Context, workspaceID, spaceID string) (*domain.Principal, error) {
	for _, p := range f.principals {
		if p.WorkspaceID == workspaceID && p.Kind == domain.PrincipalKindSpaceAll && p.SpaceID != nil && *p.SpaceID == spaceID {
			c := *p
			return &c, nil
		}
	}
	sid := spaceID
	return f.newPrincipal(domain.Principal{
		WorkspaceID: workspaceID, Kind: domain.PrincipalKindSpaceAll, SpaceID: &sid,
	}), nil
}

func (f *kbFakePerms) CreateGroupPrincipal(_ context.Context, workspaceID, name string) (*domain.Principal, error) {
	return f.newPrincipal(domain.Principal{
		WorkspaceID: workspaceID, Kind: domain.PrincipalKindGroup, Name: name,
	}), nil
}

func (f *kbFakePerms) FindPrincipal(_ context.Context, workspaceID, principalID string) (*domain.Principal, error) {
	p, ok := f.principals[principalID]
	if !ok || p.WorkspaceID != workspaceID {
		return nil, repository.ErrPrincipalNotFound
	}
	c := *p
	return &c, nil
}

func (f *kbFakePerms) FindUserPrincipal(_ context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	p := f.userPrincipal(workspaceID, userID)
	if p == nil {
		return nil, repository.ErrPrincipalNotFound
	}
	c := *p
	return &c, nil
}

// ListGrantablePrincipals は権限を張れる相手を kind → 名前 → id の順で返す。
//
// 名前は本番と同じ出どころにする（group は principals.name、user は users、
// space_all は spaces）。fake で principals.name を全 kind に使うと、
// 「グループ以外は名前が空で返る」という本番の挙動をテストで再現できない。
func (f *kbFakePerms) ListGrantablePrincipals(_ context.Context, workspaceID string) ([]domain.GrantablePrincipal, error) {
	out := []domain.GrantablePrincipal{}
	for _, p := range f.principals {
		if p.WorkspaceID != workspaceID || p.Kind == domain.PrincipalKindShareLink {
			continue
		}
		name := ""
		switch p.Kind {
		case domain.PrincipalKindGroup:
			name = p.Name
		case domain.PrincipalKindUser:
			if p.UserID != nil {
				name = f.userNames[*p.UserID]
			}
		case domain.PrincipalKindSpaceAll:
			if p.SpaceID != nil {
				if sp, ok := f.pages.spaces[*p.SpaceID]; ok {
					name = sp.Name
				}
			}
		}
		out = append(out, domain.GrantablePrincipal{ID: p.ID, Kind: p.Kind, Name: name})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// ListWorkspaceMembers は人だけを名前 → id の順で返す（本番の SQL と同じく、
// 人でない主体と名前を引けないユーザーを落とす）。
func (f *kbFakePerms) ListWorkspaceMembers(_ context.Context, workspaceID string) ([]domain.WorkspaceMember, error) {
	out := []domain.WorkspaceMember{}
	for _, p := range f.principals {
		if p.WorkspaceID != workspaceID || p.Kind != domain.PrincipalKindUser || p.UserID == nil {
			continue
		}
		name, ok := f.userNames[*p.UserID]
		if !ok {
			// 本番は users との内部結合なので、ユーザーの行が無ければ主体ごと落ちる。
			continue
		}
		out = append(out, domain.WorkspaceMember{PrincipalID: p.ID, UserID: *p.UserID, Name: name})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].UserID < out[j].UserID
	})
	return out, nil
}

// ListWorkspaceMembersForAdmin は ListWorkspaceMembers と同じ主体集合を返すが、
// ワークスペース全体の役割（f.grants）も一緒に載せる。AccountStatus は常に active —
// アカウントの状態（users.status）は fake の管轄外（handler パッケージの fakeUserRepo が持つ）
// なので、停止中でも一覧から落ちないことそのものは結合テストが検証する。
func (f *kbFakePerms) ListWorkspaceMembersForAdmin(_ context.Context, workspaceID string) ([]domain.AdminWorkspaceMember, error) {
	out := []domain.AdminWorkspaceMember{}
	for _, p := range f.principals {
		if p.WorkspaceID != workspaceID || p.Kind != domain.PrincipalKindUser || p.UserID == nil {
			continue
		}
		name, ok := f.userNames[*p.UserID]
		if !ok {
			continue
		}
		m := domain.AdminWorkspaceMember{
			PrincipalID:   p.ID,
			UserID:        *p.UserID,
			Name:          name,
			AccountStatus: domain.UserStatusActive,
		}
		if role, ok := f.grants[kbGrantKey{scopeID: workspaceID, principalID: p.ID}]; ok {
			r := role
			m.Role = &r
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].UserID < out[j].UserID
	})
	return out, nil
}

// DeletePrincipal は主体と、それに紐づく例外・グループ所属を消す（本番の FK CASCADE と同じ）。
// 許可リスト制の印には触れない。載っていた主体が全員消えた段は「誰も載っていない許可リスト」
// として残り、閉じたままになる。
func (f *kbFakePerms) DeletePrincipal(_ context.Context, workspaceID, principalID string) error {
	p, ok := f.principals[principalID]
	if !ok || p.WorkspaceID != workspaceID {
		return repository.ErrPrincipalNotFound
	}
	delete(f.principals, principalID)
	delete(f.groupMembers, principalID)
	for _, members := range f.groupMembers {
		delete(members, principalID)
	}
	return nil
}

func (f *kbFakePerms) AddGroupMember(_ context.Context, _, groupPrincipalID, memberPrincipalID string) error {
	if f.groupMembers[groupPrincipalID] == nil {
		f.groupMembers[groupPrincipalID] = map[string]bool{}
	}
	f.groupMembers[groupPrincipalID][memberPrincipalID] = true
	return nil
}

func (f *kbFakePerms) RemoveGroupMember(_ context.Context, _, groupPrincipalID, memberPrincipalID string) error {
	delete(f.groupMembers[groupPrincipalID], memberPrincipalID)
	return nil
}

// --- ここから grant（既定の権限）と共有リンク。権限操作 API が通る口。

// mirrorGrant は grant の書き換えを読み取り側（scopeRoles）にも反映する。
//
// fake が「書けるが読めない」状態だと、権限を付与する API のテストが
// 「付与したのに実効権限が変わらない」ことに気づけない。反映するのは kind='user' の
// 主体だけ（scopeRoles がユーザー単位のため）。グループやスペース全員宛ての grant は
// grants にだけ残り、そちらの実効権限はページ経路の perPage で表す。
func (f *kbFakePerms) mirrorGrant(scopeID, principalID string, role *domain.GrantRole) {
	p, ok := f.principals[principalID]
	if !ok || p.Kind != domain.PrincipalKindUser || p.UserID == nil {
		return
	}
	key := kbScopeKey{scopeID: scopeID, userID: *p.UserID}
	if role == nil {
		delete(f.scopeRoles, key)
		return
	}
	f.scopeRoles[key] = *role
}

// listGrants は入れ物 1 つ分の grant を主体 ID 順で返す。
func (f *kbFakePerms) listGrants(scopeID string) []kbGrantKey {
	keys := make([]kbGrantKey, 0, len(f.grants))
	for k := range f.grants {
		if k.scopeID == scopeID {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].principalID < keys[j].principalID })
	return keys
}

func (f *kbFakePerms) UpsertWorkspaceGrant(
	ctx context.Context, workspaceID, principalID string, role domain.GrantRole, _ uint64,
) (*domain.WorkspaceGrant, error) {
	// 本番は複合 FK で「別ワークスペースの主体には張れない」を DB が弾く。fake も同じ形で断る。
	if _, err := f.FindPrincipal(ctx, workspaceID, principalID); err != nil {
		return nil, err
	}
	f.grants[kbGrantKey{scopeID: workspaceID, principalID: principalID}] = role
	f.mirrorGrant(workspaceID, principalID, &role)
	return &domain.WorkspaceGrant{WorkspaceID: workspaceID, PrincipalID: principalID, Role: role}, nil
}

// DeleteWorkspaceGrant は 0 行削除でも成功のまま（本番と同じく取り消しは冪等）。
// actorUserID（段 6・監査）は fake では追跡しない。
func (f *kbFakePerms) DeleteWorkspaceGrant(_ context.Context, workspaceID, principalID string, _ uint64) error {
	if f.revokeGrantErr != nil {
		return f.revokeGrantErr
	}
	delete(f.grants, kbGrantKey{scopeID: workspaceID, principalID: principalID})
	f.mirrorGrant(workspaceID, principalID, nil)
	return nil
}

func (f *kbFakePerms) ListWorkspaceGrants(_ context.Context, workspaceID string) ([]domain.WorkspaceGrant, error) {
	out := []domain.WorkspaceGrant{}
	for _, k := range f.listGrants(workspaceID) {
		out = append(out, domain.WorkspaceGrant{
			WorkspaceID: workspaceID, PrincipalID: k.principalID, Role: f.grants[k],
		})
	}
	return out, nil
}

// ListMembershipEvents は kb 系のテストでは使われない（段 6 の usecase/handler テストは
// 専用の fake/mock を別に持つ）。呼ばれても落ちないよう空を返すだけの最小実装。
func (f *kbFakePerms) ListMembershipEvents(context.Context, string) ([]domain.MembershipEvent, error) {
	return []domain.MembershipEvent{}, nil
}

// RecordMembershipEvent も同様に、kb 系のテストでは記録内容を検証しない
// （usecase/user.SetUserActiveUseCase 側の単体テストが専用の spy を持つ）。呼ばれても
// 落ちないだけの最小実装。
func (f *kbFakePerms) RecordMembershipEvent(
	context.Context, string, uint64, uint64, domain.MembershipEventAction, *string, *string,
) error {
	return nil
}

func (f *kbFakePerms) UpsertSpaceGrant(
	ctx context.Context, workspaceID, spaceID, principalID string, role domain.GrantRole,
) (*domain.SpaceGrant, error) {
	if _, err := f.FindPrincipal(ctx, workspaceID, principalID); err != nil {
		return nil, err
	}
	f.grants[kbGrantKey{scopeID: spaceID, principalID: principalID}] = role
	f.mirrorGrant(spaceID, principalID, &role)
	return &domain.SpaceGrant{
		WorkspaceID: workspaceID, SpaceID: spaceID, PrincipalID: principalID, Role: role,
	}, nil
}

func (f *kbFakePerms) DeleteSpaceGrant(_ context.Context, _, spaceID, principalID string) error {
	delete(f.grants, kbGrantKey{scopeID: spaceID, principalID: principalID})
	f.mirrorGrant(spaceID, principalID, nil)
	return nil
}

func (f *kbFakePerms) ListSpaceGrants(_ context.Context, workspaceID, spaceID string) ([]domain.SpaceGrant, error) {
	out := []domain.SpaceGrant{}
	for _, k := range f.listGrants(spaceID) {
		out = append(out, domain.SpaceGrant{
			WorkspaceID: workspaceID, SpaceID: spaceID, PrincipalID: k.principalID, Role: f.grants[k],
		})
	}
	return out, nil
}

func (f *kbFakePerms) UpsertPageGrant(
	ctx context.Context, workspaceID, pageID, principalID string, role domain.GrantRole,
) (*domain.PageGrant, error) {
	if _, err := f.FindPrincipal(ctx, workspaceID, principalID); err != nil {
		return nil, err
	}
	f.pageGrants[kbGrantKey{scopeID: pageID, principalID: principalID}] = role
	return &domain.PageGrant{
		WorkspaceID: workspaceID, PageID: pageID, PrincipalID: principalID, Role: role,
	}, nil
}

func (f *kbFakePerms) DeletePageGrant(_ context.Context, _, pageID, principalID string) error {
	delete(f.pageGrants, kbGrantKey{scopeID: pageID, principalID: principalID})
	return nil
}

// ListPageGrants はそのページ自身に張られた行だけを返す（祖先の分は含まない）。
// 解決（pageGrantRoles）は祖先も辿るので、ここで祖先まで返すと
// 「一覧に出るのは自分の段だけ」という約束が fake でだけ崩れる。
func (f *kbFakePerms) ListPageGrants(_ context.Context, workspaceID, pageID string) ([]domain.PageGrant, error) {
	keys := make([]kbGrantKey, 0, len(f.pageGrants))
	for k := range f.pageGrants {
		if k.scopeID == pageID {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].principalID < keys[j].principalID })
	out := []domain.PageGrant{}
	for _, k := range keys {
		out = append(out, domain.PageGrant{
			WorkspaceID: workspaceID, PageID: pageID, PrincipalID: k.principalID, Role: f.pageGrants[k],
		})
	}
	return out, nil
}

// Create は共有リンクと、その来訪者を表す主体を一緒に作る（本番は 1 トランザクション）。
func (f *kbFakePerms) Create(_ context.Context, in repository.ShareLinkWrite) (*domain.ShareLink, error) {
	page, ok := f.pages.pages[in.PageID]
	if !ok || page.WorkspaceID != in.WorkspaceID {
		return nil, repository.ErrPageNotFound
	}
	pageID := in.PageID
	principal := f.newPrincipal(domain.Principal{
		WorkspaceID: in.WorkspaceID, Kind: domain.PrincipalKindShareLink, PageID: &pageID,
	})
	f.nextID++
	link := &domain.ShareLink{
		ID:              "share-link-" + strconv.Itoa(f.nextID),
		WorkspaceID:     in.WorkspaceID,
		PageID:          in.PageID,
		PrincipalID:     principal.ID,
		Capability:      in.Capability,
		TokenHash:       in.TokenHash,
		PasswordHash:    in.PasswordHash,
		ExpiresAt:       in.ExpiresAt,
		CreatedByUserID: in.CreatedByUserID,
		CreatedAt:       time.Now(),
	}
	f.shareLinks[link.ID] = link
	c := *link
	return &c, nil
}

// Revoke は行を消さず revoked_at を立てる（誰がいつ止めたかを残すため）。
// 既に失効済みなら何もしない（冪等）。
func (f *kbFakePerms) Revoke(_ context.Context, workspaceID, shareLinkID string) error {
	link, ok := f.shareLinks[shareLinkID]
	if !ok || link.WorkspaceID != workspaceID {
		return repository.ErrShareLinkNotFound
	}
	if link.RevokedAt == nil {
		now := time.Now()
		link.RevokedAt = &now
	}
	return nil
}

// FindByTokenHash は期限切れ・失効も含めて返す（判定は usecase 側）。
func (f *kbFakePerms) FindByTokenHash(_ context.Context, tokenHash []byte) (*domain.ShareLink, error) {
	for _, link := range f.shareLinks {
		if string(link.TokenHash) == string(tokenHash) {
			c := *link
			return &c, nil
		}
	}
	return nil, repository.ErrShareLinkNotFound
}

func (f *kbFakePerms) ListByPage(_ context.Context, workspaceID, pageID string) ([]domain.ShareLink, error) {
	out := []domain.ShareLink{}
	for _, link := range f.shareLinks {
		if link.WorkspaceID == workspaceID && link.PageID == pageID {
			out = append(out, *link)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *kbFakePerms) PagePermissionFactsForPrincipal(context.Context, string, string, string) (*domain.PagePermissionFacts, error) {
	return nil, errKbFakeNotModeled
}

// kbFakeImagePresigner は repository.KbImagePresigner の最小 fake。
// 呼ばれた key をそのまま URL に埋めて返すだけで、実オブジェクトストレージには触らない。
type kbFakeImagePresigner struct {
	// failWith が非 nil なら PresignUpload / PresignDownload の両方をそのエラーで失敗させる。
	failWith error
}

var _ repository.KbImagePresigner = (*kbFakeImagePresigner)(nil)

func (f *kbFakeImagePresigner) PresignUpload(_ context.Context, key, _ string, _ int64) (string, int, error) {
	if f.failWith != nil {
		return "", 0, f.failWith
	}
	return "https://storage.googleapis.com/example/" + key + "?upload=1", 600, nil
}

func (f *kbFakeImagePresigner) PresignDownload(_ context.Context, key string) (string, int, error) {
	if f.failWith != nil {
		return "", 0, f.failWith
	}
	return "https://storage.googleapis.com/example/" + key + "?download=1", 600, nil
}

// kbFakeProvisioner は repository.WorkspaceProvisioner の in-memory fake。
//
// ワークスペースの行と、作成者の主体・admin の grant を「まとめて」入れる
// （本番は 1 トランザクション）。ここで主体だけを省くと、作成者が自分の作った
// ワークスペースに入れないという本番で最も避けたい状態がテストで再現できなくなる。
type kbFakeProvisioner struct {
	pages *kbFakePages
	perms *kbFakePerms
	// failWith は次の作成を失敗させる（500 経路の確認用）。
	failWith error
}

var _ repository.WorkspaceProvisioner = (*kbFakeProvisioner)(nil)

func newKbFakeProvisioner(pages *kbFakePages, perms *kbFakePerms) *kbFakeProvisioner {
	return &kbFakeProvisioner{pages: pages, perms: perms}
}

func (f *kbFakeProvisioner) ProvisionWorkspace(
	ctx context.Context, in repository.WorkspaceProvisionInput,
) (*domain.Workspace, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	if _, exists := f.pages.workspaces[in.Slug]; exists {
		return nil, repository.ErrWorkspaceSlugTaken
	}
	f.pages.nextID++
	id := "workspace-" + strconv.Itoa(f.pages.nextID)
	ws := &domain.Workspace{ID: id, Slug: in.Slug, Name: in.Name, IsActive: true, CreatedAt: time.Now()}
	ws.UpdatedAt = ws.CreatedAt
	f.pages.workspaces[in.Slug] = ws
	// 所属（principal）と admin の grant を一緒に入れる。片方だけにすると
	// 「作ったのに入れない」ワークスペースが再現できてしまう。
	// この fake では grant を scopeRoles で表す（kbFakePerms の grant 系メソッドは
	// 権限解決の入口を事実に絞るため未実装にしてある）。
	if _, err := f.perms.EnsureUserPrincipal(ctx, id, in.OwnerUserID); err != nil {
		return nil, err
	}
	f.perms.setScopeRole(id, in.OwnerUserID, domain.GrantRoleAdmin)
	c := *ws
	return &c, nil
}

// ProvisionPrivateSpace はプライベートスペースと作成者への space_grant(admin) を
// 「まとめて」入れる（本番は 1 トランザクション）。grant を省くと、ワークスペース既定が
// 届かないスペースなので作った本人にも見えない — 本番で最も避けたい状態そのもの。
func (f *kbFakeProvisioner) ProvisionPrivateSpace(
	ctx context.Context, in repository.PrivateSpaceProvisionInput,
) (*domain.Space, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	if f.perms.userPrincipal(in.WorkspaceID, in.CreatorUserID) == nil {
		return nil, repository.ErrPrincipalNotFound
	}
	space := &domain.Space{
		WorkspaceID: in.WorkspaceID,
		Key:         in.Key,
		Name:        in.Name,
		Visibility:  domain.SpaceVisibilityPrivate,
	}
	if err := f.pages.CreateSpace(ctx, space); err != nil {
		return nil, err
	}
	f.perms.setScopeRole(space.ID, in.CreatorUserID, domain.GrantRoleAdmin)
	c := *space
	return &c, nil
}

// kbFakeComments は repository.CommentRepository の in-memory fake。
type kbFakeComments struct {
	threads     map[string]domain.CommentThread // threadID -> thread
	threadOrder []string                        // 作成順（ListCommentThreadsByPage の並びを保つ）
	comments    map[string][]domain.Comment     // threadID -> 返信（作成順）
	// existingBlocks は BlockExistsInPage が実在すると答える block_id -> それが属する pageID。
	// 錨付きスレッドの handler テストが addBlock で登録する（実 DB の blocks は持たない）。
	existingBlocks map[string]string
	nextID         int
}

var _ repository.CommentRepository = (*kbFakeComments)(nil)

func newKbFakeComments() *kbFakeComments {
	return &kbFakeComments{
		threads:        map[string]domain.CommentThread{},
		comments:       map[string][]domain.Comment{},
		existingBlocks: map[string]string{},
	}
}

func (f *kbFakeComments) newID(prefix string) string {
	f.nextID++
	return prefix + "-" + strconv.Itoa(f.nextID)
}

// addBlock は blockID が pageID に実在することにする（BlockExistsInPage 用のテスト下ごしらえ）。
func (f *kbFakeComments) addBlock(pageID, blockID string) {
	f.existingBlocks[blockID] = pageID
}

func (f *kbFakeComments) BlockExistsInPage(_ context.Context, _, pageID, blockID string) (bool, error) {
	p, ok := f.existingBlocks[blockID]
	return ok && p == pageID, nil
}

func (f *kbFakeComments) CreateCommentThread(
	_ context.Context, workspaceID, pageID string, createdByUserID uint64, anchor repository.CommentAnchor,
) (*domain.CommentThread, error) {
	now := time.Now()
	t := domain.CommentThread{
		ID:              f.newID("thread"),
		WorkspaceID:     workspaceID,
		PageID:          pageID,
		BlockID:         anchor.BlockID,
		AnchorFrom:      anchor.AnchorFrom,
		AnchorTo:        anchor.AnchorTo,
		Quote:           anchor.Quote,
		CreatedByUserID: createdByUserID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	f.threads[t.ID] = t
	f.threadOrder = append(f.threadOrder, t.ID)
	c := t
	return &c, nil
}

func (f *kbFakeComments) CreateComment(
	_ context.Context, threadID string, authorUserID uint64, body string,
) (*domain.Comment, error) {
	if _, ok := f.threads[threadID]; !ok {
		return nil, repository.ErrCommentThreadNotFound
	}
	now := time.Now()
	c := domain.Comment{
		ID:           f.newID("comment"),
		ThreadID:     threadID,
		AuthorUserID: authorUserID,
		Body:         body,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	f.comments[threadID] = append(f.comments[threadID], c)
	out := c
	return &out, nil
}

func (f *kbFakeComments) GetCommentThread(_ context.Context, workspaceID, pageID, threadID string) (*domain.CommentThread, error) {
	t, ok := f.threads[threadID]
	if !ok || t.WorkspaceID != workspaceID || t.PageID != pageID {
		return nil, repository.ErrCommentThreadNotFound
	}
	c := t
	return &c, nil
}

func (f *kbFakeComments) ListCommentThreadsByPage(_ context.Context, workspaceID, pageID string) ([]domain.CommentThread, error) {
	out := make([]domain.CommentThread, 0)
	for _, id := range f.threadOrder {
		t := f.threads[id]
		if t.WorkspaceID == workspaceID && t.PageID == pageID {
			out = append(out, t)
		}
	}
	return out, nil
}

func (f *kbFakeComments) ListCommentsByThreads(_ context.Context, threadIDs []string) ([]domain.Comment, error) {
	out := make([]domain.Comment, 0)
	for _, id := range threadIDs {
		out = append(out, f.comments[id]...)
	}
	return out, nil
}

func (f *kbFakeComments) ResolveCommentThread(
	_ context.Context, workspaceID, pageID, threadID string, resolvedByUserID uint64,
) (*domain.CommentThread, error) {
	t, ok := f.threads[threadID]
	if !ok || t.WorkspaceID != workspaceID || t.PageID != pageID {
		return nil, repository.ErrCommentThreadNotFound
	}
	now := time.Now()
	t.ResolvedAt = &now
	resolvedBy := resolvedByUserID
	t.ResolvedByUserID = &resolvedBy
	t.UpdatedAt = now
	f.threads[threadID] = t
	c := t
	return &c, nil
}

func (f *kbFakeComments) ReopenCommentThread(_ context.Context, workspaceID, pageID, threadID string) (*domain.CommentThread, error) {
	t, ok := f.threads[threadID]
	if !ok || t.WorkspaceID != workspaceID || t.PageID != pageID {
		return nil, repository.ErrCommentThreadNotFound
	}
	t.ResolvedAt = nil
	t.ResolvedByUserID = nil
	t.UpdatedAt = time.Now()
	f.threads[threadID] = t
	c := t
	return &c, nil
}

// kbFakePageVersions は repository.PageVersionRepository の in-memory fake。
//
// 10 分規則・30 日掃除の正確な判定は実 DB の結合テスト（page_version_repository_integration_test.go）
// が持つ。この fake は handler / DI 配線のテストが必要とする水準（呼ばれれば version を 1 件作る、
// ページ単位で隔離されている、無いページ／無い seq は正しく失敗する）だけを満たす。
type kbFakePageVersions struct {
	pages *kbFakePages
	// versions は "workspaceID|pageID" -> seq -> version。
	versions map[string]map[int64]domain.PageVersion
	nextSeq  map[string]int64
	failWith error
}

var _ repository.PageVersionRepository = (*kbFakePageVersions)(nil)

// newKbFakePageVersions は pages（同じ kbFixture が使うものと同一インスタンス）を共有する。
// CreateVersionIfDue の「pages 行をロックしてから」の判定を、fake でも「対象ページが
// pages に実在するか」で模すため。
func newKbFakePageVersions(pages *kbFakePages) *kbFakePageVersions {
	return &kbFakePageVersions{
		pages:    pages,
		versions: map[string]map[int64]domain.PageVersion{},
		nextSeq:  map[string]int64{},
	}
}

func kbFakeVersionKey(workspaceID, pageID string) string { return workspaceID + "|" + pageID }

func (f *kbFakePageVersions) LockPage(_ context.Context, workspaceID, pageID string) error {
	if f.failWith != nil {
		return f.failWith
	}
	p, ok := f.pages.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return repository.ErrPageNotFound
	}
	return nil
}

func (f *kbFakePageVersions) CreateVersionIfDue(
	_ context.Context, workspaceID, pageID, doc string, authorUserID uint64, note *string, _ bool,
) (bool, *domain.PageVersion, error) {
	if f.failWith != nil {
		return false, nil, f.failWith
	}
	p, ok := f.pages.pages[pageID]
	if !ok || p.WorkspaceID != workspaceID {
		return false, nil, repository.ErrPageNotFound
	}
	// この fake は間引きをしない（force の値を問わず常に 1 件作る）。10 分規則そのものの
	// 検証は本物の repository の結合テストが担う — handler / usecase レベルは
	// 「呼ばれたか」「テナント・ページで隔離されているか」だけを見れば足りる。
	key := kbFakeVersionKey(workspaceID, pageID)
	f.nextSeq[key]++
	seq := f.nextSeq[key]
	v := domain.PageVersion{
		PageID: pageID, Seq: seq, Doc: doc, AuthorUserID: authorUserID, Note: note, CreatedAt: time.Now(),
	}
	if f.versions[key] == nil {
		f.versions[key] = map[int64]domain.PageVersion{}
	}
	f.versions[key][seq] = v
	out := v
	return true, &out, nil
}

func (f *kbFakePageVersions) ListVersions(_ context.Context, workspaceID, pageID string) ([]domain.PageVersion, error) {
	rows := f.versions[kbFakeVersionKey(workspaceID, pageID)]
	out := make([]domain.PageVersion, 0, len(rows))
	for _, v := range rows {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Seq > out[j].Seq })
	return out, nil
}

func (f *kbFakePageVersions) GetVersion(_ context.Context, workspaceID, pageID string, seq int64) (*domain.PageVersion, error) {
	v, ok := f.versions[kbFakeVersionKey(workspaceID, pageID)][seq]
	if !ok {
		return nil, domain.ErrPageVersionNotFound
	}
	out := v
	return &out, nil
}

func (f *kbFakePageVersions) GetLatestVersion(_ context.Context, workspaceID, pageID string) (*domain.PageVersion, error) {
	key := kbFakeVersionKey(workspaceID, pageID)
	seq := f.nextSeq[key]
	if seq == 0 {
		return nil, nil
	}
	v, ok := f.versions[key][seq]
	if !ok {
		return nil, nil
	}
	out := v
	return &out, nil
}

// kbFakePageTemplates は repository.PageTemplateRepository の in-memory fake。
type kbFakePageTemplates struct {
	// templates は templateID -> 雛形。
	templates map[string]*domain.PageTemplate
	nextID    int
	failWith  error
}

var _ repository.PageTemplateRepository = (*kbFakePageTemplates)(nil)

func newKbFakePageTemplates() *kbFakePageTemplates {
	return &kbFakePageTemplates{templates: map[string]*domain.PageTemplate{}}
}

func (f *kbFakePageTemplates) Create(_ context.Context, tpl *domain.PageTemplate) error {
	if f.failWith != nil {
		return f.failWith
	}
	for _, existing := range f.templates {
		if existing.WorkspaceID == tpl.WorkspaceID && existing.Name == tpl.Name {
			return repository.ErrDuplicateTemplateName
		}
	}
	f.nextID++
	stored := *tpl
	stored.ID = "template-" + strconv.Itoa(f.nextID)
	stored.CreatedAt = time.Now()
	stored.UpdatedAt = stored.CreatedAt
	f.templates[stored.ID] = &stored
	*tpl = stored
	return nil
}

func (f *kbFakePageTemplates) List(_ context.Context, workspaceID string, spaceID *string) ([]domain.PageTemplate, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	out := make([]domain.PageTemplate, 0, len(f.templates))
	for _, tpl := range f.templates {
		if tpl.WorkspaceID != workspaceID {
			continue
		}
		// spaceID が nil の行（ワークスペース全体向け）は常に含める。非 nil なら、
		// 呼び出し側が指定した spaceID と一致する行も加える
		// （repository.PageTemplateRepository.List の doc と同じ規則）。
		if tpl.SpaceID == nil || (spaceID != nil && *tpl.SpaceID == *spaceID) {
			out = append(out, *tpl)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *kbFakePageTemplates) Get(_ context.Context, workspaceID, templateID string) (*domain.PageTemplate, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	tpl, ok := f.templates[templateID]
	if !ok || tpl.WorkspaceID != workspaceID {
		return nil, domain.ErrPageTemplateNotFound
	}
	out := *tpl
	return &out, nil
}

func (f *kbFakePageTemplates) Delete(_ context.Context, workspaceID, templateID string) error {
	if f.failWith != nil {
		return f.failWith
	}
	tpl, ok := f.templates[templateID]
	if !ok || tpl.WorkspaceID != workspaceID {
		return domain.ErrPageTemplateNotFound
	}
	delete(f.templates, templateID)
	return nil
}

// kbFakePageSuggestions は repository.PageSuggestionRepository の in-memory fake。
type kbFakePageSuggestions struct {
	// suggestions は suggestionID -> 提案。
	suggestions map[string]*domain.PageSuggestion
	nextID      int
	failWith    error
}

var _ repository.PageSuggestionRepository = (*kbFakePageSuggestions)(nil)

func newKbFakePageSuggestions() *kbFakePageSuggestions {
	return &kbFakePageSuggestions{suggestions: map[string]*domain.PageSuggestion{}}
}

func (f *kbFakePageSuggestions) Create(_ context.Context, s *domain.PageSuggestion) error {
	if f.failWith != nil {
		return f.failWith
	}
	f.nextID++
	stored := *s
	stored.ID = "suggestion-" + strconv.Itoa(f.nextID)
	stored.Status = domain.PageSuggestionStatusOpen
	stored.CreatedAt = time.Now()
	f.suggestions[stored.ID] = &stored
	*s = stored
	return nil
}

func (f *kbFakePageSuggestions) ListOpen(_ context.Context, workspaceID, pageID string, limit int) ([]domain.PageSuggestion, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	out := make([]domain.PageSuggestion, 0)
	for _, s := range f.suggestions {
		if s.WorkspaceID == workspaceID && s.PageID == pageID && s.Status == domain.PageSuggestionStatusOpen {
			out = append(out, *s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *kbFakePageSuggestions) CountOpen(_ context.Context, workspaceID, pageID string) (int, error) {
	if f.failWith != nil {
		return 0, f.failWith
	}
	count := 0
	for _, s := range f.suggestions {
		if s.WorkspaceID == workspaceID && s.PageID == pageID && s.Status == domain.PageSuggestionStatusOpen {
			count++
		}
	}
	return count, nil
}

func (f *kbFakePageSuggestions) CountOpenByAuthor(_ context.Context, workspaceID, pageID string, authorUserID uint64) (int, error) {
	if f.failWith != nil {
		return 0, f.failWith
	}
	count := 0
	for _, s := range f.suggestions {
		if s.WorkspaceID == workspaceID && s.PageID == pageID && s.Status == domain.PageSuggestionStatusOpen && s.AuthorUserID == authorUserID {
			count++
		}
	}
	return count, nil
}

func (f *kbFakePageSuggestions) Get(_ context.Context, workspaceID, pageID, suggestionID string) (*domain.PageSuggestion, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	s, ok := f.suggestions[suggestionID]
	if !ok || s.WorkspaceID != workspaceID || s.PageID != pageID {
		return nil, domain.ErrPageSuggestionNotFound
	}
	out := *s
	return &out, nil
}

func (f *kbFakePageSuggestions) Resolve(
	_ context.Context, workspaceID, pageID, suggestionID string,
	status domain.PageSuggestionStatus, resolverUserID uint64, resolvedAt time.Time,
) (*domain.PageSuggestion, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	s, ok := f.suggestions[suggestionID]
	if !ok || s.WorkspaceID != workspaceID || s.PageID != pageID {
		return nil, domain.ErrPageSuggestionNotFound
	}
	if s.Status != domain.PageSuggestionStatusOpen {
		return nil, domain.ErrPageSuggestionAlreadyResolved
	}
	s.Status = status
	s.ResolvedAt = &resolvedAt
	resolver := resolverUserID
	s.ResolvedByUserID = &resolver
	s.BaseSeq = nil
	out := *s
	return &out, nil
}

// kbFakePageViews は repository.PageViewRepository の fake（段2・閲覧の記録）。
type kbFakePageViews struct {
	// views は userID(文字列化) -> pageID -> viewedAt。CountViews はこの行数を数える。
	views map[string]map[string]time.Time
	// recentFor は ListMyRecentPagesUseCase 向けの候補をテストが直接差し込む場所
	// （本物の repository のような pages/spaces/workspaces との JOIN は fake では組まない）。
	recentFor map[uint64][]domain.RecentPage
	failWith  error
}

var _ repository.PageViewRepository = (*kbFakePageViews)(nil)

func newKbFakePageViews() *kbFakePageViews {
	return &kbFakePageViews{
		views:     map[string]map[string]time.Time{},
		recentFor: map[uint64][]domain.RecentPage{},
	}
}

func kbFakeViewUserKey(userID uint64) string { return strconv.FormatUint(userID, 10) }

func (f *kbFakePageViews) RecordView(_ context.Context, _ string, pageID string, userID uint64) error {
	if f.failWith != nil {
		return f.failWith
	}
	key := kbFakeViewUserKey(userID)
	if f.views[key] == nil {
		f.views[key] = map[string]time.Time{}
	}
	f.views[key][pageID] = time.Now()
	return nil
}

func (f *kbFakePageViews) CountViews(_ context.Context, pageID string) (int, error) {
	if f.failWith != nil {
		return 0, f.failWith
	}
	n := 0
	for _, m := range f.views {
		if _, ok := m[pageID]; ok {
			n++
		}
	}
	return n, nil
}

func (f *kbFakePageViews) ListRecentPageViewCandidates(_ context.Context, userID uint64) ([]domain.RecentPage, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	return f.recentFor[userID], nil
}

// kbFakePageFavorites は repository.PageFavoriteRepository の fake（段7・お気に入り）。
type kbFakePageFavorites struct {
	// favorites は userID(文字列化) -> pageID -> created_at。
	favorites map[string]map[string]time.Time
	// listFor はワークスペース単位の一覧向けにテストが直接差し込む候補
	// （本物の repository のような pages/spaces との JOIN は fake では組まない）。
	listFor  map[string][]domain.PageFavorite
	failWith error
}

var _ repository.PageFavoriteRepository = (*kbFakePageFavorites)(nil)

func newKbFakePageFavorites() *kbFakePageFavorites {
	return &kbFakePageFavorites{
		favorites: map[string]map[string]time.Time{},
		listFor:   map[string][]domain.PageFavorite{},
	}
}

func (f *kbFakePageFavorites) Add(_ context.Context, _, pageID string, userID uint64) (bool, error) {
	if f.failWith != nil {
		return false, f.failWith
	}
	key := kbFakeViewUserKey(userID)
	if f.favorites[key] == nil {
		f.favorites[key] = map[string]time.Time{}
	}
	if _, exists := f.favorites[key][pageID]; exists {
		return false, nil
	}
	f.favorites[key][pageID] = time.Now()
	return true, nil
}

func (f *kbFakePageFavorites) Remove(_ context.Context, pageID string, userID uint64) error {
	if f.failWith != nil {
		return f.failWith
	}
	delete(f.favorites[kbFakeViewUserKey(userID)], pageID)
	return nil
}

func (f *kbFakePageFavorites) IsFavorite(_ context.Context, pageID string, userID uint64) (bool, error) {
	if f.failWith != nil {
		return false, f.failWith
	}
	_, ok := f.favorites[kbFakeViewUserKey(userID)][pageID]
	return ok, nil
}

func (f *kbFakePageFavorites) ListFavorites(_ context.Context, workspaceID string, _ uint64) ([]domain.PageFavorite, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	return f.listFor[workspaceID], nil
}

// ListSpaceMembers はそのスペースに届いている権限を人に解決する（段9）。rolesAt と同じ
// 「space の scopeRole」＋「private でなければ workspace の scopeRole を継承」の規則を、
// ワークスペース内の全ユーザー主体に対して展開する（rolesAt は 1 人分・こちらは全員分）。
// 同じ強さなら space 直接（"direct"）を workspace 継承より優先する。
func (f *kbFakePerms) ListSpaceMembers(_ context.Context, workspaceID, spaceID string) ([]domain.SpaceMember, error) {
	type resolved struct {
		name string
		role domain.GrantRole
		via  string
	}
	byUser := map[uint64]resolved{}
	var order []uint64
	for _, p := range f.principals {
		if p.WorkspaceID != workspaceID || p.Kind != domain.PrincipalKindUser || p.UserID == nil {
			continue
		}
		userID := *p.UserID
		spaceRole, hasSpace := f.scopeRoles[kbScopeKey{scopeID: spaceID, userID: userID}]
		wsRole, hasWs := f.scopeRoles[kbScopeKey{scopeID: workspaceID, userID: userID}]
		if sp, ok := f.pages.spaces[spaceID]; ok && sp.Visibility == domain.SpaceVisibilityPrivate {
			hasWs = false // private スペースにはワークスペース既定を届かせない（rolesAt と同じ規則）。
		}
		var best *resolved
		if hasSpace {
			best = &resolved{role: spaceRole, via: "direct"}
		}
		if hasWs && (best == nil || wsRole.Rank() > best.role.Rank()) {
			best = &resolved{role: wsRole, via: "workspace"}
		}
		if best == nil {
			continue
		}
		best.name = f.userNames[userID]
		byUser[userID] = *best
		order = append(order, userID)
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })
	out := make([]domain.SpaceMember, 0, len(order))
	for _, uid := range order {
		r := byUser[uid]
		out = append(out, domain.SpaceMember{UserID: uid, Name: r.name, Role: r.role, Via: r.via})
	}
	return out, nil
}

// ListMySpaces は ListSpaceMembers の向きを逆にしたもの（段14。1 人→全スペース）。
// 同じ「space の scopeRole」＋「private でなければ workspace の scopeRole を継承」の
// 規則を、そのワークスペースの全スペースに対して展開する。
func (f *kbFakePerms) ListMySpaces(_ context.Context, workspaceID string, userID uint64) ([]domain.MySpace, error) {
	wsRole, hasWs := f.scopeRoles[kbScopeKey{scopeID: workspaceID, userID: userID}]
	var spaceIDs []string
	for id, sp := range f.pages.spaces {
		if sp.WorkspaceID == workspaceID {
			spaceIDs = append(spaceIDs, id)
		}
	}
	sort.Strings(spaceIDs)
	out := make([]domain.MySpace, 0, len(spaceIDs))
	for _, spaceID := range spaceIDs {
		sp := f.pages.spaces[spaceID]
		spaceRole, hasSpace := f.scopeRoles[kbScopeKey{scopeID: spaceID, userID: userID}]
		wsReaches := hasWs && sp.Visibility != domain.SpaceVisibilityPrivate
		var best *domain.GrantRole
		if hasSpace {
			best = &spaceRole
		}
		if wsReaches && (best == nil || wsRole.Rank() > best.Rank()) {
			best = &wsRole
		}
		if best == nil {
			continue
		}
		out = append(out, domain.MySpace{ID: spaceID, Name: sp.Name, Role: *best})
	}
	return out, nil
}

// kbFakeInvitations は repository.InvitationRepository の in-memory 実装。
// 本物と同じ規則（同じ宛先 × 場所の未決は 1 件・再送の間隔・宛先の照合・承諾で主体と役割ができる）
// を最小限なぞる。時刻の判定は now() で行い、テストが差し替えられる。
type kbFakeInvitations struct {
	pages  *kbFakePages
	perms  *kbFakePerms
	users  *kbFakeUsers
	rows   map[string]*domain.Invitation
	nextID int
	now    func() time.Time
	// failWith は次の呼び出しを失敗させる（500 経路の確認用）。
	failWith error
}

var _ repository.InvitationRepository = (*kbFakeInvitations)(nil)

func newKbFakeInvitations(pages *kbFakePages, perms *kbFakePerms, users *kbFakeUsers) *kbFakeInvitations {
	return &kbFakeInvitations{pages: pages, perms: perms, users: users, rows: map[string]*domain.Invitation{}, now: time.Now}
}

func (f *kbFakeInvitations) detail(inv *domain.Invitation) domain.InvitationDetail {
	d := domain.InvitationDetail{Invitation: *inv, InviterName: f.users.names[inv.InvitedByUserID]}
	for _, ws := range f.pages.workspaces {
		if ws.ID == inv.WorkspaceID {
			d.WorkspaceSlug, d.WorkspaceName = ws.Slug, ws.Name
			break
		}
	}
	return d
}

func sameTarget(a *domain.Invitation, in repository.InvitationWrite) bool {
	ptrEq := func(x, y *string) bool { return (x == nil && y == nil) || (x != nil && y != nil && *x == *y) }
	return a.WorkspaceID == in.WorkspaceID && a.Email == in.Email && a.Scope == in.Scope &&
		ptrEq(a.SpaceID, in.SpaceID) && ptrEq(a.PageID, in.PageID)
}

func (f *kbFakeInvitations) Upsert(_ context.Context, in repository.InvitationWrite) (*domain.Invitation, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	for _, row := range f.rows {
		if !row.Unresolved() || !sameTarget(row, in) {
			continue
		}
		if row.LastSentAt.After(in.SentBefore) {
			return nil, repository.ErrInvitationResendTooSoon
		}
		row.Role, row.InviteeName, row.TokenHash, row.ExpiresAt = in.Role, in.InviteeName, in.TokenHash, in.ExpiresAt
		row.LastSentAt, row.LastSentByUserID, row.SendCount, row.UpdatedAt = f.now(), in.ActorUserID, row.SendCount+1, f.now()
		copied := *row
		return &copied, nil
	}
	f.nextID++
	now := f.now()
	row := &domain.Invitation{
		ID: fmt.Sprintf("0198a000-0000-7000-8000-%012d", f.nextID), WorkspaceID: in.WorkspaceID, Scope: in.Scope,
		SpaceID: in.SpaceID, PageID: in.PageID, Role: in.Role, Email: in.Email, InviteeName: in.InviteeName,
		TokenHash: in.TokenHash, InvitedByUserID: in.ActorUserID, ExpiresAt: in.ExpiresAt,
		LastSentAt: now, LastSentByUserID: in.ActorUserID, SendCount: 1, CreatedAt: now, UpdatedAt: now,
	}
	f.rows[row.ID] = row
	copied := *row
	return &copied, nil
}

func (f *kbFakeInvitations) Refresh(_ context.Context, in repository.InvitationRefresh) (*domain.Invitation, error) {
	row, ok := f.rows[in.InvitationID]
	if !ok || row.WorkspaceID != in.WorkspaceID {
		return nil, repository.ErrInvitationNotFound
	}
	if !row.Unresolved() {
		return nil, repository.ErrInvitationNotOpen
	}
	if row.LastSentAt.After(in.SentBefore) {
		return nil, repository.ErrInvitationResendTooSoon
	}
	row.TokenHash, row.ExpiresAt = in.TokenHash, in.ExpiresAt
	row.LastSentAt, row.LastSentByUserID, row.SendCount, row.UpdatedAt = f.now(), in.ActorUserID, row.SendCount+1, f.now()
	copied := *row
	return &copied, nil
}

func (f *kbFakeInvitations) Find(_ context.Context, workspaceID, invitationID string) (*domain.Invitation, error) {
	row, ok := f.rows[invitationID]
	if !ok || row.WorkspaceID != workspaceID {
		return nil, repository.ErrInvitationNotFound
	}
	copied := *row
	return &copied, nil
}

func (f *kbFakeInvitations) FindByID(_ context.Context, invitationID string) (*domain.Invitation, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	row, ok := f.rows[invitationID]
	if !ok {
		return nil, repository.ErrInvitationNotFound
	}
	copied := *row
	return &copied, nil
}

func (f *kbFakeInvitations) FindDetailByTokenHash(_ context.Context, tokenHash []byte) (*domain.InvitationDetail, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	for _, row := range f.rows {
		if bytes.Equal(row.TokenHash, tokenHash) {
			d := f.detail(row)
			return &d, nil
		}
	}
	return nil, repository.ErrInvitationNotFound
}

func (f *kbFakeInvitations) sorted(keep func(*domain.Invitation) bool) []domain.InvitationDetail {
	out := make([]domain.InvitationDetail, 0)
	for _, row := range f.rows {
		if keep(row) {
			out = append(out, f.detail(row))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (f *kbFakeInvitations) ListByWorkspace(_ context.Context, workspaceID string, limit int) ([]domain.InvitationDetail, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	out := f.sorted(func(inv *domain.Invitation) bool { return inv.WorkspaceID == workspaceID })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *kbFakeInvitations) ListOpenByEmail(_ context.Context, email string) ([]domain.InvitationDetail, error) {
	if f.failWith != nil {
		return nil, f.failWith
	}
	now := f.now()
	return f.sorted(func(inv *domain.Invitation) bool { return inv.Email == email && inv.Open(now) }), nil
}

func (f *kbFakeInvitations) Accept(ctx context.Context, invitationID string, userID uint64, email string) (*domain.Invitation, error) {
	row, ok := f.rows[invitationID]
	if !ok || row.Email != email {
		return nil, repository.ErrInvitationNotFound
	}
	if !row.Open(f.now()) {
		return nil, repository.ErrInvitationNotOpen
	}
	if row.Scope != domain.InvitationScopeWorkspace {
		return nil, repository.ErrInvitationScopeUnsupported
	}
	principal, err := f.perms.EnsureUserPrincipal(ctx, row.WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	if err := f.perms.GrantWorkspaceRoleIfAbsent(ctx, row.WorkspaceID, principal.ID, row.Role); err != nil {
		return nil, err
	}
	at := f.now()
	row.AcceptedAt, row.AcceptedByUserID, row.UpdatedAt = &at, &userID, at
	copied := *row
	return &copied, nil
}

func (f *kbFakeInvitations) Decline(_ context.Context, invitationID string, userID uint64, email string) error {
	row, ok := f.rows[invitationID]
	if !ok || row.Email != email {
		return repository.ErrInvitationNotFound
	}
	if !row.Unresolved() {
		return repository.ErrInvitationNotOpen
	}
	at := f.now()
	row.DeclinedAt, row.DeclinedByUserID, row.UpdatedAt = &at, &userID, at
	return nil
}

func (f *kbFakeInvitations) Revoke(_ context.Context, workspaceID, invitationID string, actorUserID uint64) error {
	row, ok := f.rows[invitationID]
	if !ok || row.WorkspaceID != workspaceID {
		return repository.ErrInvitationNotFound
	}
	if row.RevokedAt != nil {
		return nil
	}
	if !row.Unresolved() {
		return repository.ErrInvitationNotOpen
	}
	at := f.now()
	row.RevokedAt, row.RevokedByUserID, row.UpdatedAt = &at, &actorUserID, at
	return nil
}

func (f *kbFakeInvitations) CountOpenInWorkspace(_ context.Context, workspaceID string) (int64, error) {
	now := f.now()
	var n int64
	for _, row := range f.rows {
		if row.WorkspaceID == workspaceID && row.Open(now) {
			n++
		}
	}
	return n, nil
}

func (f *kbFakeInvitations) CountSentBySince(_ context.Context, userID uint64, since time.Time) (int64, error) {
	var n int64
	for _, row := range f.rows {
		if row.LastSentByUserID == userID && !row.LastSentAt.Before(since) {
			n++
		}
	}
	return n, nil
}

func (f *kbFakeInvitations) CountSentToEmailSince(_ context.Context, email string, since time.Time) (int64, error) {
	var n int64
	for _, row := range f.rows {
		if row.Email == email && !row.LastSentAt.Before(since) {
			n++
		}
	}
	return n, nil
}

// kbFakeNotifications は repository.NotificationRepository の in-memory 実装（作った通知を溜めるだけ）。
type kbFakeNotifications struct {
	created []domain.Notification
}

var _ repository.NotificationRepository = (*kbFakeNotifications)(nil)

func newKbFakeNotifications() *kbFakeNotifications { return &kbFakeNotifications{} }

func (f *kbFakeNotifications) Create(_ context.Context, n *domain.Notification) error {
	f.created = append(f.created, *n)
	return nil
}

func (f *kbFakeNotifications) CreateMany(_ context.Context, ns []domain.Notification) error {
	f.created = append(f.created, ns...)
	return nil
}

func (f *kbFakeNotifications) ListByUserID(_ context.Context, userID uint64) ([]domain.Notification, error) {
	out := make([]domain.Notification, 0)
	for _, n := range f.created {
		if n.UserID == userID {
			out = append(out, n)
		}
	}
	return out, nil
}

func (f *kbFakeNotifications) MarkRead(context.Context, uint64, uint64) error { return nil }
func (f *kbFakeNotifications) MarkAllRead(context.Context, uint64) error      { return nil }
func (f *kbFakeNotifications) CountUnread(context.Context, uint64) (int64, error) {
	return 0, nil
}
