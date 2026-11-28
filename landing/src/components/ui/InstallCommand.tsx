import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const COMMANDS = {
  unix: 'curl -fsSL https://aidyagent.app/install.sh | bash',
  windows: 'iex (irm https://aidyagent.app/install.ps1)',
} as const;

type Platform = keyof typeof COMMANDS;

/** Windows visitors see the PowerShell command first; everyone else, curl. */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unix';
  return /Win/i.test(navigator.userAgent) ? 'windows' : 'unix';
}

/** The one-line installer, with a platform switch and a copy button. */
export function InstallCommand() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMANDS[platform]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, permissions): the command is
      // still visible and selectable.
    }
  };

  return (
    <div className="install-command">
      <div
        className="install-segmented"
        role="tablist"
        aria-label="Operating system"
      >
        {(
          [
            ['unix', 'macOS & Linux'],
            ['windows', 'Windows'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={platform === key}
            className={`install-segment ${platform === key ? 'install-segment--active' : ''}`}
            onClick={() => setPlatform(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="install-code">
        <code>
          <span className="install-prompt" aria-hidden="true">
            {platform === 'windows' ? 'PS>' : '$'}
          </span>
          {COMMANDS[platform]}
        </code>
        <button
          className="install-copy"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy install command'}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}
