import { openExternalLink } from '../../electron-utils.js';
import { INVITE_RE, MESSAGE_RE, FILE_RE } from './utils.js';

function MarkdownLink({ href, children }) {
  // Links that render as embeds (invites, message links, files) stay in-app;
  // everything else opens externally.
  const isEmbedLink = href && (INVITE_RE().test(href) || MESSAGE_RE().test(href) || FILE_RE().test(href));
  const handleClick = (e) => {
    e.stopPropagation();
    if (!isEmbedLink && href) {
      e.preventDefault();
      openExternalLink(href);
    }
  };
  return (
    <a
      href={href}
      target={isEmbedLink ? '_self' : '_blank'}
      rel="noopener noreferrer"
      style={{ color: 'var(--text-link)', textDecoration: 'underline' }}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

// Markdown component overrides styled for the chat theme
export const mdComponents = {
  p:          ({ children }) => <span style={{ display: 'block', margin: '0 0 0.45em' }}>{children}</span>,
  a:          MarkdownLink,
  strong:     ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
  em:         ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  del:        ({ children }) => <del style={{ textDecoration: 'line-through', opacity: 0.7 }}>{children}</del>,
  code:       ({ inline, children }) => inline
    ? <code style={{ background: 'var(--bg-secondary)', borderRadius: 3, padding: '0.1em 0.35em', fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--text-secondary)' }}>{children}</code>
    : <code>{children}</code>,
  pre:        ({ children }) => <pre style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '0.6rem 0.8rem', overflowX: 'auto', margin: '0.3rem 0', fontSize: '0.85em', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{children}</pre>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--text-subtle)', paddingLeft: '0.6rem', margin: '0.2rem 0', color: 'var(--text-secondary)' }}>{children}</blockquote>,
  ul:         ({ children }) => <ul style={{ paddingLeft: '1.2em', margin: '0.2rem 0' }}>{children}</ul>,
  ol:         ({ children }) => <ol style={{ paddingLeft: '1.2em', margin: '0.2rem 0' }}>{children}</ol>,
  li:         ({ children }) => <li style={{ margin: '0.1rem 0' }}>{children}</li>,
  h1:         ({ children }) => <strong style={{ fontSize: '1.1em', display: 'block' }}>{children}</strong>,
  h2:         ({ children }) => <strong style={{ fontSize: '1.05em', display: 'block' }}>{children}</strong>,
  h3:         ({ children }) => <strong style={{ fontSize: '1em', display: 'block' }}>{children}</strong>,
};
