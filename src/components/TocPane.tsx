import React, { useMemo } from 'react';
import { List } from 'lucide-react';
import { slugify } from '../utils/printTOC'; // NEW: stesso algoritmo usato da PreviewPane per generare gli id degli heading

export interface TocItem {
  id: string;
  text: string;
  level: number;
  line: number;
  slug: string; // NEW
}

interface TocPaneProps {
  content: string;
  onNavigate: (line: number) => void;
  // NEW: già calcolato e passato da App.tsx (da scroll editor, cursore, scroll preview
  // e click), ma finora mai dichiarato qui — quindi mai usato per evidenziare nulla.
  activeHeadingSlug?: string | null;
  // NEW: dichiarata per compatibilità con App.tsx, che la passa già ma è ridondante —
  // il click usa onNavigate, che in App.tsx allinea sia editor che preview.
  // Puoi rimuoverla da App.tsx se non prevedi di usarla per altro in futuro.
  onHeadingClick?: (slug: string) => void;
}

export function TocPane({ content, onNavigate, activeHeadingSlug }: TocPaneProps) {
  const tocItems = useMemo(() => {
    const lines = content.split('\n');
    const items: TocItem[] = [];
    let inCodeBlock = false;

    lines.forEach((lineStr, index) => {
      if (lineStr.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
      }
      if (!inCodeBlock) {
        const match = /^(\#{1,6})\s+(.*)/.exec(lineStr);
        if (match) {
          const text = match[2].trim();
          items.push({
            id: `toc-${index}`,
            level: match[1].length,
            text,
            line: index + 1,
            slug: slugify(text) // NEW
          });
        }
      }
    });
    return items;
  }, [content]);

  return (
    <div data-print-hide className="w-48 h-full bg-slate-panels border-l border-slate-borderDark flex flex-col shrink-0 overflow-y-auto p-4 hidden lg:flex">
      <div className="flex items-center gap-2 mb-6 text-slate-textDark">
        <List size={16} className="text-cyan-accent" />
        <h2 className="font-semibold tracking-wider text-xs uppercase">Outline</h2>
      </div>
      
      {tocItems.length === 0 ? (
        <div className="text-xs text-slate-500 italic">No headings found.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {tocItems.map(item => {
            const isActive = item.slug === activeHeadingSlug; // NEW
            return (
              <div
                key={item.id}
                onClick={() => onNavigate(item.line)}
                className={`text-xs cursor-pointer truncate transition-colors border-l-2 pl-2 -ml-2 ${
                  isActive
                    ? 'text-cyan-accent font-semibold border-cyan-accent' // barra #06B6D4
                    : 'text-slate-400 hover:text-cyan-accent border-transparent'
                }`}
                title={item.text}
              >
                {item.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
