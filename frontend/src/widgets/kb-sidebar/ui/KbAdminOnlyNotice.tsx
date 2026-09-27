import { useNavigate } from 'react-router-dom';
import { EmptyState, fsIcon } from '@/shared/ui';

/**
 * ワークスペースの管理（メンバーと招待）を、admin でない人が開いたときの案内。
 *
 * 所属していないワークスペースや存在しないワークスペースでも同じ文言を出す（あるかどうかを
 * 明かさない）。親ルートの見出し（「メンバーと招待」）の下で出すときは headingLevel={2}。
 */
export default function KbAdminOnlyNotice({ headingLevel = 1 }: { headingLevel?: 1 | 2 }) {
  const navigate = useNavigate();
  return (
    <EmptyState
      headingLevel={headingLevel}
      icon={fsIcon('lock')}
      title="この画面は admin だけが開けます"
      description="メンバーの管理と招待は、このワークスペースの admin だけが行えます。"
      action={{ label: 'ナレッジへ戻る', onClick: () => navigate('/kb') }}
    />
  );
}
