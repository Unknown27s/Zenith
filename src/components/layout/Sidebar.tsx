import React from 'react';
import type { Page } from '../../types';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  unacknowledgedIncidentsCount?: number;
  connected?: boolean;
  isAdmin?: boolean;
  workerOnline?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  unacknowledgedIncidentsCount = 0,
  connected = true,
  isAdmin = false,
  workerOnline = false,
}) => {
  const navItems: { page: Page; label: string; icon: string; badge?: number }[] = [
    { page: 'overview', label: 'Overview', icon: 'grid_view' },
    { page: 'studio', label: 'Monitoring studio', icon: 'smart_display' },
    { page: 'cameras', label: 'Cameras & live streams', icon: 'photo_camera' },
    { page: 'videos', label: 'Video findings', icon: 'movie' },
    { page: 'demos', label: 'Demo footage', icon: 'download' },
    {
      page: 'incidents',
      label: 'Incidents & evidence',
      icon: 'verified_user',
      badge: unacknowledgedIncidentsCount,
    },
    { page: 'carbon', label: 'Carbon & energy', icon: 'eco' },
    { page: 'reports', label: 'Reports', icon: 'description' },
    { page: 'how', label: 'How it works', icon: 'menu_book' },
  ];

  return (
    <aside className="w-full lg:w-64 shrink-0 bg-surface-container-lowest border-b lg:border-b-0 lg:border-r border-outline-variant lg:min-h-screen flex flex-col justify-between p-gutter-lg gap-gutter-xl">
      <div className="flex flex-col gap-gutter-lg">
        {/* Brand Mark */}
        <div className="flex items-center gap-gutter-sm px-gutter-sm py-gutter-xs">
          <div className="w-7 h-7 rounded bg-primary text-on-primary flex items-center justify-center font-headline text-title-md font-bold">
            z
          </div>
          <span className="font-headline text-headline-md text-on-surface font-semibold tracking-tight">
            zenith.
          </span>
        </div>

        {/* Workspace Switcher Card */}
        <div className="bg-surface-container-low border border-outline-variant rounded-md p-gutter-md flex items-center gap-gutter-md">
          <div className="w-8 h-8 rounded bg-surface-container-lowest border border-outline-variant flex items-center justify-center font-label text-label-md text-on-surface font-semibold">
            TZ
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="font-title text-title-sm text-on-surface font-semibold">Team Zenith</span>
            <span className="font-body text-body-sm text-on-surface-variant">Operations workspace</span>
          </div>
        </div>

        {/* Primary Navigation */}
        <nav aria-label="Workspace navigation" className="flex flex-col gap-gutter-xs">
          <span className="px-gutter-sm py-gutter-xs font-label text-label-sm text-on-surface-variant uppercase font-medium">
            Workspace
          </span>

          {navItems.map((item) => {
            const isActive = currentPage === item.page;
            return (
              <button
                key={item.page}
                type="button"
                onClick={() => onNavigate(item.page)}
                className={`flex items-center justify-between gap-gutter-sm px-gutter-md py-gutter-sm rounded font-label text-label-lg transition-colors text-left cursor-pointer ${
                  isActive
                    ? 'bg-primary-container border border-primary-border text-on-primary-container font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span className="flex items-center gap-gutter-md">
                  <span className="material-symbols-outlined text-title-md" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    role="status"
                    className="inline-flex items-center justify-center min-w-5 h-5 px-gutter-xs rounded-full bg-error-container text-on-error-container font-label text-label-sm tabular-nums font-semibold"
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Operator & Settings */}
      <div className="flex flex-col gap-gutter-md pt-gutter-lg border-t border-outline-variant">
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className={`flex items-center gap-gutter-md px-gutter-md py-gutter-sm rounded font-label text-label-lg transition-colors text-left cursor-pointer ${
            currentPage === 'settings'
              ? 'bg-primary-container border border-primary-border text-on-primary-container font-semibold'
              : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-title-md" aria-hidden="true">
            tune
          </span>
          <span>Health &amp; settings</span>
        </button>

        <div className="flex items-center gap-gutter-md px-gutter-sm py-gutter-xs">
          <div className="w-8 h-8 rounded-full bg-surface-variant border border-primary-border flex items-center justify-center font-label text-label-md text-on-primary-container font-semibold">
            Z
          </div>
          <div className="flex flex-col">
            <span className="font-title text-title-sm text-on-surface font-semibold">
              {connected ? (isAdmin ? 'Administrator' : 'Operator') : 'Not connected'}
            </span>
            <span className="font-body text-body-sm text-on-surface-variant">
              {connected ? (workerOnline ? 'Worker online' : 'Worker offline') : 'Backend offline'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
