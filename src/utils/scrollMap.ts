// src/utils/scrollMap.ts
// PanWriter-style dense pixel-to-pixel scroll maps.
// Maps editor scroll position (px) ↔ preview scroll position (px)

let scrollMap: number[] | undefined;
let reverseScrollMap: number[] | undefined;

export function buildScrollMap(): void {
  const scroller = document.querySelector('.cm-scroller') as HTMLElement | null;
  if (!scroller) return;

  const editorOffset = parseInt(
    window.getComputedStyle(scroller).getPropertyValue('padding-top'), 10
  ) || 0;

  // PanWriter-style: lineOffsets[line] = top pixel offset of line `line`
  // lineOffsets[1] = 0 (top of first line), lineOffsets[2] = h1, etc.
  const lineElements = scroller.querySelectorAll('.cm-line');
  const lineOffsets: number[] = [0, 0]; // [0]=unused, [1]=0 (top of line 1)
  let cumulative = 0;
  lineElements.forEach((el) => {
    cumulative += el.getBoundingClientRect().height;
    lineOffsets.push(cumulative);
  });
  // lineOffsets[N] now = cumulative height of lines 1..(N-1) = top of line N
  const totalHeight = cumulative;
  if (totalHeight === 0) return;

  const container = document.querySelector('.preview-pane-container') as HTMLElement | null;
  if (!container) return;

  const containerRect = container.getBoundingClientRect();
  const containerScrollTop = container.scrollTop;

  scrollMap = [];
  scrollMap[0] = 0;
  reverseScrollMap = [];

  const knownOffsets: number[] = [];
  let lastEl: Element | undefined;

  const els = container.querySelectorAll<HTMLElement>('[data-source-line]');
  for (const el of els) {
    const line = parseInt(el.getAttribute('data-source-line') || '1', 10);
    if (line < 1 || line >= lineOffsets.length) continue;

    const editorPx = lineOffsets[line];
    const previewPx = Math.round(
      el.getBoundingClientRect().top - containerRect.top + containerScrollTop
    );

    if (scrollMap[editorPx] === undefined) {
      scrollMap[editorPx] = previewPx - editorOffset;
      knownOffsets.push(editorPx);
    }
    lastEl = el;
  }

  if (lastEl) {
    const bottomPx = Math.ceil(
      lastEl.getBoundingClientRect().bottom - containerRect.top + containerScrollTop
    );
    scrollMap[totalHeight] = bottomPx;
    knownOffsets.push(totalHeight);
  }

  if (knownOffsets[0] !== 0) {
    knownOffsets.unshift(0);
  }

  let j = 0;
  for (let i = 1; i <= totalHeight; i++) {
    // Advance j while i has passed the next known offset
    while (j < knownOffsets.length - 1 && i >= knownOffsets[j + 1]) {
      j++;
    }
    if (scrollMap[i] === undefined) {
      const a = knownOffsets[j];
      const b = knownOffsets[j + 1];
      if (a !== undefined && b !== undefined && b !== a) {
        scrollMap[i] = Math.round(
          (scrollMap[b] * (i - a) + scrollMap[a] * (b - i)) / (b - a)
        );
      } else if (a !== undefined && j + 1 >= knownOffsets.length) {
        // Beyond the last known offset: extrapolate using the last slope
        const prevI = i - 1;
        if (scrollMap[prevI] !== undefined && knownOffsets[j] !== undefined) {
          const prevA = knownOffsets[j];
          const slope = scrollMap[prevI] - scrollMap[prevA];
          scrollMap[i] = scrollMap[prevI] + slope;
        }
      }
    }
    if (scrollMap[i] !== undefined) {
      reverseScrollMap![scrollMap[i]] = i;
    }
  }
}

export function getPreviewScrollTop(editorScrollTop: number, editorMaxScrollTop?: number): number | undefined {
  if (!scrollMap) return undefined;
  // NEW: lo scrollTop reale dell'editor non raggiunge mai `totalHeight` (manca l'altezza
  // del viewport), quindi l'ultimo valore della mappa (il vero fondo del preview) non
  // verrebbe mai restituito. Quando l'editor è al proprio fondo reale, clampa al fondo.
  if (editorMaxScrollTop !== undefined && editorScrollTop >= editorMaxScrollTop - 2) {
    for (let i = scrollMap.length - 1; i >= 0; i--) {
      if (scrollMap[i] !== undefined) return scrollMap[i];
    }
  }
  return scrollMap[Math.round(editorScrollTop)];
}

export function getEditorScrollTop(previewScrollTop: number, previewMaxScrollTop?: number): number | undefined {
  if (!reverseScrollMap) return undefined;
  // NEW: stesso clamp, in direzione preview -> editor
  if (previewMaxScrollTop !== undefined && previewScrollTop >= previewMaxScrollTop - 2) {
    for (let i = reverseScrollMap.length - 1; i >= 0; i--) {
      if (reverseScrollMap[i] !== undefined) return reverseScrollMap[i];
    }
  }
  const start = Math.round(previewScrollTop);
  for (let i = start; i >= 0; i--) {
    if (reverseScrollMap[i] !== undefined) {
      return reverseScrollMap[i];
    }
  }
  return undefined;
}

export function resetScrollMap(): void {
  scrollMap = undefined;
  reverseScrollMap = undefined;
}
