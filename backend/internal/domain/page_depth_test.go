package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidatePageDepth(t *testing.T) {
	for _, tc := range []struct {
		name                       string
		parentDepth, subtreeHeight int32
		rejected                   bool
	}{
		{"root", 0, 0, false},
		{"create at limit", 299, 0, false},
		{"create beyond limit", 300, 0, true},
		{"move subtree at limit", 298, 1, false},
		{"move subtree beyond limit", 299, 1, true},
		{"move tall subtree to root", 0, 300, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePageDepth(tc.parentDepth, tc.subtreeHeight)
			if tc.rejected {
				assert.ErrorIs(t, err, ErrPageDepthExceeded)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}
