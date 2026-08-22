import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import katex from 'katex';
import 'katex/dist/contrib/mhchem.mjs'; // Pure ESM version natively binds to the imported katex!
import SmilesDrawer from 'smiles-drawer';
import 'katex/dist/katex.min.css';
import { MermaidRenderer } from './MermaidRenderer';
import { slugify, extractTextFromChildren, generateTOC } from '../utils/printTOC';

// NEW: estrae la riga sorgente 1-indexed da un nodo mdast/hast di react-markdown.
function sourceLine(node: any): number | undefined {
  return node?.position?.start?.line;
}

// NEW: se una sostituzione regex accorcia il numero di righe (es. un blocco $$...$$
// multi-riga collassato in un <div> su una riga sola), i nodi AST successivi verrebbero
// numerati con righe sbagliate rispetto all'editor. Ripristiniamo il conteggio aggiungendo
// newline "silenziosi" dopo il replacement.
function preserveLineCount(original: string, replacement: string): string {
  const originalLines = (original.match(/\n/g) || []).length;
  const replacementLines = (replacement.match(/\n/g) || []).length;
  const deficit = originalLines - replacementLines;
  return deficit > 0 ? replacement + '\n'.repeat(deficit) : replacement;
}

interface SmilesCanvasProps {
  smiles: string;
  isDark: boolean;
  exportDPI: number;
}

// Local version of SmilesDrawerRenderer to match existing imports
const SmilesCanvas = ({ smiles, isDark, exportDPI }: SmilesCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && smiles) {
      const scale = exportDPI / 96;
      const options = {
        width: 400,
        height: 300,
        theme: isDark ? 'dark' : 'light',
      };
      
      const Drawer = SmilesDrawer.Drawer || (SmilesDrawer as any).default?.Drawer || SmilesDrawer;
      const parse = SmilesDrawer.parse || (SmilesDrawer as any).default?.parse;

      try {
        if (parse) {
          parse(smiles, (tree: any) => {
            if (typeof Drawer === 'function') {
               const drawer = new Drawer({ ...options, width: 400 * scale, height: 300 * scale });
               drawer.draw(tree, canvasRef.current, isDark ? 'dark' : 'light', false);
            }
          }, (err: any) => {
            console.error('Smiles parser error:', err);
          });
        } else {
           const drawer = new (SmilesDrawer as any)({ ...options, width: 400 * scale, height: 300 * scale });
           drawer.draw(smiles, canvasRef.current, isDark ? 'dark' : 'light', false);
        }
      } catch (err) {
        console.error('Smiles exception:', err);
      }
    }
  }, [smiles, isDark, exportDPI]);

  const scale = exportDPI / 96;
  return <canvas ref={canvasRef} style={{ width: 400, height: 300 }} />;
};

