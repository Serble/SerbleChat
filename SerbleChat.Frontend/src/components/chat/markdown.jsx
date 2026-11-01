import { useNavigate } from 'react-router-dom';
import { openExternalLink } from '../../electron-utils.js';
import { INVITE_RE, MESSAGE_RE, FILE_RE } from './utils.js';

function MarkdownLink({ href, children }) {
  const nav = useNavigate();
  // Links that render as embeds (invites, message links, files) stay in-app;
  // everything else opens externally.
  const isEmbedLink = href && (INVITE_RE().test(href) || MESSAGE_RE().test(href) || FILE_RE().test(href));
  const handleClick = (e) => {
    e.stopPropagation();
    // Message links jump within the app instead of reloading the page
    const messageLink = href && MESSAGE_RE().exec(href);
    if (messageLink) {
      e.preventDefault();
      nav(`/app/channel/${messageLink[1]}?message=${messageLink[2]}`);
      return;
    }
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
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

// Markdown component overrides. Everything else is styled by the .msg-md rules in chat.css.
export const mdComponents = {
  a: MarkdownLink,
};
