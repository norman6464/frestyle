package kb

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ResolveWorkspaceUseCase は URL の slug と現在のユーザーから、操作対象のワークスペースを決める。
// ナレッジの HTTP 経路はすべてここを通ってテナントを確定させる（workspace_id をクライアントの
// 申告のまま信じない）。
//
// 所属していない slug も存在しない slug も repository.ErrWorkspaceNotFound を返す。403 と 404 を
// 撃ち分けると、slug（短く推測しやすい文字列）の総当たりでテナントの実在が漏れるため区別を潰す。
// ワークスペースの停止判定もここに閉じる。
type ResolveWorkspaceUseCase struct {
	workspaces  repository.KnowledgeBaseRepository
	permissions repository.KnowledgeBasePermissionRepository
}

func NewResolveWorkspaceUseCase(
	w repository.KnowledgeBaseRepository,
	p repository.KnowledgeBasePermissionRepository,
) *ResolveWorkspaceUseCase {
	return &ResolveWorkspaceUseCase{workspaces: w, permissions: p}
}

type ResolveWorkspaceInput struct {
	Slug   string
	UserID uint64
}

func (u *ResolveWorkspaceUseCase) Execute(ctx context.Context, in ResolveWorkspaceInput) (*domain.Workspace, error) {
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if in.Slug == "" {
		return nil, repository.ErrWorkspaceNotFound
	}
	ws, err := u.workspaces.FindWorkspaceBySlug(ctx, in.Slug)
	if err != nil {
		return nil, err
	}
	// 停止中のワークスペースは無いものとして扱う。存在を漏らさないよう、権限が無いときと
	// 同じ「見つからない」に畳む。
	if !ws.IsActive {
		return nil, repository.ErrWorkspaceNotFound
	}
	// 所属の正本は principals（kind='user'）の行の有無。ここでは新たに所属を作らない —
	// 「URL を知っているだけで入れる」自動参加は同意なき追加の穴と同根なので持たない。
	member, err := u.permissions.IsWorkspaceMember(ctx, ws.ID, in.UserID)
	if err != nil {
		return nil, err
	}
	if !member {
		return nil, repository.ErrWorkspaceNotFound
	}
	return ws, nil
}

// DeleteWorkspaceUseCase はワークスペースを配下ごと消す。
//
// 誰が消せるかの判定は handler が CheckWorkspacePermissionUseCase で先に行う（認可は 1 か所）。
// 「会社のワークスペースは消さない」という規則だけは repository（SQL）が持つ —
// 誰であっても消してはいけないものなので、入口ではなく最も内側で守る。
type DeleteWorkspaceUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewDeleteWorkspaceUseCase(r repository.KnowledgeBaseRepository) *DeleteWorkspaceUseCase {
	return &DeleteWorkspaceUseCase{repo: r}
}

type DeleteWorkspaceInput struct {
	WorkspaceID string
}

func (u *DeleteWorkspaceUseCase) Execute(ctx context.Context, in DeleteWorkspaceInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	return u.repo.DeleteWorkspace(ctx, in.WorkspaceID)
}

// ErrInvalidWorkspaceSlug は slug が URL に出せる形（小文字英数字とハイフン）でないときに返す。
var ErrInvalidWorkspaceSlug = errors.New("invalid workspace slug")

// ErrInvalidSpaceKey は key が保存してよい形でないときに返す。
var ErrInvalidSpaceKey = errors.New("invalid space key")

// ErrInvalidSpaceVisibility は visibility が既知の値（workspace / private）でないときに返す。
var ErrInvalidSpaceVisibility = errors.New("invalid space visibility")

// ErrInvalidName は表示名が空、または列幅（200 文字）を超えるときに返す。
var ErrInvalidName = errors.New("invalid name")

// CreateWorkspaceUseCase はワークスペースを作り、作成者をその admin にする。
//
// 作れるのは認証済みユーザー全員。新規テナントは中身が空で既存のワークスペースへの
// アクセスは増えないため、アプリ内ロール（company_admin 等）で絞る必要はない
// （権限は principals / grants だけで閉じ、特権ロールで通る抜け道を持たない設計と一貫させる）。
//
// 作成者を admin にする処理は repository が 1 トランザクションで行う。「作ってから権限を
// 張る」と 2 手に分けると、片方だけ成功して誰も入れないワークスペースが残りうる。
type CreateWorkspaceUseCase struct {
	provisioner repository.WorkspaceProvisioner
}

func NewCreateWorkspaceUseCase(p repository.WorkspaceProvisioner) *CreateWorkspaceUseCase {
	return &CreateWorkspaceUseCase{provisioner: p}
}

