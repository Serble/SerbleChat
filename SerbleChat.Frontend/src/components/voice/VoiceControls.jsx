import { MicIcon, MicOffIcon, HeadphonesOffIcon, BellOffIcon, VideoOffIcon } from '../../icons.jsx';
import './voice.css';

/**
 * Button used across the voice UI.
 * tone: 'neutral' | 'danger' | 'success' | 'accent'; size="sm" for the small bordered style.
 */
export function VoiceButton({ tone = 'neutral', size, className, type = 'button', ...rest }) {
  const classes = ['voice-btn', size === 'sm' && 'voice-btn--sm', className].filter(Boolean).join(' ');
  return <button type={type} className={classes} data-tone={tone} {...rest} />;
}

/** Speaking / muted / deafened / muted-by-you / video-off-by-you indicators shown after a participant's name. */
export function VoiceStatusIcons({ isSpeaking, isMuted, isDeafened, isClientMuted, isVideoDisabled, size = 12 }) {
  return (
    <>
      {isSpeaking && !isMuted && !isDeafened && (
        <span style={{ color: 'var(--success)', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-flex' }} title="Speaking">
          <MicIcon size={size} />
        </span>
      )}
      {/* Deafened implies muted, so only show the stronger of the two */}
      {isDeafened ? (
        <span style={{ color: 'var(--danger)', display: 'inline-flex' }} title="Deafened">
          <HeadphonesOffIcon size={size} />
        </span>
      ) : isMuted && (
        <span style={{ color: 'var(--danger)', display: 'inline-flex' }} title="Muted">
          <MicOffIcon size={size} />
        </span>
      )}
      {isClientMuted && (
        <span style={{ color: 'var(--danger)', display: 'inline-flex' }} title="You muted this user">
          <BellOffIcon size={size} />
        </span>
      )}
      {isVideoDisabled && (
        <span style={{ color: 'var(--danger)', display: 'inline-flex' }} title="You turned off this user's video">
          <VideoOffIcon size={size} />
        </span>
      )}
    </>
  );
}
