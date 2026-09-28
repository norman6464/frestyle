package kb

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// 提案（page_suggestions）は kb パッケージ直下に置く。認可は既存の CanComment / CanEdit だけで
// 足りるため、comment のような独立パッケージにはしない。

// ErrTooManyOpenSuggestions は未解決（open）の提案が上限に達しているときに CreateSuggestionUseCase
// が返す。上限は 2 段構え — maxOpenSuggestionsPerAuthorPerPage は投稿者 1 人が同じページへ
// 積める数（自動化での大量投稿を他の投稿者を巻き込まずに抑える）、maxOpenSuggestionsPerPage は
// ページ全体の数（複数アカウントに分散されても編集者のレビュー一覧が際限なく膨らまないように
// する、フロント側の負荷上限とは独立の防御）。
var ErrTooManyOpenSuggestions = errors.New("too many open page suggestions")

const (
	maxOpenSuggestionsPerAuthorPerPage = 20
	maxOpenSuggestionsPerPage          = 100
)

// CreateSuggestionUseCase は commenter（閲覧+コメントはできるが編集はできない役割）が
// 保存した本文を、blocks へ直接書き込む代わりに提案として積む。
type CreateSuggestionUseCase struct {
	kbRepo      repository.KnowledgeBaseRepository
	versionRepo repository.PageVersionRepository
	suggestions repository.PageSuggestionRepository
	txManager   repository.TxManager
}

func NewCreateSuggestionUseCase(
	kbRepo repository.KnowledgeBaseRepository,
	versionRepo repository.PageVersionRepository,
	suggestions repository.PageSuggestionRepository,
	txManager repository.TxManager,
) *CreateSuggestionUseCase {
	return &CreateSuggestionUseCase{
		kbRepo:      kbRepo,
		versionRepo: versionRepo,
		suggestions: suggestions,
		txManager:   txManager,
	}
}

type CreateSuggestionInput struct {
	WorkspaceID  string
	PageID       string
	BaseRevision int64
	// Doc は提案後の本文全体（ProseMirror doc の JSON 文字列）。
	Doc          string
	AuthorUserID uint64
}

func (u *CreateSuggestionUseCase) Execute(ctx context.Context, in CreateSuggestionInput) (*domain.PageSuggestion, error) {
	if in.AuthorUserID == 0 {
		return nil, ErrPageEditorRequired
	}
	page, err := u.kbRepo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	// 上限判定は doc の妥当性検証より前に行う。既に溜まっている数は投稿の中身と無関係に
	// 決まるので、先に弾いた方が無駄がない。
	byAuthor, err := u.suggestions.CountOpenByAuthor(ctx, in.WorkspaceID, in.PageID, in.AuthorUserID)
	if err != nil {
		return nil, err
	}
	if byAuthor >= maxOpenSuggestionsPerAuthorPerPage {
		return nil, ErrTooManyOpenSuggestions
	}
	total, err := u.suggestions.CountOpen(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if total >= maxOpenSuggestionsPerPage {
		return nil, ErrTooManyOpenSuggestions
	}
	// ReplacePageBlocksUseCase.Execute と全く同じ検証パイプラインに通す。ここで弾かないと、
	// あとで採用したときに初めて壊れて発覚してしまう。
	tree, err := parsePageDoc(StripPageRefTitles(in.Doc))
	if err != nil {
		return nil, err
	}
	// flattenPageDoc は木の中の重複 id を新規 UUID へ採番し直す。rows 自体は使わないが
	// （提案は blocks へ書き込まない）、この後の renderPageDoc が同じ木を見るため先に呼ぶ。
	if _, err := flattenPageDoc(tree); err != nil {
		return nil, err
	}
	normalized, err := renderPageDoc(tree)
	if err != nil {
		return nil, err
	}
	var suggestion *domain.PageSuggestion

	err = u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := u.versionRepo.LockPage(ctx, in.WorkspaceID, in.PageID); err != nil {
			return err
		}

		page, err := u.kbRepo.FindPage(ctx, in.WorkspaceID, in.PageID)
		if err != nil {
			return err
		}

		if page.ArchivedAt != nil {
			return ErrPageArchived
		}

		if page.ContentRevision != in.BaseRevision {
			return domain.ErrPageSuggestionStale
		}

		var baseSeq *int64
		latest, err := u.versionRepo.GetLatestVersion(ctx, in.WorkspaceID, in.PageID)
		if err != nil {
			return err
		}
		if latest != nil {
			seq := latest.Seq
			baseSeq = &seq
		}

		baseRevision := in.BaseRevision
		suggestion = &domain.PageSuggestion{
			WorkspaceID:  in.WorkspaceID,
			PageID:       in.PageID,
			BaseSeq:      baseSeq,
			BaseRevision: &baseRevision,
			Doc:          normalized,
			AuthorUserID: in.AuthorUserID,
		}

		return u.suggestions.Create(ctx, suggestion)
	})
	if err != nil {
		return nil, err
	}
	return suggestion, nil
}

// defaultOpenSuggestionsLimit / maxOpenSuggestionsLimit は ListOpen の SQL LIMIT を決める。
// 既定値を maxOpenSuggestionsPerPage に揃え、書き込み側の上限が効いている限り 1 ページで
// 全 open 提案を見せられるようにする。明示指定はこの既定より絞れるが、maxOpenSuggestionsLimit
// で頭打ちにして SQL 側の負荷を増やさない。
const (
	defaultOpenSuggestionsLimit = maxOpenSuggestionsPerPage
	maxOpenSuggestionsLimit     = 200
)

