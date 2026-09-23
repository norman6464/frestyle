package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrPrincipalNotFound は対象の主体が存在しない（または別ワークスペースのもの）ときに返す。
var ErrPrincipalNotFound = errors.New("principal not found")

// ErrUserNotFound は主体を作ろうとしたユーザーが users に存在しないときに返す
// （principals.user_id の FK 違反をそのまま流すと入力の誤りが 500 になり、DB 障害と
// 区別できず再試行すべきと誤解される）。
var ErrUserNotFound = errors.New("user not found")

// ErrLastWorkspaceAdmin は「ユーザーの admin が 1 人も残らなくなる操作」を断ったときに返す
// （0 人になると誰も権限を復旧できずDBを直接触るしかなくなる）。このセンチネルは
// repository が返す — 手前の usecase（CanRemoveWorkspaceAdminUseCase）は操作前に読むだけで
// 競合を防げないため、最後の砦は書き込みと同じトランザクションで判定するこちら側にある。
var ErrLastWorkspaceAdmin = errors.New("last workspace admin cannot be removed")

// ErrPrincipalGroupNameTaken はグループ名が同じワークスペースで使用済みのときに返す。
// 名前はワークスペース内で一意（uq_principals_group_name）で、同名が 2 つあると
// 権限を張る先を人が選べなくなる。
var ErrPrincipalGroupNameTaken = errors.New("principal group name is already taken")

// PageWithViewFacts は 1 ページと、そのページを閲覧できるかを決める事実の組。
// ListSpacePageViewFacts が返す（ふるい落としは domain.ResolvePageView が行う）。
type PageWithViewFacts struct {
	Page domain.Page
	// Role は届いた中で最も強い役割。grant が 1 つも無ければ nil。
	Role *domain.GrantRole
	// ParentArchived は親がアーカイブ済みかという**事実**（判断ではない）。
	// 「復帰できるか」の規則は UnarchivePageUseCase が持つ。
	ParentArchived bool
}

// PageWithPermissionFacts は 1 ページの ID と、その実効権限を決める事実の組。
// ListSubtreePagePermissionFacts が返す（判定は domain.ResolvePagePermission が行う）。
// 閲覧専用の PageWithViewFacts と分かれているのは、こちらが所属（Member）も集めるため。
type PageWithPermissionFacts struct {
	PageID string
	Facts  domain.PagePermissionFacts
}

// PageSearchViewFact は検索結果 1 件（PageWithViewFacts）と、その本文一致の材料の組。
// SearchWorkspacePageViewFacts が返す（本文検索と逆リンク）。
type PageSearchViewFact struct {
	PageWithViewFacts
	// Body はそのページの page_search.body。まだ同期されていないページでは空文字
	// （NULL ではない。LEFT JOIN + COALESCE で SQL 側が空文字に倒す）。抜粋の計算は
	// usecase 側（SearchViewablePagesUseCase）が Query と突き合わせて行う。
	Body string
}

// SpaceWithScopeFacts は 1 スペースと、その入れ物に対する実効権限を決める事実の組。
// ListWorkspaceSpaceScopeFacts が返す（判定は domain.ResolveScopePermission が行う）。
// ここにあるのはワークスペース / スペースの grants で届いた役割だけで、ページ付与
// （page_grants）は含まない。
type SpaceWithScopeFacts struct {
	Space domain.Space
	Facts domain.ScopeFacts
}