interface PreviewPaneProps {
  content: string;
  isDark: boolean;
  headerHeight?: number;
  exportDPI?: number;
  // NEW: già passate da App.tsx ma mai dichiarate qui — per questo scrollMap.ts
  // non trovava mai ne il container ne un modo per intercettare lo scroll manuale del preview.
  previewScrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

export function PreviewPane({ content, isDark, headerHeight, exportDPI = 300, previewScrollRef, onScroll }: PreviewPaneProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  // NEW: callback ref che assegna sia il ref interno (per future estensioni, es. ResizeObserver)
  // sia il previewScrollRef esterno che App.tsx usa per leggere/scrivere scrollTop.
  const setContainerRef = (node: HTMLDivElement | null) => {
    internalRef.current = node;
    if (previewScrollRef) {
      (previewScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
  };
  
  // Custom renderer for code blocks (for smiles-drawer and standard code formatting)
  const renderComponents = {
    code({ node, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      const isBlock = node?.position?.start.line !== node?.position?.end.line || className;
      const line = sourceLine(node); // NEW

      if (isBlock && match && match[1] === 'chem') {
        return (
          <div data-source-line={line} className="flex justify-center p-4 bg-white dark:bg-slate-panels rounded-md border border-slate-borderDark my-4 shadow-sm">
            <SmilesCanvas smiles={String(children).replace(/\n$/, '')} isDark={isDark} exportDPI={exportDPI} />
          </div>
        );
      }
      
      if (isBlock && match && match[1] === 'mermaid') {
        return (
          <div data-source-line={line}>
            <MermaidRenderer chart={String(children).replace(/\n$/, '')} isDark={isDark} />
          </div>
        );
      }
      
      if (isBlock) {
        return (
          <pre data-source-line={line} className="bg-slate-200 dark:bg-slate-panels p-4 rounded-md overflow-x-auto my-4 text-sm font-mono border border-slate-borderDark">
            <code className={className} {...props}>
              {children}
            </code>
          </pre>
        );
      }

      return (
        <code className="bg-slate-200 dark:bg-slate-panels px-1 py-0.5 rounded font-mono text-sm" {...props}>
          {children}
        </code>
      );
    },
    h1: ({node, children, ...props}: any) => {
      const text = extractTextFromChildren(children);
      return <h1 id={slugify(text)} data-source-line={sourceLine(node)} className="text-3xl font-bold mb-4 mt-6 text-cyan-accent" {...props}>{children}</h1>;
    },
    h2: ({node, children, ...props}: any) => {
      const text = extractTextFromChildren(children);
      return <h2 id={slugify(text)} data-source-line={sourceLine(node)} className="text-2xl font-semibold mb-3 mt-5 border-b border-slate-borderDark pb-2" {...props}>{children}</h2>;
    },
    h3: ({node, children, ...props}: any) => {
      const text = extractTextFromChildren(children);
      return <h3 id={slugify(text)} data-source-line={sourceLine(node)} className="text-xl font-semibold mb-3 mt-4 text-cyan-accent" {...props}>{children}</h3>;
    },
    // NEW: h4-h6 mancavano del tutto — niente id, niente ancora per lo scroll-sync/outline.
    h4: ({node, children, ...props}: any) => {
      const text = extractTextFromChildren(children);
      return <h4 id={slugify(text)} data-source-line={sourceLine(node)} className="text-lg font-semibold mb-2 mt-4" {...props}>{children}</h4>;
    },
    h5: ({node, children, ...props}: any) => {
      const text = extractTextFromChildren(children);
      return <h5 id={slugify(text)} data-source-line={sourceLine(node)} className="text-base font-semibold mb-2 mt-3" {...props}>{children}</h5>;
    },
    h6: ({node, children, ...props}: any) => {
      const text = extractTextFromChildren(children);
      return <h6 id={slugify(text)} data-source-line={sourceLine(node)} className="text-sm font-semibold mb-2 mt-3 opacity-80" {...props}>{children}</h6>;
    },
    p: ({node, ...props}: any) => <p data-source-line={sourceLine(node)} className="mb-4 leading-relaxed" {...props} />,
    ul: ({node, ...props}: any) => <ul data-source-line={sourceLine(node)} className="list-disc list-inside mb-4 space-y-1" {...props} />,
    ol: ({node, ...props}: any) => <ol data-source-line={sourceLine(node)} className="list-decimal list-inside mb-4 space-y-1" {...props} />,
    // NEW: densità aggiuntiva per liste lunghe — un'ancora per <li> invece di una sola per l'intera lista
    li: ({node, ...props}: any) => <li data-source-line={sourceLine(node)} {...props} />,
    blockquote: ({node, ...props}: any) => <blockquote data-source-line={sourceLine(node)} className="border-l-4 border-cyan-accent pl-4 italic opacity-80 my-4" {...props} />,
    // NEW: densità per tabelle (remark-gfm) — un'ancora per riga di tabella
    tr: ({node, ...props}: any) => <tr data-source-line={sourceLine(node)} {...props} />,
    a: ({node, ...props}: any) => <a className="text-cyan-accent hover:underline" {...props} />,
    div: ({node, ...props}: any) => {
      const rawClass = (props as any).className ?? (node as any)?.properties?.className ?? '';
      const cls = Array.isArray(rawClass) ? rawClass.join(' ') : String(rawClass);
      if (cls.includes('page-break') || cls.includes('pagebreak')) {
        return <div className="page-break" data-source-line={sourceLine(node)} style={{ display: 'block', borderTop: '2px dashed #38bdf8', margin: '1.5rem 0', height: 0 }} {...props} />;
      }
      return <div {...props} />;
    },
  };

  // Safe Math & Chemistry Pre-processor
  // This function intercepts $$...$$ and $...$ blocks and uses the native katex compiler directly
  const renderChemAndMath = (text: string) => {
    if (!text) return '';

    // 1. Process Block Math: $$\ce{...}$$ or $$...$$
    let processed = text.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (match, formula) => {
      try {
        const rendered = katex.renderToString(formula, { displayMode: true, trust: true, strict: false });
        const html = `<div class="katex-block-wrapper not-prose my-4 overflow-x-auto">${rendered}</div>`;
        return preserveLineCount(match, html); // NEW: mantiene allineate le righe successive
      } catch (err: any) {
        const html = `<div class="text-red-500 font-mono my-4">${err.message}</div>`;
        return preserveLineCount(match, html); // NEW
      }
    });

    // 2. Process Inline Math: $\ce{...}$ or $...$
    processed = processed.replace(/\$\s*([^\$\n]+?)\s*\$/g, (match, formula) => {
      try {
        const rendered = katex.renderToString(formula, { displayMode: false, trust: true, strict: false });
        return `<span>${rendered}</span>`;
      } catch (err: any) {
        return `<span class="text-red-500 font-mono">${err.message}</span>`;
      }
    });

    return processed;
  };

  const htmlContent = renderChemAndMath(content);
  const tocHTML = generateTOC(content);

  return (
    <div data-print-expand className="flex-1 flex flex-col h-full overflow-hidden bg-slate-light dark:bg-obsidian text-slate-dark dark:text-slate-light">
      <div data-print-hide className="flex items-center p-2 bg-slate-200 dark:bg-slate-panels border-b border-slate-borderDark shrink-0" style={headerHeight ? { minHeight: headerHeight } : undefined}>
        <span className="text-xs font-semibold px-2 uppercase tracking-widest text-slate-500">Live Preview</span>
      </div>
      <div
        ref={setContainerRef}
        onScroll={onScroll}
        className="flex-1 h-full overflow-y-auto p-8 font-sans markdown-preview preview-pane-container prose prose-invert max-w-none"
      >
        {tocHTML && (
          <div className="print-only" dangerouslySetInnerHTML={{ __html: tocHTML }} />
        )}
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]} 
          rehypePlugins={[rehypeRaw]}
          components={renderComponents}
        >
          {htmlContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
