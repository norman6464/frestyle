import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import { createFailureMessage } from '../createFailure';

function httpError(status: number): AxiosError {
  const response = { status, data: {}, statusText: '', headers: {}, config: {} } as unknown as AxiosResponse;
  return new AxiosError('stub', undefined, undefined, undefined, response);
}

describe('createFailureMessage', () => {
  it('応答が無い・5xx は作れたかを言い切らず、作成先で確かめてもらう', () => {
    expect(createFailureMessage(new Error('network'), 'page')).toBe(
      '作成できたか確認できません。同じものを作り直す前に、ナレッジで確かめてください。',
    );
    expect(createFailureMessage(httpError(503), 'ticket')).toContain('バックログで確かめてください');
  });

  it('4xx は理由を言う', () => {
    expect(createFailureMessage(httpError(403), 'page')).toBe('この場所に作る権限がありません。作成先を選び直してください。');
    expect(createFailureMessage(httpError(404), 'ticket')).toBe('作成先が見つかりません。作成先を選び直してください。');
    expect(createFailureMessage(httpError(400), 'page')).toContain('200 文字');
    expect(createFailureMessage(httpError(409), 'page')).toBe('作成できませんでした。もう一度お試しください。');
  });
});
