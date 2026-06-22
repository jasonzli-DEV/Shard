import './Breadcrumbs.css';

export interface BreadcrumbSegment {
  id: string | null;
  name: string;
}

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
  onNavigate: (folderId: string | null) => void;
}

export default function Breadcrumbs({ segments, onNavigate }: BreadcrumbsProps) {
  return (
    <nav className="breadcrumbs" aria-label="File path">
      <ol className="breadcrumbs-list">
        {segments.map((seg, idx) => {
          const isLast = idx === segments.length - 1;
          return (
            <li key={seg.id ?? 'root'} className="breadcrumbs-item">
              {isLast ? (
                <span className="breadcrumbs-current" aria-current="page">
                  {seg.name}
                </span>
              ) : (
                <>
                  <button
                    className="breadcrumbs-link"
                    onClick={() => onNavigate(seg.id)}
                    type="button"
                  >
                    {seg.name}
                  </button>
                  <span className="breadcrumbs-sep" aria-hidden="true">
                    /
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
