import { MicIcon, SpeakerMutedIcon, BellOffIcon } from '../../icons.jsx';
import './voice.css';

/**
 * Button used across the voice UI.
 * tone: 'neutral' | 'danger' | 'success' | 'accent'; size="sm" for the small bordered style.
 */
export function VoiceButton({ tone = 'neutral', size, className, type = 'button', ...rest }) {
  const classes = ['voice-btn', size === 'sm' && 'voice-btn--sm', className].filter(Boolean).join(' ');
  return <button type={type} className={classes} data-tone={tone} {...rest} />;
}

/** Speaking / muted / muted-by-you indicators shown after a participant's name. */
export function VoiceStatusIcons({ isSpeaking, isMuted, isClientMuted, size = 12 }) {
  return (
    <>
      {isSpeaking && !isMuted && (
        <span style={{ color: 'var(--success)', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-flex' }} title="Speaking">
          <MicIcon size={size} />
        </span>
      )}
      {isMuted && (
        <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }} title="Muted">
          <SpeakerMutedIcon size={size} />
        </span>
      )}
      {isClientMuted && (
        <span style={{ color: 'var(--danger)', display: 'inline-flex' }} title="You muted this user">
          <BellOffIcon size={size} />
        </span>
      )}
    </>
  );
}
