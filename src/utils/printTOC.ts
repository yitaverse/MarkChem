import React from 'react';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (React.isValidElement(children)) {
    return extractTextFromChildren(children.props.children);
  }
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join('');
  }
  return '';
}

interface TOCEntry {
  level: number;
  text: string;
  slug: string;
}

export function generateTOC(content: string): string {
  const lines = content.split('\n');
  const entries: TOCEntry[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = /^(#{1,3})\s+(.*)/.exec(line);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      entries.push({ level, text, slug: slugify(text) });
    }
  }

  if (entries.length === 0) return '';

  let html = '<div class="print-toc"><h2>Indice</h2><ul>';

  let prevLevel = 0;
  for (const entry of entries) {
    if (entry.level > prevLevel) {
      for (let i = prevLevel; i < entry.level; i++) {
        html += '<ul>';
      }
    } else if (entry.level < prevLevel) {
      for (let i = entry.level; i < prevLevel; i++) {
        html += '</ul></li>';
      }
    } else if (prevLevel > 0) {
      html += '</li>';
    }

    html += `<li><a href="#${entry.slug}">${entry.text}</a>`;
    prevLevel = entry.level;
  }

  for (let i = 1; i <= prevLevel; i++) {
    html += '</li></ul>';
  }
  html += '</div>';

  return html;
}

// Mancava del tutto — App.tsx la importa e la usa in findClosestHeadingForLine
// per far corrispondere una riga dell'editor all'heading più vicino (spy-scroll
// dell'outline). Senza questa funzione il progetto non compila.
export interface HeadingEntry {
  level: number;
  text: string;
  slug: string;
  line: number; // 1-indexed, coerente con doc.line() di CodeMirror
}

export function extractHeadings(content: string): HeadingEntry[] {
  const lines = content.split('\n');
  const headings: HeadingEntry[] = [];
  let inCodeBlock = false;

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;

    const match = /^(#{1,6})\s+(.*)/.exec(line);
    if (match) {
      const text = match[2].trim();
      headings.push({
        level: match[1].length,
        text,
        slug: slugify(text),
        line: index + 1
      });
    }
  });

  return headings;
}
