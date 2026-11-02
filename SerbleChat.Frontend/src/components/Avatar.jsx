import { useState } from 'react';
import { getProfilePictureUrl } from '../api.js';
import { useAvatarVersion } from '../imageVersions.js';
import { avatarBg } from '../userColor.js';

/**
 * Avatar component that displays a profile picture if available,
 * or falls back to a colored circle with the user's initial.
 * 
 * @param {Object} props
 * @param {string} props.userId - The user's ID (for fetching profile picture)
 * @param {string} props.name - The user's display name
 * @param {number} [props.size=64] - Avatar size in pixels
 * @param {string} [props.color] - Optional custom color for the fallback avatar
 * @param {Object} [props.style] - Additional inline styles
 * @param {string} [props.src] - Image to show instead of the user's profile picture (e.g. a webhook avatar)
 */
export default function Avatar({ userId, name, size = 64, color, style = {}, src }) {
  // The version changes when they change their picture, which changes the URL (see imageVersions.js)
  const version = useAvatarVersion(userId);
  const pfpUrl = src ?? (userId ? getProfilePictureUrl(userId, version) : null);

  // Load state belongs to one URL: a new picture starts over rather than staying on the old failure
  const [state, setState] = useState({ url: pfpUrl, error: false, loaded: false });
  if (state.url !== pfpUrl) setState({ url: pfpUrl, error: false, loaded: false });
  const imageError = state.url === pfpUrl && state.error;
  const imageLoaded = state.url === pfpUrl && state.loaded;
  const setImageError = () => setState(s => (s.url === pfpUrl ? { ...s, error: true } : s));
  const setImageLoaded = () => setState(s => (s.url === pfpUrl ? { ...s, loaded: true } : s));

  const initial = name ? name[0].toUpperCase() : '?';

  const baseStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    userSelect: 'none',
    position: 'relative',
    ...style,
  };

  // If there's no image or it failed to load, show fallback
  if (!pfpUrl || imageError) {
    return (
      <div
        style={{
          ...baseStyle,
          background: avatarBg(name, color),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: size * 0.42,
        }}
      >
        {initial}
      </div>
    );
  }

  return (
    <div style={baseStyle}>
      {/* Fallback background shown while image loads */}
      {!imageLoaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: avatarBg(name, color),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: size * 0.42,
          }}
        >
          {initial}
        </div>
      )}
      {/* Profile picture */}
      <img
        src={pfpUrl}
        alt={`${name}'s avatar`}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          objectFit: 'cover',
          display: imageLoaded ? 'block' : 'none',
        }}
        onLoad={setImageLoaded}
        onError={setImageError}
      />
    </div>
  );
}
