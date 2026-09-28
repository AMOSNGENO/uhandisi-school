// Reads a PDF like an open book: two facing pages on wide screens, one on phones.
// Pages are drawn onto canvases with PDF.js, so there is no browser PDF toolbar, download button
// or selectable text. (Nothing on screen can be fully protected; this removes the easy routes.)
// Loaded lazily, only when a student opens a PDF.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Two facing pages when each can be at least this wide; otherwise one page at a time.
const MIN_SPREAD_PAGE_WIDTH = 340;

function PdfPage({ doc, number, width }: { doc: PDFDocumentProxy; number: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.3);
  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    doc.getPage(number).then(page => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const el = canvas.current;
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      task = page.render({ canvasContext: el.getContext('2d')!, viewport });
      task.promise.catch(() => { /* cancelled by a newer render */ });
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, number, width]);
  return <canvas ref={canvas} style={{ width, height: width * ratio }} className="block bg-white" aria-label={`Page ${number}`} />;
}

export default function BookReader({ url, title }: { url: string; title: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [boxWidth, setBoxWidth] = useState(0);
  const [turn, setTurn] = useState<'next' | 'prev' | ''>('');
  const [full, setFull] = useState(false);
  const [ratio, setRatio] = useState(1.414);
  const [viewHeight, setViewHeight] = useState(() => window.innerHeight);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const storeKey = `book-page:${url}`;

  // Open the book, resuming where this reader stopped last time.
  useEffect(() => {
    let active = true;
    const task = pdfjs.getDocument({ url, withCredentials: true });
    task.onProgress = ({ loaded: l, total }: { loaded: number; total: number }) => { if (total) setLoaded(Math.round((l / total) * 100)); };
    task.promise.then(d => {
      if (!active) return;
      setDoc(d);
      d.getPage(1).then(p => { const v = p.getViewport({ scale: 1 }); if (active) setRatio(v.height / v.width); });
      try { const saved = Number(localStorage.getItem(storeKey)); if (saved >= 1 && saved <= d.numPages) setPage(saved); } catch { /* storage unavailable */ }
    }).catch(() => active && setError('This book could not be opened. Refresh the page to try again.'));
    return () => { active = false; task.destroy(); };
  }, [url, storeKey]);

  useEffect(() => { try { localStorage.setItem(storeKey, String(page)); } catch { /* storage unavailable */ } }, [page, storeKey]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    const onResize = () => setViewHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const total = doc?.numPages ?? 0;
  // Whole pages fit the screen height, like an open book; zooming switches to one large page.
  const heightBudget = Math.max(320, full ? viewHeight - 110 : viewHeight * 0.78);
  const spread = zoom === 1 && total > 1 && (boxWidth - 8) / 2 >= MIN_SPREAD_PAGE_WIDTH;
  const step = spread ? 2 : 1;
  // In two-page view the book opens on pages 1–2, 3–4, …
  const left = spread ? (page % 2 === 0 ? page - 1 : page) : page;
  const right = spread && left + 1 <= total ? left + 1 : null;
  const widthBudget = spread ? (boxWidth - 8) / 2 : Math.min(boxWidth, 900);
  const pageWidth = Math.max(200, Math.floor(zoom === 1 ? Math.min(widthBudget, heightBudget / ratio) : widthBudget * zoom));

  const go = useCallback((target: number, dir: 'next' | 'prev') => {
    if (!total) return;
    const clamped = Math.min(Math.max(1, target), total);
    if (clamped === left) return;
    setTurn(dir);
    setPage(clamped);
    stage.current?.scrollTo({ top: 0 });
  }, [total, left]);
  const next = () => go(left + step, 'next');
  const prev = () => go(left - step, 'prev');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Swipe to turn pages on phones.
  const touch = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = zoom === 1 ? e.touches[0]!.clientX : null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touch.current === null) return;
    const dx = e.changedTouches[0]!.clientX - touch.current;
    if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev(); }
    touch.current = null;
  };

  const btn = 'grid size-10 place-items-center rounded-full bg-white/90 text-[hsl(var(--foreground))] shadow transition hover:bg-white disabled:opacity-30';
  return <div ref={box} className={`select-none rounded-xl bg-[#e9e4da] ${full ? 'flex h-screen flex-col p-4' : 'p-3 sm:p-5'}`}
    onContextMenu={e => e.preventDefault()} data-testid="book-reader">
    <div ref={stage} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      className={`relative ${zoom > 1 ? 'overflow-auto' : 'overflow-hidden'} ${full ? 'min-h-0 flex-1' : 'max-h-[82vh]'}`} aria-live="polite">
      {error ? <p className="p-10 text-center text-sm text-[hsl(var(--destructive))]" role="alert">{error}</p>
        : !doc ? <div className="grid h-[60vh] place-items-center text-center text-sm text-[hsl(var(--muted-foreground))]" data-testid="book-loading">
          <div><div className="mx-auto mb-3 h-2 w-48 overflow-hidden rounded-full bg-white/70"><div className="h-full bg-[hsl(var(--link))] transition-all" style={{ width: `${Math.max(loaded, 8)}%` }} /></div>Opening “{title}”…</div>
        </div>
          : boxWidth > 0 && <div key={left} className={`mx-auto flex w-fit justify-center ${turn === 'next' ? 'animate-[book-next_.35s_ease-out]' : turn === 'prev' ? 'animate-[book-prev_.35s_ease-out]' : ''}`}>
            <div className="relative shadow-[0_6px_24px_rgba(0,0,0,.18)]">
              <PdfPage doc={doc} number={left} width={pageWidth} />
              {spread && <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black/15 to-transparent" />}
            </div>
            {right && <div className="relative shadow-[0_6px_24px_rgba(0,0,0,.18)]">
              <PdfPage doc={doc} number={right} width={pageWidth} />
              <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/15 to-transparent" />
            </div>}
          </div>}
    </div>
    {doc && <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:gap-3" data-testid="book-controls">
      <button onClick={prev} disabled={left <= 1} className={btn} aria-label="Previous page" data-testid="book-prev"><ChevronLeft size={20} /></button>
      <label className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-2 text-xs font-bold shadow">
        Page
        <input type="number" min={1} max={total} value={left} onChange={e => go(Number(e.target.value), Number(e.target.value) > left ? 'next' : 'prev')}
          className="w-12 rounded border border-[hsl(var(--input))] px-1 text-center font-mono-ui" aria-label="Go to page" data-testid="book-page-input" />
        {right ? <span>– {right}</span> : null}<span className="font-normal text-[hsl(var(--muted-foreground))]">of {total}</span>
      </label>
      <button onClick={next} disabled={(right ?? left) >= total} className={btn} aria-label="Next page" data-testid="book-next"><ChevronRight size={20} /></button>
      <span className="mx-1 hidden h-6 w-px bg-black/10 sm:block" />
      <button onClick={() => setZoom(z => Math.max(1, +(z - 0.25).toFixed(2)))} disabled={zoom <= 1} className={btn} aria-label="Zoom out"><ZoomOut size={17} /></button>
      <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} disabled={zoom >= 3} className={btn} aria-label="Zoom in"><ZoomIn size={17} /></button>
      <button onClick={() => (full ? document.exitFullscreen() : box.current?.requestFullscreen?.())} className={btn} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
    </div>}
  </div>;
}