type CreateWorkspaceInput struct {
	// Slug は空でよい。空なら自動採番する — URL に使う名前は利用者に決めさせない
	// （人が付けた名前は衝突・改名の欲求・情報の漏れを生む）。
	Slug string
	Name string
	// OwnerUserID は作成者。admin の grant を受け取る principal になる。
	OwnerUserID uint64
}

func (u *CreateWorkspaceUseCase) Execute(ctx context.Context, in CreateWorkspaceInput) (*domain.Workspace, error) {
	if in.OwnerUserID == 0 {
		return nil, errors.New("ownerUserID is required")
	}
	autoSlug := in.Slug == ""
	if autoSlug {
		in.Slug = generatedURLKey("w")
	}
	if !domain.ValidWorkspaceSlug(in.Slug) {
		return nil, ErrInvalidWorkspaceSlug
	}
	if !validDisplayName(in.Name, domain.WorkspaceNameMaxLen) {
		return nil, ErrInvalidName
	}
	for {
		w, err := u.provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug:        in.Slug,
			Name:        in.Name,
			OwnerUserID: in.OwnerUserID,
		})
		// 自動採番が衝突したら引き直す（48bit の乱数なので実際にはほぼ起きないが、
		// 起きたときに利用者へ 409 を見せる理由が無い）。人が指定した slug の 409 はそのまま返す。
		if autoSlug && errors.Is(err, repository.ErrWorkspaceSlugTaken) {
			in.Slug = generatedURLKey("w")
			continue
		}
		return w, err
	}
}

// validDisplayName は表示名が空でなく列幅（varchar(n)、バイト数でなくルーン数）に収まるかを返す。
func validDisplayName(name string, maxLen int) bool {
	return name != "" && utf8.RuneCountInString(name) <= maxLen
}

// generatedURLKey は slug / key の自動採番。UUID 先頭 12 桁（16進・48bit）を使う —
// 短い連番だと URL の識別子から作成順・総数が読めてしまう。衝突は事実上起きず、
// 万一起きても一意制約が 409 で止める。
func generatedURLKey(prefix string) string {
	id := uuid.New()
	return prefix + "-" + hex.EncodeToString(id[:6])
}

// EnsurePersonalWorkspaceUseCase は、そのユーザーの個人ワークスペースが既にあれば返し、
// 無ければ作って返す。一意性は DB（uq_workspaces_personal_owner）が守るので、作成が
// repository.ErrPersonalWorkspaceAlreadyExists で競合したら引き直す（check-then-act ではない）。
type EnsurePersonalWorkspaceUseCase struct {
	workspaces  repository.KnowledgeBaseRepository
	provisioner repository.WorkspaceProvisioner
}

func NewEnsurePersonalWorkspaceUseCase(
	w repository.KnowledgeBaseRepository, p repository.WorkspaceProvisioner,
) *EnsurePersonalWorkspaceUseCase {
	return &EnsurePersonalWorkspaceUseCase{workspaces: w, provisioner: p}
}

type EnsurePersonalWorkspaceInput struct {
	UserID uint64
	// Name は新規作成のときだけ使う表示名。既にあるときは無視する（利用者の改名を上書きしない）。
	Name string
}

func (u *EnsurePersonalWorkspaceUseCase) Execute(
	ctx context.Context, in EnsurePersonalWorkspaceInput,
) (*domain.Workspace, error) {
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}

	// 大半のログインはここで終わる — 1 回の SELECT。
	if ws, err := u.workspaces.FindPersonalWorkspaceByOwner(ctx, in.UserID); err == nil {
		return ws, nil
	} else if !errors.Is(err, repository.ErrWorkspaceNotFound) {
		return nil, fmt.Errorf("find personal workspace: %w", err)
	}

	slug := generatedURLKey("w")
	ownerID := in.UserID
	for {
		created, err := u.provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug:                slug,
			Name:                in.Name,
			OwnerUserID:         in.UserID,
			PersonalOwnerUserID: &ownerID,
		})
		switch {
		case err == nil:
			return created, nil
		case errors.Is(err, repository.ErrWorkspaceSlugTaken):
			// 自動採番の衝突（ほぼ起きない）。引き直す。
			slug = generatedURLKey("w")
			continue
		case errors.Is(err, repository.ErrPersonalWorkspaceAlreadyExists):
			// この判定から INSERT までの間に別のリクエストが先に作り終えていた。
			// 失敗として扱わず、その 1 つを引いて返す。
			ws, findErr := u.workspaces.FindPersonalWorkspaceByOwner(ctx, in.UserID)
			if findErr != nil {
				return nil, fmt.Errorf("find personal workspace after race: %w", findErr)
			}
			return ws, nil
		default:
			return nil, fmt.Errorf("provision personal workspace: %w", err)
		}
	}
}

