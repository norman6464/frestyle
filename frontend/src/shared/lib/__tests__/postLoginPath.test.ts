import { afterEach, describe, expect, it } from 'vitest';
import { consumePostLoginPath, rememberPostLoginPath } from '../postLoginPath';

afterEach(() => {
  sessionStorage.clear();
});

describe('ログイン後の戻り先', () => {
  it('置いたパスを 1 回だけ取り出せる', () => {
    rememberPostLoginPath('/invitations');
    expect(consumePostLoginPath()).toBe('/invitations');
    expect(consumePostLoginPath()).toBeNull();
  });

  it('アプリ内のパス以外は置かない（外部サイトへ飛ばす口にしない）', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'invitations', '']) {
      rememberPostLoginPath(bad);
      expect(consumePostLoginPath()).toBeNull();
    }
  });

  it('保存された値が壊れていても取り出さない', () => {
    sessionStorage.setItem('fs.postLoginPath', '//evil.example');
    expect(consumePostLoginPath()).toBeNull();
  });
});
