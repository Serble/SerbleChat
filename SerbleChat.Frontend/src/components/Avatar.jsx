import { useState } from 'react';
import { getProfilePictureUrl } from '../api.js';
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
 */
export default function Avatar({ userId, name, size = 64, color, style = {} }) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const initial = name ? name[0].toUpperCase() : '?';
  const pfpUrl = userId ? getProfilePictureUrl(userId) : null;

  const baseStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    userSelect: 'none',
    position: 'relative',
    ...style,
  };

  // If no userId or image failed to load, show fallback
  if (!userId || imageError) {
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
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageError(true)}
      />
    </div>
  );
}