// ListOpenPageSuggestionsUseCase はページの open な提案一覧（created_at 昇順）を返す。
type ListOpenPageSuggestionsUseCase struct {
	suggestions repository.PageSuggestionRepository
}

func NewListOpenPageSuggestionsUseCase(suggestions repository.PageSuggestionRepository) *ListOpenPageSuggestionsUseCase {
	return &ListOpenPageSuggestionsUseCase{suggestions: suggestions}
}

type ListOpenPageSuggestionsInput struct {
	WorkspaceID string
	PageID      string
	// Limit は返す最大件数。0 以下なら defaultOpenSuggestionsLimit。maxOpenSuggestionsLimit
	// を超える値は切り詰める（SearchViewablePagesUseCase.Limit と同じ挟み方）。
	Limit int
}

func (u *ListOpenPageSuggestionsUseCase) Execute(ctx context.Context, in ListOpenPageSuggestionsInput) ([]domain.PageSuggestion, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = defaultOpenSuggestionsLimit
	}
	if limit > maxOpenSuggestionsLimit {
		limit = maxOpenSuggestionsLimit
	}
	return u.suggestions.ListOpen(ctx, in.WorkspaceID, in.PageID, limit)
}

// AcceptPageSuggestionUseCase は提案を採用する — 提案の doc を通常の保存経路
// （ReplacePageBlocksUseCase）へそのまま渡し、本文へ反映しつつ版を 1 つ切る。
//
// 提案の解決（Resolve）と本文の書き換えは 1 つのトランザクションに入れる。片方だけ成功すると
// 「提案は accepted なのに本文は古いまま」という中間状態が残るため、両方ロールバックする。
type AcceptPageSuggestionUseCase struct {
	kbRepo        repository.KnowledgeBaseRepository
	suggestions   repository.PageSuggestionRepository
	versionRepo   repository.PageVersionRepository
	replaceBlocks *ReplacePageBlocksUseCase
	txManager     repository.TxManager
}

func NewAcceptPageSuggestionUseCase(
	kbRepo repository.KnowledgeBaseRepository,
	suggestions repository.PageSuggestionRepository,
	versionRepo repository.PageVersionRepository,
	replaceBlocks *ReplacePageBlocksUseCase,
	txManager repository.TxManager,
) *AcceptPageSuggestionUseCase {
	return &AcceptPageSuggestionUseCase{
		kbRepo:        kbRepo,
		suggestions:   suggestions,
		versionRepo:   versionRepo,
		replaceBlocks: replaceBlocks,
		txManager:     txManager,
	}
}

type AcceptSuggestionInput struct {
	WorkspaceID    string
	PageID         string
	SuggestionID   string
	ResolverUserID uint64
}

// suggestionIsStale は、提案作成時の本文リビジョンと現在の本文リビジョンが
// 一致しているかを判定する。基準 revision が不明な既存提案も安全側で stale とする。
func suggestionIsStale(baseRevision *int64, contentRevision int64) bool {
	return baseRevision == nil || *baseRevision != contentRevision
}

func (u *AcceptPageSuggestionUseCase) Execute(ctx context.Context, in AcceptSuggestionInput) (*domain.PageSuggestion, error) {
	var resolved *domain.PageSuggestion
	err := u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := u.versionRepo.LockPage(ctx, in.WorkspaceID, in.PageID); err != nil {
			return err
		}

		page, err := u.kbRepo.FindPage(ctx, in.WorkspaceID, in.PageID)
		if err != nil {
			return err
		}
		if page.ArchivedAt != nil {
			return ErrPageArchived
		}

		s, err := u.suggestions.Get(ctx, in.WorkspaceID, in.PageID, in.SuggestionID)
		if err != nil {
			return err
		}
		if s.Status != domain.PageSuggestionStatusOpen {
			return domain.ErrPageSuggestionAlreadyResolved
		}
		if suggestionIsStale(s.BaseRevision, page.ContentRevision) {
			return domain.ErrPageSuggestionStale
		}
		resolvedSuggestion, err := u.suggestions.Resolve(
			ctx, in.WorkspaceID, in.PageID, in.SuggestionID, domain.PageSuggestionStatusAccepted, in.ResolverUserID, time.Now(),
		)
		if err != nil {
			return err
		}
		// ForceVersion は必須 — 10 分規則の間引きを無視して必ず版を切る（「版を残す」・復元と同じ扱い）。
		if _, err := u.replaceBlocks.Execute(ctx, ReplacePageBlocksInput{
			WorkspaceID:  in.WorkspaceID,
			PageID:       in.PageID,
			Doc:          resolvedSuggestion.Doc,
			EditorUserID: in.ResolverUserID,
			ForceVersion: true,
		}); err != nil {
			return err
		}
		resolved = resolvedSuggestion
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resolved, nil
}

// RejectPageSuggestionUseCase は提案を却下する。本文は一切触らない。
type RejectPageSuggestionUseCase struct {
	suggestions repository.PageSuggestionRepository
}

func NewRejectPageSuggestionUseCase(suggestions repository.PageSuggestionRepository) *RejectPageSuggestionUseCase {
	return &RejectPageSuggestionUseCase{suggestions: suggestions}
}

type RejectSuggestionInput struct {
	WorkspaceID    string
	PageID         string
	SuggestionID   string
	ResolverUserID uint64
}

func (u *RejectPageSuggestionUseCase) Execute(ctx context.Context, in RejectSuggestionInput) (*domain.PageSuggestion, error) {
	return u.suggestions.Resolve(
		ctx, in.WorkspaceID, in.PageID, in.SuggestionID, domain.PageSuggestionStatusRejected, in.ResolverUserID, time.Now(),
	)
}
