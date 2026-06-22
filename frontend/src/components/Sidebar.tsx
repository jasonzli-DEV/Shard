import React from 'react';
import { useAuth } from '../context/AuthContext';
import ShardMark from './ShardMark';
import './Sidebar.css';

interface SidebarProps {
  currentSection: string;
  onNavigate: (section: string) => void;
}

export default function Sidebar({ currentSection, onNavigate }: SidebarProps) {
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <ShardMark size={24} />
        <span className="sidebar-wordmark">Shard</span>
      </div>

      <nav className="sidebar-nav">
        <ul className="sidebar-nav-list">
          <SidebarItem
            icon={<DriveIcon />}
            label="My Drive"
            id="drive"
            active={currentSection === 'drive'}
            onClick={() => onNavigate('drive')}
          />
          <SidebarItem
            icon={<StarNavIcon />}
            label="Starred"
            id="starred"
            active={currentSection === 'starred'}
            onClick={() => onNavigate('starred')}
          />
          <SidebarItem
            icon={<SearchIcon />}
            label="Search"
            id="search"
            active={currentSection === 'search'}
            onClick={() => onNavigate('search')}
          />
          <SidebarItem
            icon={<SharedIcon />}
            label="Shared with me"
            id="shared"
            active={currentSection === 'shared'}
            onClick={() => onNavigate('shared')}
          />
          <SidebarItem
            icon={<TrashIcon />}
            label="Trash"
            id="trash"
            active={currentSection === 'trash'}
            onClick={() => onNavigate('trash')}
          />
        </ul>
      </nav>

      {/* User footer */}
      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user">
            <div className="sidebar-avatar" aria-hidden="true">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" width={28} height={28} />
              ) : (
                <span>{user.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name truncate">{user.name}</span>
              <span className="sidebar-user-role font-mono">{user.role}</span>
            </div>
          </div>
        )}
        <button className="sidebar-logout" onClick={logout} type="button">
          <LogoutIcon />
        </button>
      </div>
    </aside>
  );
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  id: string;
  active: boolean;
  onClick: () => void;
}

function SidebarItem({ icon, label, active, onClick }: SidebarItemProps) {
  return (
    <li>
      <button
        className={`sidebar-nav-item ${active ? 'active' : ''}`}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        type="button"
      >
        <span className="sidebar-nav-icon">{icon}</span>
        <span className="sidebar-nav-label">{label}</span>
      </button>
    </li>
  );
}

function DriveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function StarNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function SharedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
