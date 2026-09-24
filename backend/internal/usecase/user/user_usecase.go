package user

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// GetCurrentUserUseCase は OIDC の subject から現在のユーザー情報を引く。
type GetCurrentUserUseCase struct {
	users repository.UserRepository
}

func NewGetCurrentUserUseCase(users repository.UserRepository) *GetCurrentUserUseCase {
	return &GetCurrentUserUseCase{users: users}
}

func (u *GetCurrentUserUseCase) Execute(ctx context.Context, subject string) (*domain.User, error) {
	return u.users.FindByOidcSubject(ctx, subject)
}

// LookupUserDisplayUseCase はユーザー ID から、人を表示するのに要る最小限
// （表示名・アイコン・状態メッセージ）を引く。チケットの作成者・変更履歴の実行者・
// 発言の投稿者・ページの最終編集者、どの画面もこれを解決の単位にする。usecase サブパッケージ
// 同士は import しない規約のため、kb / ticket / comment のどこからも import されない
// 中立の置き場所として user に置く（handler 層が各パッケージの usecase と並べて直接保持する）。
type LookupUserDisplayUseCase struct {
	users repository.UserRepository
}

func NewLookupUserDisplayUseCase(users repository.UserRepository) *LookupUserDisplayUseCase {
	return &LookupUserDisplayUseCase{users: users}
}

// Execute は表示情報を返す。見つからなければ (nil, nil) —「最終編集者」のような付随情報の
// ために本体の応答自体を失敗にはせず、判断は handler に委ねる。
func (u *LookupUserDisplayUseCase) Execute(ctx context.Context, userID uint64) (*domain.UserDisplay, error) {
	return u.users.FindDisplayByID(ctx, userID)
}

// UpsertUserFromIDTokenInput はIDトークンから取得したユーザー情報を表す。
type UpsertUserFromIDTokenInput struct {
	Subject string
	Email   string
	Name    string
	// EmailVerified は id_token の email_verified クレーム。false なら Email を「無い」ものとして
	// 扱う（同一性は Subject だけで決める）。未検証のメールでのサインアップを許すと、検証して
	// いない相手が他人のアドレスを先取りでき、それが users.email の一意索引に載って本当の
	// 持ち主が以後登録できなくなるため。
	EmailVerified bool
}

// UpsertUserFromIDTokenUseCase は認証済みユーザーの作成・更新を行う。
type UpsertUserFromIDTokenUseCase struct {
	users          repository.UserRepository
	oidcIdentities repository.UserOidcIdentityRepository
	txManager      repository.TxManager
}

func NewUpsertUserFromIDTokenUseCase(
	users repository.UserRepository,
	oidcIdentities repository.UserOidcIdentityRepository,
	txManager repository.TxManager,
) *UpsertUserFromIDTokenUseCase {
	return &UpsertUserFromIDTokenUseCase{
		users:          users,
		oidcIdentities: oidcIdentities,
		txManager:      txManager,
	}
}

func (u *UpsertUserFromIDTokenUseCase) shouldBackfillName(
	oidcName string,
	existing *domain.User,
) bool {
	return oidcName != "" &&
		existing != nil &&
		existing.Email != "" &&
		existing.Name == existing.Email
}

