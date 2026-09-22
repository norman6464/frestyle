import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface LinkTextProps {
  to: string;
  children: ReactNode;
}

export default function LinkText({ to, children }: LinkTextProps) {
  return (
    <Link
      to={to}
      className="text-sm text-brand-700 hover:text-brand-800 font-medium transition-colors duration-fast hover:underline"
    >
      {children}
    </Link>
  );
}
