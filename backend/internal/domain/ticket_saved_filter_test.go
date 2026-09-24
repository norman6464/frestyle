package domain_test

import (
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ptr(s string) *string { return &s }

func Test_保存した絞り込み_名前と検索語は前後の空白を落とし空のIDは指定なしに畳む(t *testing.T) {
	f := domain.TicketSavedFilter{
		Name: "  自分の不具合  ", StatusID: ptr("  "), TypeID: ptr(""), LabelID: ptr(" label-1 "),
		AssigneePrincipalID: nil, Q: ptr("  ログイン  "),
	}
	require.NoError(t, f.Normalize())
	assert.Equal(t, "自分の不具合", f.Name)
	assert.Nil(t, f.StatusID, "空白だけは指定なし")
	assert.Nil(t, f.TypeID, "空文字は指定なし")
	require.NotNil(t, f.LabelID)
	assert.Equal(t, "label-1", *f.LabelID)
	require.NotNil(t, f.Q)
	assert.Equal(t, "ログイン", *f.Q)
}

func Test_保存した絞り込み_名前が空か長すぎれば拒否(t *testing.T) {
	empty := domain.TicketSavedFilter{Name: "   ", Overdue: true}
	assert.ErrorIs(t, empty.Normalize(), domain.ErrInvalidTicketSavedFilterName)

	justFits := domain.TicketSavedFilter{Name: strings.Repeat("あ", domain.MaxTicketSavedFilterNameLen), Overdue: true}
	assert.NoError(t, justFits.Normalize(), "列幅は文字数で数える（バイト数ではない）")

	tooLong := domain.TicketSavedFilter{Name: strings.Repeat("あ", domain.MaxTicketSavedFilterNameLen+1), Overdue: true}
	assert.ErrorIs(t, tooLong.Normalize(), domain.ErrInvalidTicketSavedFilterName)
}

func Test_保存した絞り込み_検索語が長すぎれば拒否_空白だけなら条件なし扱い(t *testing.T) {
	tooLong := domain.TicketSavedFilter{Name: "x", Q: ptr(strings.Repeat("あ", domain.MaxTicketSavedFilterQueryLen+1))}
	assert.ErrorIs(t, tooLong.Normalize(), domain.ErrInvalidTicketSavedFilterQuery)

	blank := domain.TicketSavedFilter{Name: "x", Q: ptr("   ")}
	assert.ErrorIs(t, blank.Normalize(), domain.ErrTicketSavedFilterNoCondition, "空白だけの検索語は条件にならない")
}

func Test_保存した絞り込み_担当の条件は高々1つ(t *testing.T) {
	cases := map[string]domain.TicketSavedFilter{
		"主体と未割り当て": {Name: "x", AssigneePrincipalID: ptr("p-1"), Unassigned: true},
		"主体と自分":    {Name: "x", AssigneePrincipalID: ptr("p-1"), AssignedToMe: true},
		"未割り当てと自分": {Name: "x", Unassigned: true, AssignedToMe: true},
		"3つとも":     {Name: "x", AssigneePrincipalID: ptr("p-1"), Unassigned: true, AssignedToMe: true},
	}
	for name, f := range cases {
		t.Run(name, func(t *testing.T) {
			assert.ErrorIs(t, f.Normalize(), domain.ErrTicketSavedFilterAssigneeConflict)
		})
	}
	single := domain.TicketSavedFilter{Name: "x", AssignedToMe: true}
	assert.NoError(t, single.Normalize())
}

func Test_保存した絞り込み_条件が1つも無ければ拒否(t *testing.T) {
	none := domain.TicketSavedFilter{Name: "すべて"}
	assert.ErrorIs(t, none.Normalize(), domain.ErrTicketSavedFilterNoCondition)

	for name, f := range map[string]domain.TicketSavedFilter{
		"状態":    {Name: "x", StatusID: ptr("s")},
		"種別":    {Name: "x", TypeID: ptr("t")},
		"ラベル":   {Name: "x", LabelID: ptr("l")},
		"主体":    {Name: "x", AssigneePrincipalID: ptr("p")},
		"未割り当て": {Name: "x", Unassigned: true},
		"自分":    {Name: "x", AssignedToMe: true},
		"期限切れ":  {Name: "x", Overdue: true},
		"検索語":   {Name: "x", Q: ptr("q")},
	} {
		t.Run(name+"だけでも条件になる", func(t *testing.T) {
			assert.NoError(t, f.Normalize())
			assert.True(t, f.HasCondition())
		})
	}
}
