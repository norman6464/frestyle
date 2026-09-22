import { useCallback, useEffect, useState } from 'react';
import { ChevronUpIcon } from '@heroicons/react/24/solid';

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
      className="fixed bottom-6 right-6 z-40 w-10 h-10 bg-brand-600 hover:bg-brand-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors duration-fast animate-fade-in"
    >
      <ChevronUpIcon className="w-5 h-5" />
    </button>
  );
}
