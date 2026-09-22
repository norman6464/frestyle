package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
)

func TestPageDepthErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	respondKnowledgeBaseErr(c, domain.ErrPageDepthExceeded)
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"page_depth_exceeded"}`, w.Body.String())
}
