import { useEffect, useState } from 'react';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { useLoginCallback } from '../model/useLoginCallback';
import LoginCallbackView from './LoginCallbackView';

/** この時間を過ぎても移らなければ、理由と戻る手段を出す。 */
const SLOW_AFTER_MS = 15_000;

export default function LoginCallback() {
  // OAuth コールバックの一時画面。検索エンジンに index させない。
  useDocumentMeta({ robots: 'noindex, nofollow' });
  useLoginCallback();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return <LoginCallbackView slow={slow} />;
}
