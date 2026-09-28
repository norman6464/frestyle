import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import BacklogTabs from '../BacklogTabs';

/*
 * 一覧の面と設定の面は別の部品なので、行き来するとタブごと作り直される。本番と同じく、面ごとに
 * 別の部品がタブを描く形で確かめる。
 */
function ListFace() {
  return <BacklogTabs projectId="p-1" current="backlog" />;
}
function SettingsFace() {
  return <BacklogTabs projectId="p-1" current="settings" />;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/backlog/:projectId" element={<ListFace />} />
        <Route path="/backlog/:projectId/settings" element={<SettingsFace />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BacklogTabs', () => {
  it('タブで別の部品の面へ移っても、押したタブにフォーカスが残る（先頭へ戻さない）', async () => {
    const user = userEvent.setup();
    renderAt('/backlog/p-1');

    await user.click(screen.getByRole('link', { name: '設定' }));

    const settings = await screen.findByRole('link', { name: '設定' });
    expect(settings).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(settings).toHaveFocus());
  });

  it('タブを押さずに開いたときは、フォーカスを動かさない', () => {
    renderAt('/backlog/p-1/settings');

    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page');
    expect(document.body).toHaveFocus();
  });
});
