import { useCallback, useEffect, useState } from 'react';
import { FsIcon } from '@/shared/ui';

interface ScrollToTopProps {
  targetId: string;
  threshold?: number;
}

export default function ScrollToTop({ targetId, threshold = 200 }: ScrollToTopProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;

    const handleScroll = () => {
      setVisible(target.scrollTop >= threshold);
    };

    target.addEventListener('scroll', handleScroll);
    return () => target.removeEventListener('scroll', handleScroll);
  }, [targetId, threshold]);

  const handleClick = useCallback(() => {
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [targetId]);

  if (!visible) return null;

  return (
    <button
      onClick={handleClick}
      aria-label="ページ上部に戻る"
      className="fixed bottom-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom,0px)+1rem)] right-4 z-40 md:bottom-6 md:right-6 w-10 h-10 bg-brand-600 hover:bg-brand-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors duration-fast animate-fade-in"
    >
      <FsIcon name="chevron-up" className="w-5 h-5" />
    </button>
  );
}
