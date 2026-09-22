export type SnsProvider = 'google' | 'facebook' | 'x';

interface SNSSignInButtonProps {
  provider: SnsProvider;
  onClick: () => void;
  disabled?: boolean;
}

export default function SNSSignInButton({ provider, onClick, disabled }: SNSSignInButtonProps) {
  const providerIcons: Record<SnsProvider, string> = {
    google: 'https://developers.google.com/identity/images/g-logo.png',
    facebook:
      'https://upload.wikimedia.org/wikipedia/commons/0/05/Facebook_Logo_%282019%29.png',
    x: 'https://cdn.cms%E2%80%91twdigitalassets.com/content/dam/about-twitter/x/brand-toolkit/x-white-logo.png',
  };

  const providerLabels: Record<SnsProvider, string> = {
    google: 'Googleでログイン',
    facebook: 'Facebookでログイン',
    x: 'Xでログイン',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 w-full border border-surface-3 rounded-lg py-2.5 px-4 flex items-center justify-center space-x-3 hover:bg-surface-2 transition-colors duration-fast mb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <img src={providerIcons[provider]} alt={provider} className="w-5 h-5" />
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">
        {providerLabels[provider]}
      </span>
    </button>
  );
}