// Execute はユーザー情報を基にユーザーを作成・更新し、解決した user を返す。
// 同じ email での同時サインアップ競合は nil, repository.ErrEmailTaken を返す。
func (u *UpsertUserFromIDTokenUseCase) Execute(
	ctx context.Context,
	in UpsertUserFromIDTokenInput,
) (user *domain.User, err error) {
	if u.users == nil {
		return nil, errors.New("user repository not configured")
	}

	sub := in.Subject
	if sub == "" {
		return nil, errors.New("id_token missing sub")
	}

	// email はここで 1 度だけ正規形へ畳み、以後すべてこの値を使う。生の claim 値のまま保存すると
	// DB の一意索引（畳まない byte 一致）と同一性の定義がずれ、同じアドレスの行が複数作れてしまう。
	// 検証していないアドレスは畳む前に「無い」ものとして扱う（EmailVerified の doc 参照）。
	// 同一性は Subject だけで決まるので作成・照会は壊れない（uq_users_email_active は
	// email が空文字の行を対象外にしている）。
	email := ""
	if in.EmailVerified {
		email = domain.NormalizeEmail(in.Email)
	}
	oidcName := in.Name

	existing, findErr := u.users.FindByOidcSubject(ctx, sub)
	if findErr != nil {
		return nil, fmt.Errorf(
			"find user by oidc subject: %w",
			findErr,
		)
	}

	if existing != nil {
		if u.shouldBackfillName(oidcName, existing) {
			if err := u.users.UpdateName(ctx, existing.ID, oidcName); err != nil {
				return nil, fmt.Errorf("update existing user name: %w", err)
			}
			existing.Name = oidcName
		}
		// 検証済みのアドレスを、それまで持っていなかった相手へ後から付ける（サインアップ時点で
		// 未検証だった相手が、後日確認リンクを踏んでから再ログインしてきた経路）。既に別の
		// アクティブユーザーがそのアドレスを使っていれば ErrEmailTaken だが、ログイン自体は
		// 成立させる（非致命扱い）。
		if email != "" && existing.Email == "" {
			if err := u.users.UpdateEmail(ctx, existing.ID, email); err != nil {
				if errors.Is(err, repository.ErrEmailTaken) {
					slog.WarnContext(ctx, "backfill verified email skipped: already used by another active user (non-fatal)", "userID", existing.ID)
				} else {
					slog.WarnContext(ctx, "backfill verified email failed (non-fatal)", "userID", existing.ID, "err", err)
				}
			} else {
				existing.Email = email
			}
		}
		// user_oidc_identities への冪等な保険。この時点で通常は既に存在するが、念のため保証する
		// （失敗してもログイン自体は成立しているため致命扱いにしない）。
		if err := u.oidcIdentities.EnsureIdentity(ctx, existing.ID, domain.OidcProviderDefault, sub); err != nil {
			slog.WarnContext(ctx, "ensure oidc identity failed (self-heal, non-fatal)", "userID", existing.ID, "err", err)
		}
		return existing, nil
	}

	name := email
	if oidcName != "" {
		name = oidcName
	}

	user = &domain.User{
		Email: email,
		Name:  name,
	}

	// users 行と OIDC identity は不可分に作る。identity 側が競合などで失敗すれば
	// トランザクションごと巻き戻り、users 行だけが残る（ログイン不能な孤児）状態を作らない。
	if err := u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := u.users.Create(ctx, user); err != nil {
			return err
		}
		return u.oidcIdentities.EnsureIdentity(ctx, user.ID, domain.OidcProviderDefault, sub)
	}); err != nil {
		if errors.Is(err, repository.ErrEmailTaken) {
			// 同じ email で同時にサインアップが競合し、別の sub で先に確定していた。
			// 呼び出し元が区別できるよう ErrEmailTaken をそのまま返す。ログに生の
			// subject / email は書かない（保管先が DB より読める人が広いことがある）。
			slog.WarnContext(ctx, "signup rejected: email already taken by a concurrent signup")
			return nil, repository.ErrEmailTaken
		}
		return nil, fmt.Errorf("create user with oidc identity: %w", err)
	}

	// 生の subject / email ではなく確定した内部 user.ID だけを記録する。
	slog.InfoContext(ctx, "self signup: created a new user", "userID", user.ID)

	return user, nil
}

// membershipRepository は repository.KnowledgeBasePermissionRepository のうち、この
// ファイルの usecase が実際に使う 4 メソッドだけを切り出したもの。呼び出し側はフル実装を
// そのまま渡せる（Go の構造的部分型付け）。狙いはテスト容易性 — 50 以上あるフル interface を
// 丸ごと mock せずに済む。
type membershipRepository interface {
	IsWorkspaceMember(ctx context.Context, workspaceID string, userID uint64) (bool, error)
	ListMemberWorkspaces(ctx context.Context, userID uint64) ([]repository.WorkspaceWithScopeFacts, error)
	LeaveWorkspaceMembership(ctx context.Context, workspaceID string, userID, actorUserID uint64) error
	RecordMembershipEvent(
		ctx context.Context, workspaceID string, targetUserID, actorUserID uint64,
		action domain.MembershipEventAction, oldLabel, newLabel *string,
	) error
}

// ErrCannotSuspendSelf は自分自身を停止しようとしたときに返す。停止した瞬間に
// middleware.CurrentUser が以後のリクエストを弾くため、自分で自分を復帰させる手段が
// 無くなる（他に admin が居ない限り誰も戻せない）。
var ErrCannotSuspendSelf = errors.New("cannot suspend yourself")