// KnowledgeBasePermissionRepository はナレッジの権限モデル（principals /
// principal_members / workspace_grants / space_grants / page_grants）への
// アクセスを提供する（share_links は [ShareLinkRepository] が持つ）。
// KnowledgeBaseRepository（ページとブロック）と分けているのは、権限を張る操作とページを
// 書く操作が同じトランザクションに入らないため（境界を書き込み単位で決めている）。
type KnowledgeBasePermissionRepository interface {
	// EnsureUserPrincipal はユーザーの主体を作る（既にあればそれを返す）。
	// この行があること自体がワークスペース所属を意味する。
	EnsureUserPrincipal(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error)
	// EnsureSpaceEveryonePrincipal はスペースの「全員」を表す主体を作る（既にあればそれを返す）。
	EnsureSpaceEveryonePrincipal(ctx context.Context, workspaceID, spaceID string) (*domain.Principal, error)
	// CreateGroupPrincipal はグループの主体を作る。名前はワークスペース内で一意。
	CreateGroupPrincipal(ctx context.Context, workspaceID, name string) (*domain.Principal, error)
	// FindPrincipal は主体を 1 件引く。無い・別ワークスペースなら ErrPrincipalNotFound。
	FindPrincipal(ctx context.Context, workspaceID, principalID string) (*domain.Principal, error)
	// FindUserPrincipal はユーザーの主体を引く。無ければ ErrPrincipalNotFound（= 非メンバー）。
	FindUserPrincipal(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error)
	// DeletePrincipal は主体を消す。紐づく grant / グループ所属も FK の CASCADE で消える
	// （対象が無ければ ErrPrincipalNotFound）。ユーザーの admin が 0 人になるなら
	// ErrLastWorkspaceAdmin を返して何も消さない（判定・ロック・削除は同じトランザクション）。
	DeletePrincipal(ctx context.Context, workspaceID, principalID string) error
	// IsWorkspaceMember はユーザーがワークスペースのメンバーかを返す。
	IsWorkspaceMember(ctx context.Context, workspaceID string, userID uint64) (bool, error)
	// IsWorkspaceMemberBulk は IsWorkspaceMember の複数人版。userIDs のうち実際に
	// メンバーである ID の集合を 1 回の問い合わせで返す（呼び出し元の個数だけ
	// 逐次 SELECT を発行しない。@メンション通知の宛先解決が本来の用途）。
	// userIDs が空なら問い合わせずに空集合を返す。
	IsWorkspaceMemberBulk(ctx context.Context, workspaceID string, userIDs []uint64) (map[uint64]bool, error)
	// ListMemberWorkspaces はそのユーザーが所属するワークスペースと、そこでの CanManage を
	// 返す（slug 順）。ナレッジで唯一テナントを跨いで読むメソッド（どのテナントに入れるかを
	// 答える口）で、絞り込みは user_id だけが行う。
	ListMemberWorkspaces(ctx context.Context, userID uint64) ([]domain.MemberWorkspace, error)

	// LeaveWorkspaceMembership は所属を終える（status を left にし、principal があれば
	// 削除する。削除は「最後の admin」検査を同じトランザクションで通す）。既に非メンバーなら
	// 何もしない（冪等）。actorUserID は userID と同じなら本人の退会、違えば admin による
	// 除名として記録する。
	LeaveWorkspaceMembership(ctx context.Context, workspaceID string, userID, actorUserID uint64) error

	// AddGroupMember はグループに主体を所属させる（冪等）。member 側は kind='user' でなければ
	// DB の複合 FK が弾く（グループの入れ子を作らせない）。
	AddGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error
	// RemoveGroupMember はグループから主体を外す。存在しなければ何もしない（冪等）。
	RemoveGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error

	// UpsertWorkspaceGrant はワークスペース全体での既定の役割を与える（同じ主体には 1 行だけ）。
	// admin から他の役割へ落とすことでユーザーの admin が 0 人になるなら ErrLastWorkspaceAdmin
	// を返して何も書かない。actorUserID は監査用（principal が人なら
	// MembershipEventRoleChanged を同じトランザクションで記録する）。
	UpsertWorkspaceGrant(ctx context.Context, workspaceID, principalID string, role domain.GrantRole, actorUserID uint64) (*domain.WorkspaceGrant, error)
	// GrantWorkspaceRoleIfAbsent は既定の役割を**無いときだけ**与える（既存の行は触らない）。
	// メンバー追加の既定 editor 用。上書きの Upsert だと、冪等な追加のやり直しで
	// admin が editor に落ちてしまう。
	GrantWorkspaceRoleIfAbsent(ctx context.Context, workspaceID, principalID string, role domain.GrantRole) error
	// DeleteWorkspaceGrant はワークスペース全体での既定の役割を剥がす（冪等）。
	// これでユーザーの admin が 0 人になるなら ErrLastWorkspaceAdmin を返して何も書かない。
	// actorUserID は UpsertWorkspaceGrant と同じ理由（監査用）。
	DeleteWorkspaceGrant(ctx context.Context, workspaceID, principalID string, actorUserID uint64) error
	// ListWorkspaceGrants はワークスペースの grant 一覧を返す。
	ListWorkspaceGrants(ctx context.Context, workspaceID string) ([]domain.WorkspaceGrant, error)

	// UpsertSpaceGrant はスペースでの既定の役割を与える（同じ主体には 1 行だけ）。
	UpsertSpaceGrant(ctx context.Context, workspaceID, spaceID, principalID string, role domain.GrantRole) (*domain.SpaceGrant, error)
	// DeleteSpaceGrant はスペースでの既定の役割を剥がす（冪等）。
	DeleteSpaceGrant(ctx context.Context, workspaceID, spaceID, principalID string) error
	// ListSpaceGrants はスペースの grant 一覧を返す。
	ListSpaceGrants(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceGrant, error)

	// UpsertPageGrant はページでの既定の役割を与える（同じ主体には 1 行だけ。workspace / space
	// に続く 3 段目で、このページとその子孫に効く）。**これで誰かを弱めることはできない**
	// （最も強い役割が実効になる。狭めたい内容は private のスペースへ置く）。
	UpsertPageGrant(ctx context.Context, workspaceID, pageID, principalID string, role domain.GrantRole) (*domain.PageGrant, error)
	// DeletePageGrant はページでの既定の役割を剥がす（冪等）。
	// 上位の段で得ている役割はそのまま残る（消えるのはこの段で足した分だけ）。
	DeletePageGrant(ctx context.Context, workspaceID, pageID, principalID string) error
	// ListGrantablePrincipals は権限を張れる相手を表示名・アイコンつきで返す
	// （kind → 名前 → id 順）。share_link は含まない（人が選んで役割を与える相手ではない）。
	// 人（kind=user）はアカウント・所属がどちらも有効なものだけを返す（停止・退会した
	// ユーザーは共有候補に出さない）。group / space_all はこの絞り込みの対象外。
	ListGrantablePrincipals(ctx context.Context, workspaceID string) ([]domain.GrantablePrincipal, error)
	// ListWorkspaceMembers はワークスペースに属する人を表示名・アイコンつきで返す
	// （名前 → id 順）。ListGrantablePrincipals と違い人でない主体は含まない。
	// 担当の表示名と発言での名指しに使う。
	ListWorkspaceMembers(ctx context.Context, workspaceID string) ([]domain.WorkspaceMember, error)
	// ListWorkspaceMembersForAdmin はメンバー管理画面向け。ListWorkspaceMembers と違い、
	// 停止中のアカウントも含み、現在のワークスペース全体の役割も一緒に返す。
	ListWorkspaceMembersForAdmin(ctx context.Context, workspaceID string) ([]domain.AdminWorkspaceMember, error)
	// ListSpaceMembers はそのスペースに届いている権限を人に解決して返す。同じ人に複数の
	// 経路があれば最も強い役割で 1 行にまとめる（domain.SpaceMember.Via 参照）。
	ListSpaceMembers(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceMember, error)
	// ListMySpaces は ListSpaceMembers の向きを逆にしたもの（GET /me/spaces 用）:
	// 「1 スペース→全員」ではなく「1 人→全スペース」を、最も強い役割で 1 行にまとめて返す。
	ListMySpaces(ctx context.Context, workspaceID string, userID uint64) ([]domain.MySpace, error)
	// ListPageGrants はそのページ自身に張られた grant の一覧を返す（継承分は含まない）。
	// **これは「このページを見られる人の一覧」ではない。** 空で返っても
	// 「この段では何も足していない」の意味。
	ListPageGrants(ctx context.Context, workspaceID, pageID string) ([]domain.PageGrant, error)

	// ListMembershipEvents は所属・権限の変更履歴を新しい順で返す（監査用）。
	ListMembershipEvents(ctx context.Context, workspaceID string) ([]domain.MembershipEvent, error)
	// RecordMembershipEvent は所属・権限の変更 1 件を追記する。専用メソッドが対象の書き込みと
	// 同じトランザクションで自動的に記録するのに対し、こちらは対象の書き込みがこの
	// repository の外にある場合向けの汎用口。呼び出し側が同じトランザクションにまとめること。
	RecordMembershipEvent(
		ctx context.Context, workspaceID string, targetUserID, actorUserID uint64,
		action domain.MembershipEventAction, oldLabel, newLabel *string,
	) error

	// PagePermissionFactsForUser はログイン済みユーザーとして、1 ページの実効権限を決める
	// 事実を 1 回のクエリで集める。判定は domain.ResolvePagePermission が行う。
	// ページが無い・別ワークスペースなら ErrPageNotFound。
	PagePermissionFactsForUser(ctx context.Context, workspaceID, pageID string, userID uint64) (*domain.PagePermissionFacts, error)
	// PagePermissionFactsForPrincipal は共有リンクの来訪者（kind='share_link' の主体）として
	// 同じ事実を集める。既定（リンクの capability）は呼び出し側が facts に載せる。
	PagePermissionFactsForPrincipal(ctx context.Context, workspaceID, pageID, principalID string) (*domain.PagePermissionFacts, error)
	// ListSpacePageViewFacts はスペース配下のページ全件と、その閲覧の事実を
	// archived で現役／アーカイブ済みを切り替える（false で現役）。アーカイブ用に
	// 別のクエリを持たないのは、権限の事実を組み立てる部分を写経しないため
	// （同じ判断が 2 箇所にあると必ずずれる）。
	// 1 回のクエリで返す（ページごとに問い合わせない）。編集の事実は集めないので、
	// 編集可否をここから出さないこと（返す型がそれを表している）。
	ListSpacePageViewFacts(ctx context.Context, workspaceID, spaceID string, userID uint64, archived bool) ([]PageWithViewFacts, error)
	// SearchWorkspacePageViewFacts はワークスペース全体から題名または本文が部分一致する
	// 現役ページを候補にし、その閲覧の事実を返す（本文検索対応。判定は呼び出し側が
	// domain.ResolvePageView で行う）。query はエスケープ前の生の文字列を渡す
	// （% _ \ のエスケープは実装側が行う）。ParentArchived は常に false。
	SearchWorkspacePageViewFacts(ctx context.Context, workspaceID string, userID uint64, query string) ([]PageSearchViewFact, error)
	// ListPageLinkSourcePageViewFacts は targetPageID を参照している「参照元ページ」全件と、
	// その閲覧の事実を返す（逆リンク用）。アーカイブ済みの参照元も候補から外さない。
	ListPageLinkSourcePageViewFacts(ctx context.Context, workspaceID string, viewerUserID uint64, targetPageID string) ([]PageWithViewFacts, error)
	// ListPageTicketLinkSourcePageViewFacts は ListPageLinkSourcePageViewFacts のチケット版。
	// targetTicketID を埋め込んでいる「参照元ページ」全件と、その閲覧の事実を返す。
	ListPageTicketLinkSourcePageViewFacts(ctx context.Context, workspaceID string, viewerUserID uint64, targetTicketID string) ([]PageWithViewFacts, error)
	// ListWorkspacePageViewFactsByIDs は指定 ID 群のページの閲覧の事実を返す（ページ参照の
	// 題名解決とパンくずが使う）。UUID として読めない ID・他ワークスペースの ID は行に
	// ならない（エラーにしない）。**アーカイブ済みも行として返す** — 除外するかは用途で違う
	// ため呼び出し側が決める（題名解決は除外、パンくずは含める）。ParentArchived は常に false。
	ListWorkspacePageViewFactsByIDs(ctx context.Context, workspaceID string, userID uint64, pageIDs []string) ([]PageWithViewFacts, error)
	// SpacePermissionFactsForUser はページを介さず、スペース 1 つの実効権限を決める事実を集める
	// （スペースが無い・別ワークスペースなら ErrSpaceNotFound）。ページ付与（page_grants）は
	// 見ない。したがって**この口の答えをページの編集可否に使ってはいけない**
	// （祖先のページに張られた付与を取りこぼし、必ず狭い側へ倒れる）。
	// スペースの実在を確かめるのは、確かめないと workspace_grants 経由で他テナントの
	// スペースに対しても役割を返してしまう（fail-open になる）ため。
	SpacePermissionFactsForUser(ctx context.Context, workspaceID, spaceID string, userID uint64) (*domain.ScopeFacts, error)

	// WorkspacePermissionFactsForUser はワークスペースそのものに対する実効権限を決める事実を
	// 集める（どのスペースにも属さない判定に使う）。実在を確かめないのは、無ければ grant も
	// 0 行で「何もできない」に自然と倒れる（fail-closed）ため。
	WorkspacePermissionFactsForUser(ctx context.Context, workspaceID string, userID uint64) (*domain.ScopeFacts, error)
	// ListWorkspaceSpaceScopeFacts はワークスペース配下のスペース全件と、それぞれで
	// 呼び出し元に届いている役割を 1 回のクエリで返す。**返り値はまだ「見せてよいスペース」
	// ではない**（役割が 0 のスペースも含む。ふるい落としは呼び出し側が行う）。スペースごとに
	// SpacePermissionFactsForUser を呼ぶ N+1 は避ける。ワークスペースの実在は確かめない。
	ListWorkspaceSpaceScopeFacts(ctx context.Context, workspaceID string, userID uint64) ([]SpaceWithScopeFacts, error)
	// ListSubtreePagePermissionFacts はサブツリー（対象ページ自身 + 全子孫）の各ページと、
	// その実効権限を決める事実を 1 回のクエリで返す（アーカイブ済みも含む）。ページとその
	// 子孫をまとめて書き換える操作が根 1 枚の権限だけで通らないようにするための口。
	ListSubtreePagePermissionFacts(ctx context.Context, workspaceID, pageID string, userID uint64) ([]PageWithPermissionFacts, error)
}
