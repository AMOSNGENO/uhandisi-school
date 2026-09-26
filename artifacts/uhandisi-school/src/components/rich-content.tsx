import DOMPurify from 'dompurify';

// Video embeds are the only iframes allowed through.
const allowedFrames = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//;
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'iframe' && !allowedFrames.test((node as Element).getAttribute('src') || '')) node.parentNode?.removeChild(node);
});
DOMPurify.addHook('afterSanitizeAttributes', node => {
  // Links open in a new tab without giving that tab access to ours.
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
});

/** Shows admin-written HTML safely: scripts and event handlers are stripped. */
export default function RichContent({ html, className = '' }: { html: string; className?: string }) {
  const clean = DOMPurify.sanitize(html, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'target'] });
  return <div
    className={`prose max-w-none prose-headings:font-display prose-headings:text-[hsl(var(--foreground))] prose-p:text-[hsl(var(--foreground))] prose-li:text-[hsl(var(--foreground))] prose-strong:text-[hsl(var(--foreground))] prose-a:text-[hsl(var(--link))] prose-img:rounded-md prose-table:text-sm [&_iframe]:aspect-video [&_iframe]:h-auto [&_iframe]:w-full [&_iframe]:rounded-md ${className}`}
    dangerouslySetInnerHTML={{ __html: clean }}
  />;
}