// InviteWorkspaceMemberUseCase はユーザーをワークスペースへ招待する。
// 実際の所属（principal・権限）は招待された本人が受諾するまで発生しない
// （AcceptWorkspaceInvitationUseCase 参照）。
type InviteWorkspaceMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewInviteWorkspaceMemberUseCase(r repository.KnowledgeBasePermissionRepository) *InviteWorkspaceMemberUseCase {
	return &InviteWorkspaceMemberUseCase{repo: r}
}

type InviteWorkspaceMemberInput struct {
	WorkspaceID     string
	UserID          uint64
	InvitedByUserID uint64
}

func (u *InviteWorkspaceMemberUseCase) Execute(ctx context.Context, in InviteWorkspaceMemberInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return errors.New("userID is required")
	}
	if in.InvitedByUserID == 0 {
		return errors.New("invitedByUserID is required")
	}
	return u.repo.InviteWorkspaceMember(ctx, in.WorkspaceID, in.UserID, in.InvitedByUserID)
}

// AcceptWorkspaceInvitationUseCase は自分宛の招待を受諾する。
// invited → active に進め、principal（kind='user'）を作って既定の editor を与える。
type AcceptWorkspaceInvitationUseCase struct {
	workspaces repository.KnowledgeBaseRepository
	repo       repository.KnowledgeBasePermissionRepository
}

func NewAcceptWorkspaceInvitationUseCase(
	w repository.KnowledgeBaseRepository, r repository.KnowledgeBasePermissionRepository,
) *AcceptWorkspaceInvitationUseCase {
	return &AcceptWorkspaceInvitationUseCase{workspaces: w, repo: r}
}

type AcceptWorkspaceInvitationInput struct {
	// WorkspaceSlug は招待一覧（ListMyWorkspaceInvitationsUseCase）が返す slug。
	WorkspaceSlug string
	UserID        uint64
}

func (u *AcceptWorkspaceInvitationUseCase) Execute(ctx context.Context, in AcceptWorkspaceInvitationInput) (*domain.Workspace, error) {
	if in.WorkspaceSlug == "" {
		return nil, repository.ErrWorkspaceNotFound
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	// 受諾はまだ非メンバーの本人が呼ぶので、所属済みしか通さない middleware は使えず、
	// slug の解決はここで直接行う。
	ws, err := u.workspaces.FindWorkspaceBySlug(ctx, in.WorkspaceSlug)
	if err != nil {
		return nil, err
	}
	if !ws.IsActive {
		return nil, repository.ErrWorkspaceNotFound
	}
	if _, err := u.repo.AcceptWorkspaceInvitation(ctx, ws.ID, in.UserID); err != nil {
		return nil, err
	}
	return ws, nil
}

// DeclineWorkspaceInvitationUseCase は自分宛の招待を辞退する（invited → left）。
type DeclineWorkspaceInvitationUseCase struct {
	workspaces repository.KnowledgeBaseRepository
	repo       repository.KnowledgeBasePermissionRepository
}

func NewDeclineWorkspaceInvitationUseCase(
	w repository.KnowledgeBaseRepository, r repository.KnowledgeBasePermissionRepository,
) *DeclineWorkspaceInvitationUseCase {
	return &DeclineWorkspaceInvitationUseCase{workspaces: w, repo: r}
}

type DeclineWorkspaceInvitationInput struct {
	WorkspaceSlug string
	UserID        uint64
}

func (u *DeclineWorkspaceInvitationUseCase) Execute(ctx context.Context, in DeclineWorkspaceInvitationInput) error {
	if in.WorkspaceSlug == "" {
		return repository.ErrWorkspaceNotFound
	}
	if in.UserID == 0 {
		return errors.New("userID is required")
	}
	ws, err := u.workspaces.FindWorkspaceBySlug(ctx, in.WorkspaceSlug)
	if err != nil {
		return err
	}
	return u.repo.DeclineWorkspaceInvitation(ctx, ws.ID, in.UserID)
}

// ListMyWorkspaceInvitationsUseCase は自分宛の未受諾の招待を返す。
type ListMyWorkspaceInvitationsUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListMyWorkspaceInvitationsUseCase(r repository.KnowledgeBasePermissionRepository) *ListMyWorkspaceInvitationsUseCase {
	return &ListMyWorkspaceInvitationsUseCase{repo: r}
}

func (u *ListMyWorkspaceInvitationsUseCase) Execute(ctx context.Context, userID uint64) ([]domain.WorkspaceInvitation, error) {
	if userID == 0 {
		return nil, errors.New("userID is required")
	}
	return u.repo.ListMyWorkspaceInvitations(ctx, userID)
}
