package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// 既定の雛形（sourceProjectId 未指定時）の色。画面の見本と同じ配色を使い、進行中の 3 状態は
// 進むほど濃くして一覧で見分けが付くようにする。
const (
	seedColorTodo     = "#5b6b7a"
	seedColorDev      = "#a0661a"
	seedColorReview   = "#8a5a14"
	seedColorVerify   = "#7a5301"
	seedColorReleased = "#2f6b47"

	seedColorDesignType = "#7c3aed"
	seedColorTaskType   = "#2563eb"
	seedColorBugType    = "#9a3b2e"
)

// EnableTicketsForProjectUseCase はプロジェクトにチケット機能を有効化する。「有効化済み」の正本は
// 初期状態を持つ現役の状態が 1 つあること（HasActiveInitialTicketStatus）で、二重有効化は
// repository.ErrTicketsAlreadyEnabled を返す。SourceProjectID を指定すると既存プロジェクトの現役の
// 状態・種別を複製し、無指定なら既定の雛形（seedStatuses / seedTypes）を作る — どちらも
// 有効化後は管理画面で編集できるので初期値でしかない。複製元への参照権限の確認は
// 呼び出し側の責務。
type EnableTicketsForProjectUseCase struct {
	repo      repository.TicketRepository
	txManager repository.TxManager
}

func NewEnableTicketsForProjectUseCase(
	r repository.TicketRepository, txManager repository.TxManager,
) *EnableTicketsForProjectUseCase {
	return &EnableTicketsForProjectUseCase{repo: r, txManager: txManager}
}

type EnableTicketsForProjectInput struct {
	WorkspaceID string
	ProjectID   string
	// SourceProjectID が nil なら既定の雛形、非 nil ならそのプロジェクトの現役構成を複製する。
	SourceProjectID *string
}

// EnableTicketsForProjectOutput はどれだけ作ったかの要約。json タグを明示するのは、タグが無いと
// フィールド名がそのまま出て、ほかの camelCase API と綴りが食い違うため。
type EnableTicketsForProjectOutput struct {
	StatusCount int `json:"statusCount"`
	TypeCount   int `json:"typeCount"`
}

func (u *EnableTicketsForProjectUseCase) Execute(
	ctx context.Context, in EnableTicketsForProjectInput,
) (*EnableTicketsForProjectOutput, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ProjectID == "" {
		return nil, errors.New("projectID is required")
	}

	already, err := u.repo.HasActiveInitialTicketStatus(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	if already {
		return nil, repository.ErrTicketsAlreadyEnabled
	}

	statuses, types, err := u.buildSeed(ctx, in)
	if err != nil {
		return nil, err
	}

	if err := u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		for _, s := range statuses {
			s := s
			s.WorkspaceID, s.ProjectID = in.WorkspaceID, in.ProjectID
			if err := u.repo.InsertTicketStatus(ctx, &s); err != nil {
				return err
			}
		}
		for _, t := range types {
			t := t
			t.WorkspaceID, t.ProjectID = in.WorkspaceID, in.ProjectID
			if err := u.repo.InsertTicketType(ctx, &t); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return &EnableTicketsForProjectOutput{StatusCount: len(statuses), TypeCount: len(types)}, nil
}

// buildSeed は作る状態・種別の集合を組み立てる（DB へはまだ書かない）。複製元指定があれば
// 現役の ListTicketStatuses/ListTicketTypes を読み、無ければ既定の雛形を fracindex で採番する。
func (u *EnableTicketsForProjectUseCase) buildSeed(
	ctx context.Context, in EnableTicketsForProjectInput,
) ([]domain.TicketStatus, []domain.TicketType, error) {
	if in.SourceProjectID != nil {
		statuses, err := u.repo.ListTicketStatuses(ctx, in.WorkspaceID, *in.SourceProjectID, false)
		if err != nil {
			return nil, nil, err
		}
		types, err := u.repo.ListTicketTypes(ctx, in.WorkspaceID, *in.SourceProjectID, false)
		if err != nil {
			return nil, nil, err
		}
		// ProjectID の複製先への書き換えは呼び出し元の Execute で行う。ここでは読んだ値をそのまま返す。
		return statuses, types, nil
	}

	statusPos, err := seedPositions(len(seedStatuses))
	if err != nil {
		return nil, nil, err
	}
	statuses := make([]domain.TicketStatus, len(seedStatuses))
	for i, s := range seedStatuses {
		s.Position = statusPos[i]
		statuses[i] = s
	}

	typePos, err := seedPositions(len(seedTypes))
	if err != nil {
		return nil, nil, err
	}
	types := make([]domain.TicketType, len(seedTypes))
	for i, t := range seedTypes {
		t.Position = typePos[i]
		types[i] = t
	}
	return statuses, types, nil
}

// seedStatuses / seedTypes は有効化の既定の雛形（画面の見本と同じ並び）。Position はここでは
// 決めず buildSeed が fracindex で採番する。有効化後は管理画面で変更できるので初期値でしかない。
var seedStatuses = []domain.TicketStatus{
	{Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: seedColorTodo, IsInitial: true},
	{Name: "開発", Category: domain.TicketStatusCategoryInProgress, Color: seedColorDev},
	{Name: "レビュー中", Category: domain.TicketStatusCategoryInProgress, Color: seedColorReview},
	{Name: "リリース検証", Category: domain.TicketStatusCategoryInProgress, Color: seedColorVerify},
	{Name: "リリース", Category: domain.TicketStatusCategoryDone, Color: seedColorReleased},
}

var seedTypes = []domain.TicketType{
	{Name: "設計", HierarchyLevel: 1, Color: seedColorDesignType},
	{Name: "開発タスク", HierarchyLevel: 0, Color: seedColorTaskType, IsDefault: true},
	{Name: "バグ", HierarchyLevel: 0, Color: seedColorBugType},
}

// seedPositions は n 個ぶんの position を先頭から順に採る。
// fracindex.Between(prev, "") は「prev の次」を返すので、直前の値を渡して数珠つなぎにする。
func seedPositions(n int) ([]string, error) {
	out := make([]string, n)
	prev := ""
	for i := 0; i < n; i++ {
		p, err := fracindex.Between(prev, "")
		if err != nil {
			return nil, err
		}
		out[i] = p
		prev = p
	}
	return out, nil
}
