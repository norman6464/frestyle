import type { ComponentType, SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { FsIcon } from '@/shared/ui';

type CardColor = 'brand' | 'emerald' | 'taupe' | 'blue';

interface FeatureCardProps {
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  color: CardColor;
  badge?: string;
}

const iconBg: Record<CardColor, string> = {
  brand:   'bg-brand-100 text-brand-600',
  emerald: 'bg-success-soft text-success',
  taupe:   'bg-taupe-100 text-taupe-600',
  blue:    'bg-blue-100 text-blue-600',
};

/** ホームの機能カード 1 枚。 */
export default function FeatureCard({ to, icon: Icon, title, description, color, badge }: FeatureCardProps) {
  return (
    <Link
      to={to}
      className="group relative flex h-full flex-col p-5 rounded-xl border border-[var(--color-surface-3)] bg-[var(--color-surface-1)] shadow-sm hover:border-brand-500 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm transition-all duration-fast"
    >
      {badge && (
        <span className="absolute top-4 right-4 text-[10px] font-semibold px-2 pt-px pb-[3px] rounded-full bg-success-soft text-success">
          {badge}
        </span>
      )}
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg[color]}`}>
          <Icon className="w-5 h-5 -translate-y-px" />
        </div>
        <div className="min-w-0 pt-1">
          <h3 className="font-semibold text-[var(--color-text-primary)] text-sm group-hover:text-brand-700 transition-colors">
            {title}
          </h3>
        </div>
      </div>
      <p className="mt-3 text-xs text-[var(--color-text-muted)] leading-relaxed">
        {description}
      </p>
      <div className="mt-4 flex items-center gap-1 text-xs text-[var(--color-text-muted)] group-hover:text-brand-700 transition-colors">
        <span>開く</span>
        <FsIcon name="arrow-right" className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}
