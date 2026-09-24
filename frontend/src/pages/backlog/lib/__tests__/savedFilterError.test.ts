import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';
import { MAX_SAVED_FILTERS, savedFilterErrorMessage } from '../savedFilterError';

function apiError(status: number, code?: string): AxiosError {
  const config = {} as InternalAxiosRequestConfig;
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    data: code ? { error: code } : {},
    statusText: '',
    headers: {},
    config,
  } as AxiosResponse);
}

describe('savedFilterErrorMessage', () => {
  it('理由が分かる失敗は理由を返す', () => {
    expect(savedFilterErrorMessage(apiError(409, 'saved_filter_name_taken'), 'x')).toContain('同じ名前');
    expect(savedFilterErrorMessage(apiError(409, 'saved_filter_limit_reached'), 'x')).toContain(`${MAX_SAVED_FILTERS} 件`);
    expect(savedFilterErrorMessage(apiError(400, 'filter_has_no_condition'), 'x')).toContain('条件を 1 つ以上');
    expect(savedFilterErrorMessage(apiError(400, 'invalid_filter_name'), 'x')).toContain('1〜60 文字');
    expect(savedFilterErrorMessage(apiError(400, 'assignee_mode_conflict'), 'x')).toContain('担当の条件');
  });

  it('権限が無ければその旨、分からない失敗は fallback', () => {
    expect(savedFilterErrorMessage(apiError(403), 'x')).toContain('権限');
    expect(savedFilterErrorMessage(apiError(500), '保存できませんでした。')).toBe('保存できませんでした。');
    expect(savedFilterErrorMessage(new Error('offline'), '保存できませんでした。')).toBe('保存できませんでした。');
  });
});
