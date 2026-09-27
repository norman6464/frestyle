import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import KbFrame from './KbFrame';
import {
  INITIAL_KB_FRAME_STATE,
  KbFrameLocationContext,
  applyKbFrameLocation,
  type KbFrameLocation,
} from '../model/kbFrameLocation';

/**
 * KbFrameLayout は /kb 以下の画面に共通の親ルート。枠（KbFrame）を 1 回だけ描き、
 * 本文だけを Outlet で差し替える（AppShell がヘッダーの下の本文を差し替えるのと同じ形）。
 *
 * 枠を各画面の中に置いていたときは、画面を移るたびに枠が捨てられて作り直され
 * （ワークスペース・スペース・木を取り直し、開いていたフォルダも閉じる）、さらに枠が本文の
 * 画面の子だったので、本文の状態が変わるたびに木の全行が描き直されていた。ここに置けば、
 * 本文の中で何が変わっても枠は描き直されない。
 *
 * 今いるスペース・開いているページは、各画面が useKbFrameLocation で知らせる。
 */
export default function KbFrameLayout() {
  const [frame, setFrame] = useState(INITIAL_KB_FRAME_STATE);
  const report = useCallback((location: KbFrameLocation) => {
    setFrame((prev) => applyKbFrameLocation(prev, location));
  }, []);

  return (
    <KbFrameLocationContext.Provider value={report}>
      <KbFrame
        workspaceSlug={frame.workspaceSlug}
        spaceId={frame.spaceId}
        activePageId={frame.activePageId}
        showPagePanel={frame.showPagePanel}
      >
        <Outlet />
      </KbFrame>
    </KbFrameLocationContext.Provider>
  );
}
