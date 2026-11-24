import React from 'react';
import type { Page } from '../../types';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface DashboardLayoutProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  connected?: boolean;
  unacknowledgedIncidentsCount?: number;
  isAdmin?: boolean;
  workerOnline?: boolean;
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  currentPage,
  onNavigate,
  connected = true,
  unacknowledgedIncidentsCount = 0,
  isAdmin = false,
  workerOnline = false,
  children,
}) => {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-surface text-on-surface antialiased font-body">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        unacknowledgedIncidentsCount={unacknowledgedIncidentsCount}
        connected={connected}
        isAdmin={isAdmin}
        workerOnline={workerOnline}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header currentPage={currentPage} connected={connected} onNavigate={onNavigate} />
        <main className="flex-1 p-gutter-xl max-w-[1200px] w-full mx-auto flex flex-col gap-gutter-xl">
          {children}
        </main>
      </div>
    </div>
  );
};
