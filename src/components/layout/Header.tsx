import React from 'react';
import type { Page } from '../../types';

interface HeaderProps {
  currentPage: Page;
  connected?: boolean;
  onNavigate?: (page: Page) => void;
}

const pageLabels: Record<Page, string> = {
  overview: 'Workspace overview',
  studio: 'Monitoring studio',
  cameras: 'Cameras & live streams',
  videos: 'Video findings',
  demos: 'Demo footage',
  incidents: 'Incidents & evidence',
  carbon: 'Carbon & energy',
  reports: 'Reports & audit export',
  how: 'How it works',
  settings: 'Health & settings',
};

export const Header: React.FC<HeaderProps> = ({ currentPage, connected = true, onNavigate }) => {
  return (
    <header className="sticky top-0 z-20 bg-surface-container-lowest border-b border-outline-variant px-gutter-xl py-gutter-md flex items-center justify-between gap-gutter-lg">
      <div className="flex items-center gap-gutter-sm font-body text-body-sm text-on-surface-variant">
        <span>Workspace</span>
        <span aria-hidden="true">&gt;</span>
        <span className="font-label text-label-md text-on-surface font-medium">
          {pageLabels[currentPage] || 'Workspace'}
        </span>
      </div>

      <div className="flex items-center gap-gutter-md">
        {connected ? (
          <span
            role="status"
            className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-success-container text-on-success-container font-label text-label-md font-medium"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden="true"></span>
            <span>API connected</span>
          </span>
        ) : (
          <span
            role="status"
            className="inline-flex items-center gap-gutter-xs px-gutter-md py-gutter-xs rounded-full bg-warning-container text-on-warning-container font-label text-label-md font-medium"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning" aria-hidden="true"></span>
            <span>Connecting...</span>
          </span>
        )}

        <button
          type="button"
          aria-label="Documentation"
          onClick={() => onNavigate?.('how')}
          className="inline-flex items-center justify-center w-9 h-9 rounded bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-title-md" aria-hidden="true">
            help
          </span>
        </button>

        <button
          type="button"
          aria-label="Notifications"
          onClick={() => onNavigate?.('incidents')}
          className="inline-flex items-center justify-center w-9 h-9 rounded bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-title-md" aria-hidden="true">
            notifications
          </span>
        </button>

        <div className="w-8 h-8 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center font-label text-label-md text-on-surface font-semibold">
          TZ
        </div>
      </div>
    </header>
  );
};
