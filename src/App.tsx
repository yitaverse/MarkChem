import { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { EditorPane } from "./components/EditorPane";
import { PreviewPane } from "./components/PreviewPane";
import { TocPane } from "./components/TocPane";
import { Titlebar } from "./components/Titlebar";
import { AIAssistantPane } from "./components/AIAssistantPane";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { htmlToDocx } from "wp-html-to-docx";
import { X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { extractHeadings } from "./utils/printTOC";
import { buildScrollMap, getPreviewScrollTop, getEditorScrollTop, resetScrollMap } from "./utils/scrollMap";

const DEFAULT_CONTENT = `# MarkChem

Welcome to MarkChem, a specialized Markdown editor for chemists and researchers.

## Chemical Equations

Use KaTeX with mhchem to render chemical equations:

$$
\\ce{CO2 + C <=> 2CO}
$$

Inline equations work too: $\\ce{H2O}$ is water.

## Molecular Structures

Use the \`chem\` language block to render 2D molecules from SMILES strings:

\`\`\`chem
CC(=O)OC1=CC=CC=C1C(=O)O
\`\`\`

Above is Aspirin.
`;

export type ViewMode = 'split' | 'editor' | 'preview';

export interface TabInfo {
  path: string;
  name: string;
}

// Remarkable-style: debounce + cancel+restart animation
let previewAnimFrame: number | null = null;
let editorAnimFrame: number | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function animateTo(el: HTMLElement, target: number, key: 'preview' | 'editor') {
  // .stop(true) — cancel current animation on this element
  if (key === 'editor') {
    if (editorAnimFrame !== null) { cancelAnimationFrame(editorAnimFrame); editorAnimFrame = null; }
  } else {
    if (previewAnimFrame !== null) { cancelAnimationFrame(previewAnimFrame); previewAnimFrame = null; }
  }

  const start = el.scrollTop;
  const delta = target - start;
  if (Math.abs(delta) < 0.5) return;
  const start_time = performance.now();
  const duration = 100;

  const step = (now: number) => {
    const t = Math.min((now - start_time) / duration, 1);
    el.scrollTop = start + delta * t; // linear easing
    if (t < 1) {
      const id = requestAnimationFrame(step);
      if (key === 'editor') editorAnimFrame = id;
      else previewAnimFrame = id;
    } else {
      if (key === 'editor') editorAnimFrame = null;
      else previewAnimFrame = null;
    }
  };
  const id = requestAnimationFrame(step);
  if (key === 'editor') editorAnimFrame = id;
  else previewAnimFrame = id;
}

function App() {
  const [openTabs, setOpenTabs] = useState<TabInfo[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [filesContent, setFilesContent] = useState<Record<string, string>>({});
  const [savedFilesContent, setSavedFilesContent] = useState<Record<string, string>>({});

  const [defaultContent, setDefaultContent] = useState(DEFAULT_CONTENT);

  const [isDark, setIsDark] = useState(true);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(0);
  const [exportDPI, setExportDPI] = useState(300);
  const [activeHeadingSlug, setActiveHeadingSlug] = useState<string | null>(null);
  const activeHeadingSlugRef = useRef<string | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const isNavigatingRef = useRef(false);
  const isEditorFocusedRef = useRef(false);
  const editorHeaderRef = useRef<HTMLDivElement>(null);
  const lastGoodHeaderHeight = useRef(0);

  useEffect(() => { activeHeadingSlugRef.current = activeHeadingSlug; }, [activeHeadingSlug]);

  const syncHeaderHeight = useCallback(() => {
    if (editorHeaderRef.current) {
      const h = editorHeaderRef.current.offsetHeight;
      if (h > 0) {
        lastGoodHeaderHeight.current = h;
        setHeaderHeight(h);
      } else if (lastGoodHeaderHeight.current > 0) {
        setHeaderHeight(lastGoodHeaderHeight.current);
      }
    }
  }, []);

  useEffect(() => {
    const el = editorHeaderRef.current;
    if (!el) return;
    syncHeaderHeight();
    const observer = new ResizeObserver(syncHeaderHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncHeaderHeight, viewMode]);

  useEffect(() => {
    if (isDark) {
      document.body.classList.add('dark');
      document.body.classList.remove('light');
    } else {
      document.body.classList.add('light');
      document.body.classList.remove('dark');
    }
  }, [isDark]);

  const currentContent = activeTabPath ? (filesContent[activeTabPath] || '') : defaultContent;
  const [debouncedContent, setDebouncedContent] = useState(currentContent);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedContent(currentContent);
    }, 300);
    return () => clearTimeout(handler);
  }, [currentContent]);

  // Rebuild scroll map after preview DOM updates
  useEffect(() => {
    const timer = setTimeout(() => {
      buildScrollMap();
    }, 350);
    return () => clearTimeout(timer);
  }, [debouncedContent]);

  // Rebuild scroll map on window resize (PanWriter behavior)
  useEffect(() => {
    const onResize = () => {
      resetScrollMap();
      buildScrollMap();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [debouncedContent]);

  const handleContentChange = (newContent: string) => {
    if (activeTabPath) {
      setFilesContent(prev => ({ ...prev, [activeTabPath]: newContent }));
    } else {
      setDefaultContent(newContent);
    }
  };

  const findClosestHeadingForLine = useCallback((line: number) => {
    const headings = extractHeadings(currentContent);
    if (headings.length === 0) return null;
    let closest = headings[0];
    for (const h of headings) {
      if (h.line <= line) closest = h;
      else break;
    }
    return closest;
  }, [currentContent]);

  const findVisiblePreviewHeading = useCallback(() => {
    const container = previewScrollRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const headings = container.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]');
    if (headings.length === 0) return null;
    const threshold = containerRect.top + containerRect.height * 0.4;
    let best = '';
    let bestTop = -Infinity;
    headings.forEach((h) => {
      const rect = h.getBoundingClientRect();
      if (rect.top <= threshold && rect.top > bestTop) {
        bestTop = rect.top;
        best = h.id;
      }
    });
    if (!best && headings.length > 0) best = (headings[0] as HTMLElement).id;
    return best || null;
  }, []);

  const handleNavigate = useCallback((line: number) => {
    isNavigatingRef.current = true;
    setScrollToLine(line);

    // Also scroll preview to the closest heading at this line
    const heading = findClosestHeadingForLine(line);
    if (heading) {
      setActiveHeadingSlug(heading.slug);
      const container = previewScrollRef.current;
      if (container) {
        const el = container.querySelector(`#${CSS.escape(heading.slug)}`) as HTMLElement;
        if (el) {
          const containerTop = container.getBoundingClientRect().top;
          const elTop = el.getBoundingClientRect().top;
          const offset = container.scrollTop + (elTop - containerTop) - 40;
          container.scrollTop = Math.max(0, offset);
        }
      }
    }

    setTimeout(() => {
      setScrollToLine(null);
      setTimeout(() => { isNavigatingRef.current = false; }, 300);
    }, 100);
  }, [findClosestHeadingForLine]);

  // --- Remarkable-style scroll sync: debounce + animate ---
  const handleEditorPixelScroll = useCallback((_editorScrollTop: number) => {
    if (isNavigatingRef.current) return;

    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      const container = previewScrollRef.current;
      if (!container) return;
      const scroller = document.querySelector('.cm-scroller') as HTMLElement | null;
      if (!scroller) return;
      const targetY = getPreviewScrollTop(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight);
      if (targetY === undefined) return;
      animateTo(container, targetY, 'preview');
    }, 50);
  }, []);

  // Editor line change → outline sync
  const handleEditorScroll = useCallback((topLine: number) => {
    if (isNavigatingRef.current) return;
    if (!isEditorFocusedRef.current) {
      const heading = findClosestHeadingForLine(topLine);
      if (heading && heading.slug !== activeHeadingSlugRef.current) {
        setActiveHeadingSlug(heading.slug);
      }
    }
  }, [findClosestHeadingForLine]);

  const handleCursorLineChange = useCallback((line: number) => {
    if (isNavigatingRef.current) return;
    const heading = findClosestHeadingForLine(line);
    if (heading && heading.slug !== activeHeadingSlugRef.current) {
      setActiveHeadingSlug(heading.slug);
    }
  }, [findClosestHeadingForLine]);

  // Preview scroll → sync editor + outline
  const handlePreviewScroll = useCallback(() => {
    if (isNavigatingRef.current) return;
    const slug = findVisiblePreviewHeading();
    if (slug && slug !== activeHeadingSlugRef.current) {
      setActiveHeadingSlug(slug);
    }

    // Debounce preview→editor sync too
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      const container = previewScrollRef.current;
      if (!container) return;
      const targetEditorPx = getEditorScrollTop(container.scrollTop, container.scrollHeight - container.clientHeight);
      if (targetEditorPx === undefined) return;
      const scroller = document.querySelector('.cm-scroller') as HTMLElement | null;
      if (!scroller) return;
      animateTo(scroller, targetEditorPx, 'editor');
    }, 50);
  }, [findVisiblePreviewHeading]);

  const handleFileOpen = (fileContent: string, path: string) => {
    const name = path.split(/[\\/]/).pop() || 'Untitled';
    setOpenTabs(prev => {
      if (!prev.find(t => t.path === path)) {
        return [...prev, { path, name }];
      }
      return prev;
    });
    setFilesContent(prev => ({ ...prev, [path]: fileContent }));
    setSavedFilesContent(prev => ({ ...prev, [path]: fileContent }));
    setActiveTabPath(path);
  };

  const closeTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.path !== path);
      if (activeTabPath === path) {
        if (newTabs.length > 0) {
          setActiveTabPath(newTabs[newTabs.length - 1].path);
        } else {
          setActiveTabPath(null);
        }
      }
      return newTabs;
    });
  };

  const handleFileSave = async () => {
    const content = activeTabPath ? (filesContent[activeTabPath] || '') : currentContent;
    if (activeTabPath && isTauri()) {
      try {
        await writeTextFile(activeTabPath, content);
        setSavedFilesContent(prev => ({ ...prev, [activeTabPath]: content }));
        return;
      } catch (err) {
        console.error("Failed to save file", err);
      }
    }
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeTabPath ? (activeTabPath.split(/[\\/]/).pop() || 'document.md') : 'document.md';
    a.click();
    URL.revokeObjectURL(url);
    if (activeTabPath) setSavedFilesContent(prev => ({ ...prev, [activeTabPath]: content }));
  };

  const handleExportMd = async () => {
    try {
      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const selected = await save({
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          defaultPath: 'document.md'
        });
        if (selected) {
          await writeTextFile(selected, currentContent);
          if (!activeTabPath) {
            handleFileOpen(currentContent, selected);
          }
        }
      } else {
        const blob = new Blob([currentContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'document.md';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Failed to export MD", err);
    }
  };

  const handleExportDocx = async () => {
    try {
      const markdownBody = document.querySelector('.preview-pane-container');
      if (!markdownBody) {
        console.error("Preview pane not found");
        return;
      }
      
      const htmlString = markdownBody.innerHTML;
      const fullHtml = `
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"></head>
          <body>${htmlString}</body>
        </html>
      `;
      
      const docxBuffer = await htmlToDocx(fullHtml, null, {
        title: 'MarkChem Document',
      });
      
      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const savePath = await save({
          filters: [{ name: 'Word Document', extensions: ['docx'] }],
          defaultPath: 'document.docx'
        });
        
        if (savePath) {
          let uint8Array;
          if (docxBuffer instanceof Blob) {
            uint8Array = new Uint8Array(await docxBuffer.arrayBuffer());
          } else {
            uint8Array = new Uint8Array(docxBuffer);
          }
          await writeFile(savePath, uint8Array);
        }
      } else {
        let blob: Blob;
        if (docxBuffer instanceof Blob) {
          blob = docxBuffer;
        } else {
          blob = new Blob([docxBuffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'document.docx';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to export DOCX:', err);
    }
  };

  const toggleTheme = () => setIsDark(!isDark);

  return (
    <div data-print-expand className="flex flex-col w-full h-screen overflow-hidden text-slate-dark dark:text-slate-light">
      {isTauri() && <Titlebar />}
      <div data-print-expand className="flex flex-1 overflow-hidden">
        <Sidebar 
          onFileOpen={handleFileOpen}
          onFileSave={handleFileSave}
          onExportMd={handleExportMd}
          onExportDocx={handleExportDocx}
          onToggleAI={() => setIsAIOpen(!isAIOpen)}
          currentFile={activeTabPath}
          isDark={isDark}
          toggleTheme={toggleTheme}
          viewMode={viewMode}
          setViewMode={setViewMode}
          exportDPI={exportDPI}
          setExportDPI={setExportDPI}
        />
        <div data-print-expand className="flex flex-col flex-1 overflow-hidden relative">
        {/* TABS BAR */}
        {openTabs.length > 0 && (
          <div data-print-hide className="flex items-center overflow-x-auto bg-slate-200 dark:bg-slate-panels border-b border-slate-borderDark shrink-0">
            {openTabs.map(tab => {
              const isDirty = (filesContent[tab.path] || '') !== (savedFilesContent[tab.path] || '');
              return (
                <div 
                  key={tab.path}
                  onClick={() => setActiveTabPath(tab.path)}
                  className={`flex items-center gap-2 px-4 py-2 border-r border-slate-borderDark text-sm cursor-pointer transition-colors max-w-[200px] group ${
                    activeTabPath === tab.path 
                      ? 'bg-slate-light dark:bg-obsidian border-t-2 border-t-cyan-accent text-slate-dark dark:text-slate-light' 
                      : 'hover:bg-slate-300 dark:hover:bg-slate-borderDark text-slate-500'
                  }`}
                >
                  <span className="truncate" title={tab.path}>{isDirty ? '* ' : ''}{tab.name}</span>
                  <button 
                    onClick={(e) => closeTab(e, tab.path)}
                    className="p-0.5 rounded-sm hover:bg-slate-400 dark:hover:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div data-print-expand className="flex flex-1 overflow-hidden">
          <div className={`flex-1 overflow-hidden flex flex-col ${viewMode === 'preview' ? 'hidden' : 'block'}`}>
            <EditorPane 
              value={currentContent} 
              onChange={handleContentChange} 
              isDark={isDark} 
              scrollToLine={scrollToLine}
              headerRef={editorHeaderRef}
              onTopLineChange={handleEditorScroll}
              onEditorScroll={handleEditorPixelScroll}
              onCursorLineChange={handleCursorLineChange}
              onFocusChange={(focused) => { isEditorFocusedRef.current = focused; }}
            />
          </div>
          <div data-print-expand className={`flex-1 overflow-hidden flex flex-col ${viewMode === 'editor' ? 'hidden' : 'block'}`}>
            <PreviewPane 
              content={debouncedContent} 
              isDark={isDark}
              headerHeight={headerHeight}
              exportDPI={exportDPI}
              previewScrollRef={previewScrollRef}
              onScroll={handlePreviewScroll}
            />
          </div>
          <TocPane 
            content={currentContent} 
            onNavigate={handleNavigate}
            onHeadingClick={(slug) => {
              const container = previewScrollRef.current;
              if (container) {
                const el = container.querySelector(`#${CSS.escape(slug)}`) as HTMLElement;
                if (el) {
                  const containerTop = container.getBoundingClientRect().top;
                  const elTop = el.getBoundingClientRect().top;
                  container.scrollTop = container.scrollTop + (elTop - containerTop) - 40;
                  setActiveHeadingSlug(slug);
                }
              }
            }}
            activeHeadingSlug={activeHeadingSlug}
          />
          
          {isAIOpen && (
            <AIAssistantPane 
              currentContext={currentContent} 
              onClose={() => setIsAIOpen(false)} 
            />
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

export default App;