// ErrTargetNotWorkspaceMember は対象がそのワークスペースのメンバーでないときに返す。
// users.status はワークスペースをまたぐグローバルな値だが、実行できるのは「対象が現に
// 所属するワークスペースの admin」だけに絞る。ここを緩めて任意のユーザー ID を受け付けると、
// 誰でも自分のワークスペースを作って admin になるだけで無関係な他人を停止できてしまう。
var ErrTargetNotWorkspaceMember = errors.New("target user is not a member of this workspace")

// SetUserActiveUseCase はユーザーアカウントを停止・復帰する。
// users.status はグローバルな値で、効果は対象の全ワークスペースでのログイン不可に及ぶ。
// それでも実行を「対象が現に所属するワークスペースの admin」に限るのは
// ErrTargetNotWorkspaceMember の権限昇格を防ぐため — 呼び出し元（handler）は WorkspaceID の
// admin であることを確認したうえでこれを呼ぶこと。
type SetUserActiveUseCase struct {
	users     repository.UserRepository
	perm      membershipRepository
	txManager repository.TxManager
}

func NewSetUserActiveUseCase(
	users repository.UserRepository,
	perm membershipRepository,
	txManager repository.TxManager,
) *SetUserActiveUseCase {
	return &SetUserActiveUseCase{users: users, perm: perm, txManager: txManager}
}

// SetUserActiveInput の WorkspaceID は実行の起点になったワークスペース。「対象がそのメンバーか」
// の判定対象であり、監査記録の workspace_id にもなる。
type SetUserActiveInput struct {
	WorkspaceID  string
	TargetUserID uint64
	ActorUserID  uint64
	// Active を false にすると停止、true にすると復帰。
	Active bool
}

func (u *SetUserActiveUseCase) Execute(ctx context.Context, in SetUserActiveInput) error {
	if in.TargetUserID == in.ActorUserID {
		return ErrCannotSuspendSelf
	}
	member, err := u.perm.IsWorkspaceMember(ctx, in.WorkspaceID, in.TargetUserID)
	if err != nil {
		return err
	}
	if !member {
		return ErrTargetNotWorkspaceMember
	}
	target, err := u.users.FindByID(ctx, in.TargetUserID)
	if err != nil {
		return err
	}
	if target == nil {
		return domain.ErrNotFound
	}
	oldLabel := string(target.Status)
	newStatus := domain.UserStatusSuspended
	if in.Active {
		newStatus = domain.UserStatusActive
	}
	newLabel := string(newStatus)
	return u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := u.users.UpdateActive(ctx, in.TargetUserID, in.Active); err != nil {
			return err
		}
		// action は停止・復帰のどちらも MembershipEventSuspended を使う（role_changed が
		// 付与・剥奪の両方を 1 つの action で表すのと同じ考え方 — old/new label が向きを表す）。
		return u.perm.RecordMembershipEvent(
			ctx, in.WorkspaceID, in.TargetUserID, in.ActorUserID,
			domain.MembershipEventSuspended, &oldLabel, &newLabel,
		)
	})
}

// RetireSelfUseCase は自分自身のアカウントを退会させる。呼び出し元（handler）が本人からの
// 要求であることを確認したうえで呼ぶ前提で、他人を退会させる口は無い。
//
// 所属する全ワークスペースを退出（repository.LeaveWorkspaceMembership が principal 削除・
// workspace_members を left・監査記録を行う）してから users.status を deactivated にする。
// 1 トランザクションにまとめ、一部だけ退出して残りが宙に浮いた状態を作らない。
//
// いずれかで最後の admin なら退会自体を repository.ErrLastWorkspaceAdmin で断る（誰も権限を
// 変えられないワークスペースを残さないため。先に admin を誰かへ渡してからもう一度退会すればよい）。
type RetireSelfUseCase struct {
	users     repository.UserRepository
	perm      membershipRepository
	txManager repository.TxManager
}

func NewRetireSelfUseCase(
	users repository.UserRepository,
	perm membershipRepository,
	txManager repository.TxManager,
) *RetireSelfUseCase {
	return &RetireSelfUseCase{users: users, perm: perm, txManager: txManager}
}

func (u *RetireSelfUseCase) Execute(ctx context.Context, userID uint64) error {
	return u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		workspaces, err := u.perm.ListMemberWorkspaces(ctx, userID)
		if err != nil {
			return err
		}
		for _, ws := range workspaces {
			if err := u.perm.LeaveWorkspaceMembership(ctx, ws.Workspace.ID, userID, userID); err != nil {
				return err
			}
		}
		return u.users.SoftDelete(ctx, userID)
	})
}
