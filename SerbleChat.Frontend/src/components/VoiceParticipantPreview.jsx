import { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { requestFullscreenWithElectronSupport, exitFullscreenWithElectronSupport } from '../electron-utils.js';
import Avatar from './Avatar.jsx';
import UserInteraction from './UserInteraction.jsx';
import { VoiceButton, VoiceStatusIcons } from './voice/VoiceControls.jsx';
import { MicIcon, ScreenShareIcon, VideoIcon, VideoOffIcon, PlusIcon, MinusIcon, SpeakerIcon, SpeakerMutedIcon, PopOutIcon, PopInIcon } from '../icons.jsx';
import { canPopOut, closePopout, popOutStream, popoutKey, usePoppedOutStreams } from '../streamPopout.js';
import { ContextMenu, MenuItem, MenuDivider, Slider } from './ui/index.js';
import VoicePollStrip from './poll/VoicePollStrip.jsx';
import { useStreamZoom } from './voice/useStreamZoom.js';

// Calculate optimal grid layout to maximize stream size
function calculateOptimalGrid(numStreams, containerWidth, containerHeight) {
  if (numStreams === 0) return { cols: 1, rows: 1 };
  if (numStreams === 1) return { cols: 1, rows: 1 };
  
  let bestLayout = { cols: 1, rows: numStreams, area: 0 };
  
  // Try all possible grid configurations
  for (let cols = 1; cols <= numStreams; cols++) {
    const rows = Math.ceil(numStreams / cols);
    
    // Account for gaps between items (0.75rem = 12px)
    const gapSize = 12;
    const totalGapWidth = Math.max(0, (cols - 1) * gapSize);
    const totalGapHeight = Math.max(0, (rows - 1) * gapSize);
    
    // Account for tile padding (0.75rem = 12px on each side, so 24px total per tile)
    const tilePaddingWidth = 12 * 2; // left + right padding per tile
    const tilePaddingHeight = 12 * 2; // top + bottom padding per tile
    
    // Calculate available space for actual video content (without padding/gaps)
    const totalPaddingWidth = cols * tilePaddingWidth;
    const totalPaddingHeight = rows * tilePaddingHeight;
    
    const availableWidth = containerWidth - totalGapWidth - totalPaddingWidth;
    const availableHeight = containerHeight - totalGapHeight - totalPaddingHeight;
    
    if (availableWidth <= 0 || availableHeight <= 0) continue;
    
    // Size each tile
    const tileWidth = availableWidth / cols;
    const tileHeight = availableHeight / rows;
    
    // Each tile should fit within its allocated space while maintaining 16:9 ratio
    // Width-constrained size
    const heightFromWidth = tileWidth * (9 / 16);
    // Height-constrained size
    const widthFromHeight = tileHeight * (16 / 9);
    
    let actualWidth, actualHeight;
    if (heightFromWidth <= tileHeight) {
      // Width is the limiting factor
      actualWidth = tileWidth;
      actualHeight = heightFromWidth;
    } else {
      // Height is the limiting factor
      actualWidth = widthFromHeight;
      actualHeight = tileHeight;
    }
    
    const area = actualWidth * actualHeight;
    
    if (area > bestLayout.area) {
      bestLayout = { cols, rows, area };
    }
  }
  
  return bestLayout;
}

export default function VoiceParticipantPreview({ channelId, compact = false, canManageMsgs = false }) {
  const { resolveUser, voiceUsersByChannel, voiceStatesByChannel, primeVoiceUsers } = useApp();
  const voiceStates = voiceStatesByChannel[String(channelId)] ?? {};
  const { voiceChannelId, remoteScreenShares, localScreenShare, localCamera, voiceParticipants } = useVoice();
  const [users, setUsers] = useState({});
  const [showTooltip, setShowTooltip] = useState(false);
  const [expandedShare, setExpandedShare] = useState(null); // null or index of expanded share
  const [height, setHeight] = useState(null); // null = auto, or custom height
  const [gridLayout, setGridLayout] = useState({ cols: 1, rows: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenButton, setShowFullscreenButton] = useState(false);
  const fullscreenHideTimeoutRef = useRef(null);
  // Removes the document listeners of an in-progress resize drag (if any)
  const stopResizeRef = useRef(null);
  const panelRef = useRef(null);
  const contentRef = useRef(null);
  const userIds = voiceUsersByChannel[String(channelId)] ?? [];

  // Create a map of participant identity to participant data for easy lookup
  const participantMap = useMemo(() => {
    const map = {};
    voiceParticipants.forEach(p => { map[p.identity] = p; });
    return map;
  }, [voiceParticipants]);

  // Don't leave timers or drag listeners behind when the panel unmounts
  useEffect(() => () => {
    clearTimeout(fullscreenHideTimeoutRef.current);
    stopResizeRef.current?.();
  }, []);

  const getMaxPanelHeight = () => Math.max(200, window.innerHeight - 320);

  // Check if we're in this voice channel
  const isInVoiceChannel = voiceChannelId === Number(channelId);
  
  // Feeds from people whose video we've turned off: we aren't receiving them, so each gets
  // a placeholder tile to turn it back on from. Keyed on a string so it only changes when
  // those feeds do (participants update for every bit of speaking).
  const videoOffKey = JSON.stringify(voiceParticipants
    .filter(p => !p.isLocal && p.videoDisabled)
    .map(p => [String(p.identity), (p.videoPublications ?? []).map(pub => [pub.trackSid, pub.source])]));
  const videoOff = useMemo(() => JSON.parse(videoOffKey), [videoOffKey]);

  // Collect all video feeds (local + remote; screen shares first, then cameras)
  // if we're in this channel. Memoized so effects keyed on it only run when the
  // feeds actually change.
  const allScreenShares = useMemo(() => {
    if (!isInVoiceChannel) return [];
    const offIds = new Set(videoOff.map(([identity]) => identity));
    const remote = [
      // (A feed being turned off can still be here for a moment: the placeholder wins)
      ...remoteScreenShares.filter(s => !offIds.has(String(s.participantIdentity))),
      ...videoOff.flatMap(([identity, pubs]) => pubs.map(([trackSid, source]) => ({
        placeholder: true, participantIdentity: identity, source, trackSid,
      }))),
    ];
    const remoteScreens = remote.filter(s => s.source !== 'camera');
    const remoteCameras = remote.filter(s => s.source === 'camera');
    return [
      ...(localScreenShare ? [{ ...localScreenShare, source: 'screen', isLocal: true }] : []),
      ...remoteScreens.map(share => ({ ...share, isLocal: false })),
      ...(localCamera ? [{ ...localCamera, source: 'camera', isLocal: true }] : []),
      ...remoteCameras.map(share => ({ ...share, isLocal: false })),
    ];
  }, [isInVoiceChannel, localScreenShare, localCamera, remoteScreenShares, videoOff]);

  const getMinPanelHeight = () => (allScreenShares.length > 0 ? 200 : 100);

  // Clear expanded view if the share disappears or index is invalid.
  useEffect(() => {
    if (expandedShare === null) return;
    if (allScreenShares.length === 0) {
      setExpandedShare(null);
      return;
    }
    if (expandedShare >= allScreenShares.length) {
      setExpandedShare(null);
    }
  }, [allScreenShares.length, expandedShare]);

  // Recalculate grid layout when streams or panel size changes
  useEffect(() => {
    if (expandedShare !== null || allScreenShares.length === 0) {
      setGridLayout({ cols: 1, rows: 1 });
      return;
    }
    
    const content = contentRef.current;
    if (!content) return;
    
    const recalculate = () => {
      // Get the available space for the grid
      const contentRect = content.getBoundingClientRect();
      let availableWidth = contentRect.width;
      let availableHeight = contentRect.height;
      
      // The content div has gap: 0.75rem (12px) between items
      // Subtract space for header (roughly 24px content + 12px gap)
      availableHeight -= 36;
      
      // Subtract space for participants section if it exists (rough estimate: 50px + 12px gap)
      if (userIds.length > 0) {
        availableHeight -= 62;
      }
      
      // Minimum space needed
      const layout = calculateOptimalGrid(
        allScreenShares.length,
        Math.max(availableWidth, 150),
        Math.max(availableHeight, 150)
      );
      
      setGridLayout(layout);
    };
    
    // Call immediately
    recalculate();
    
    // Also recalculate when content size changes
    const resizeObserver = new ResizeObserver(() => {
      recalculate();
    });
    
    resizeObserver.observe(content);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [allScreenShares.length, expandedShare, userIds.length, height]);
  
  // Constrain panel height when streams are added to prevent going off-screen
  useEffect(() => {
    // Once the last stream ends, go back to fitting the content. Otherwise a height
    // set while streaming (dragged, or capped below) leaves a big empty panel behind.
    if (allScreenShares.length === 0) {
      setHeight(null);
      return;
    }

    const panel = panelRef.current;
    if (!panel) return;

    const checkAndConstrain = () => {
      const maxHeight = getMaxPanelHeight();
      const currentHeight = panel.offsetHeight;

      // 1px of slack: at fractional zoom levels offsetHeight can round up past the
      // CSS max-height (which already keeps the panel on screen) and lock the height
      if (currentHeight > maxHeight + 1) {
        setHeight(maxHeight);
      }
    };
    
    const frameId = requestAnimationFrame(checkAndConstrain);
    const timeoutId = setTimeout(checkAndConstrain, 0);
    const resizeObserver = new ResizeObserver(() => {
      checkAndConstrain();
    });

    resizeObserver.observe(panel);
    window.addEventListener('resize', checkAndConstrain);
    
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', checkAndConstrain);
    };
  }, [allScreenShares.length]);
  
  // Handle resize on bottom edge hover
  const handleMouseMove = (e) => {
    const panel = panelRef.current;
    if (!panel) return;

    if (expandedShare !== null) {
      setShowFullscreenButton(true);
      if (fullscreenHideTimeoutRef.current) {
        clearTimeout(fullscreenHideTimeoutRef.current);
      }
      fullscreenHideTimeoutRef.current = setTimeout(() => {
        setShowFullscreenButton(false);
      }, 1500);
    }

    if (!height) return;

    const rect = panel.getBoundingClientRect();
    const distanceFromBottom = rect.bottom - e.clientY;

    if (distanceFromBottom < 18) {
      panel.style.cursor = 'ns-resize';
    } else {
      panel.style.cursor = 'default';
    }
  };

  const handleMouseDown = (e) => {
    const panel = panelRef.current;
    if (!panel) return;

    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panel.offsetHeight;

    const handleMove = (moveEvent) => {
      const diff = moveEvent.clientY - startY;
      const maxHeight = getMaxPanelHeight();
      const minHeight = getMinPanelHeight();
      const newHeight = Math.max(minHeight, Math.min(startHeight + diff, maxHeight));
      setHeight(newHeight);
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      stopResizeRef.current = null;
      if (panel) panel.style.cursor = 'default';
    };

    stopResizeRef.current?.();
    stopResizeRef.current = handleUp;
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  useEffect(() => {
    primeVoiceUsers(channelId);
  }, [channelId, primeVoiceUsers]);

  useEffect(() => {
    userIds.forEach(id => {
      if (!users[id]) {
        resolveUser(id).then(user => {
          setUsers(prev => ({ ...prev, [id]: user }));
        });
      }
    });
  }, [userIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ensure all video elements are playing when component mounts or screen shares update
  // This fixes the issue where streams freeze when navigating away and back
  useEffect(() => {
    if (allScreenShares.length === 0) return;

    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      allScreenShares.forEach(share => {
        if (share.videoElement && share.videoElement.tagName === 'VIDEO' && share.videoElement.isConnected) {
          const videoEl = share.videoElement;
          // Check if video is paused and has a valid source
          if (videoEl.paused && videoEl.srcObject) {
            videoEl.play().catch(err => {
              console.log('Failed to resume video playback:', err);
            });
          }
        }
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [allScreenShares, expandedShare]); // Re-run when shares change or expansion state changes

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = 
        document.fullscreenElement === panelRef.current ||
        (document.webkitFullscreenElement === panelRef.current);
      setIsFullscreen(isCurrentlyFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    const panel = panelRef.current;
    if (!panel) return;

    try {
      const isCurrentlyFullscreen = 
        document.fullscreenElement === panel ||
        (document.webkitFullscreenElement === panel) ||
        (document.mozFullScreenElement === panel);
      
      if (isCurrentlyFullscreen) {
        // Exit fullscreen using Electron-aware function
        await exitFullscreenWithElectronSupport();
        return;
      }

      // Request fullscreen using Electron-aware function
      await requestFullscreenWithElectronSupport(panel);
    } catch (error) {
      console.error('Fullscreen toggle failed:', error);
      // Log the specific error for debugging
      if (error.name === 'TypeError') {
        console.warn('Fullscreen request was rejected or cancelled - this may be a security restriction');
      } else if (error.name === 'NotSupportedError') {
        console.warn('Fullscreen is not supported for this element');
      }
    }
  };

  // For compact mode, always show the badge (even if empty)
  if (compact) {
    return (
      <div
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* Participant count badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.15rem 0.4rem',
          borderRadius: '9999px',
          background: userIds.length > 0 ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
          border: `1px solid ${userIds.length > 0 ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--text-muted) 20%, transparent)'}`,
          fontSize: '0.7rem',
          fontWeight: 600,
          color: userIds.length > 0 ? 'var(--success)' : 'var(--text-muted)',
          cursor: userIds.length > 0 ? 'pointer' : 'default',
        }}>
          <MicIcon size={14} />
          <span>{userIds.length}</span>
        </div>

        {/* Tooltip showing participant names (only if there are users) */}
        {showTooltip && userIds.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '0.5rem',
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 1000,
            minWidth: '120px',
            whiteSpace: 'nowrap',
          }}>
            <div style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.35rem',
            }}>
              In Voice ({userIds.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {userIds.map(id => {
                const user = users[id];
                const name = user?.username ?? id.slice(0, 10);
                const participant = participantMap[id];
                const isSpeaking = participant?.isSpeaking ?? false;
                const isMuted = participant?.isMuted ?? false;
                const isClientMuted = participant?.isClientMuted ?? false;
                
                return (
                  <UserInteraction key={id} userId={user?.id} username={name}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                    }}>
                      <Avatar userId={user?.id} name={name} size={16} color={user?.color} />
                      <span style={{ flex: 1 }}>{name}</span>
                      <VoiceStatusIcons isSpeaking={isSpeaking} isMuted={isMuted} isDeafened={voiceStates[id]?.deafened} isClientMuted={isClientMuted} isVideoDisabled={participant?.videoDisabled} />
                    </div>
                  </UserInteraction>
                );
              })}
            </div>
            {/* Arrow pointing down */}
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--border)',
            }} />
          </div>
        )}
      </div>
    );
  }

  // For full panel mode, only show if there are users or screen shares
  if (userIds.length === 0 && allScreenShares.length === 0) {
    return null;
  }

  // Full panel mode (for main chat area)
  return (
    <div 
      ref={panelRef}
      onMouseMove={handleMouseMove}
      style={{
        background: expandedShare !== null ? 'transparent' : 'var(--bg-secondary)',
        borderBottom: expandedShare !== null ? 'none' : '1px solid var(--border)',
        padding: expandedShare !== null ? 0 : '0.75rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        flexShrink: 0,
        overflow: 'hidden',
        height: isFullscreen ? '100vh' : (height ? `${height}px` : 'auto'),
        maxHeight: isFullscreen ? '100vh' : 'calc(100vh - 320px)',
        width: isFullscreen ? '100vw' : 'auto',
        position: 'relative',
        boxSizing: 'border-box',
      }}>
      {/* Scrollable content area */}
      <div 
        ref={contentRef}
        style={{
        display: 'flex',
        flexDirection: 'column',
        gap: expandedShare !== null ? 0 : '0.75rem',
        overflow: 'hidden auto',
        flex: 1,
        minHeight: 0,
        background: expandedShare !== null ? 'transparent' : 'var(--bg-secondary)',
        boxSizing: 'border-box',
      }}>
        {/* Header */}
        {expandedShare === null && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            flexShrink: 0,
          }}>
            <MicIcon size={15} />
            <span style={{ flex: 1 }}>In Voice ({userIds.length})</span>
            <VoiceButton
              size="sm"
              onClick={handleToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{ color: 'var(--text-secondary)', borderRadius: '6px', padding: '0.2rem 0.5rem' }}
            >
              ⤢
            </VoiceButton>
          </div>
        )}

        {/* Running polls, pinned where people in the call will see them */}
        {expandedShare === null && (
          <VoicePollStrip channelId={channelId} canManageMsgs={canManageMsgs} />
        )}

        {/* Screen shares grid */}
        {allScreenShares.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: expandedShare !== null ? '1fr' : `repeat(${gridLayout.cols}, 1fr)`,
            gap: expandedShare !== null ? 0 : '0.75rem',
            width: '100%',
            flex: 1,
            minHeight: 0,
          }}>
            {allScreenShares.map((share, index) => (
              <ScreenShareTile
                key={share.isLocal ? `local-${share.source}` : share.trackSid}
                share={share}
                isExpanded={expandedShare === index}
                onClick={() => setExpandedShare(expandedShare === index ? null : index)}
                resolveUser={resolveUser}
                users={users}
                hidden={expandedShare !== null && expandedShare !== index}
              />
            ))}
          </div>
        )}

        {/* Participants grid */}
        {expandedShare === null && userIds.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            flexShrink: 0,
          }}>
            {userIds.map(id => {
              const user = users[id];
              const name = user?.username ?? id.slice(0, 10);
              const participant = participantMap[id];
              const isSpeaking = participant?.isSpeaking ?? false;
              const isMuted = participant?.isMuted ?? false;
              const isClientMuted = participant?.isClientMuted ?? false;
              
              return (
                <UserInteraction key={id} userId={user?.id} username={name}>
                  <div
                    className="voice-speaking-ring"
                    data-speaking={isSpeaking && !isMuted}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.35rem',
                      padding: '0.3rem 0.5rem', borderRadius: '4px',
                      background: 'var(--accent-softer)',
                      fontSize: '0.8rem', color: 'var(--text-secondary)',
                    }}
                  >
                    <Avatar userId={user?.id} name={name} size={20} color={user?.color} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <VoiceStatusIcons isSpeaking={isSpeaking} isMuted={isMuted} isDeafened={voiceStates[id]?.deafened} isClientMuted={isClientMuted} isVideoDisabled={participant?.videoDisabled} />
                  </div>
                </UserInteraction>
              );
            })}
          </div>
        )}
      </div>

      {expandedShare !== null && showFullscreenButton && (
        <button
          onClick={handleToggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(0,0,0,0.45)',
            color: '#fff',
            borderRadius: '6px',
            padding: '0.3rem 0.5rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: 600,
            zIndex: 2,
          }}
        >
          ⤢
        </button>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '10px',
          cursor: 'ns-resize',
          background: 'transparent',
          borderTop: '1px solid var(--border)',
        }}
        title="Drag to resize"
      />
    </div>
  );
}

function ScreenShareTile({ share, isExpanded, onClick, resolveUser, users, hidden }) {
  const [user, setUser] = useState(null);
  const [menu, setMenu] = useState(null); // { x, y } while the right-click menu is open
  const containerRef = useRef(null);
  const { addToast } = useApp();
  const { voiceParticipants, setStreamAudioSetting, setVideoDisabledSetting } = useVoice();
  const { voiceParticipantSettings } = useClientOptions();
  // A feed we've turned off (nothing to show), or one popped out into its own window
  const isPlaceholder = !!share.placeholder;
  const key = popoutKey(share);
  const poppedOut = usePoppedOutStreams().has(key) && !isPlaceholder;
  const popOutAvailable = !isPlaceholder && canPopOut();
  const showsVideo = !hidden && !isPlaceholder && !poppedOut;
  // Expanded streams can be zoomed into, to read small text on someone's screen. No
  // double-click zoom: a click leaves the expanded view, and it shouldn't have to wait to
  // rule out a double-click first.
  const zoom = useStreamZoom(containerRef, isPlaceholder ? null : share.videoElement, isExpanded && showsVideo, { doubleClick: false });

  useEffect(() => {
    if (share.isLocal || !share.participantIdentity) return;
    let cancelled = false;
    resolveUser(share.participantIdentity).then(u => { if (!cancelled) setUser(u); });
    return () => { cancelled = true; };
  }, [share.isLocal, share.participantIdentity, resolveUser]);

  useEffect(() => {
    const container = containerRef.current;
    // Popped out (or turned off): the call view lets go of its copy of the video
    if (container && !showsVideo && !hidden) container.innerHTML = '';
    if (showsVideo && container && share.videoElement && share.videoElement instanceof HTMLElement) {
      // Clear container first
      container.innerHTML = '';
      
      // Set video element styles
      share.videoElement.style.width = '100%';
      share.videoElement.style.height = '100%';
      share.videoElement.style.objectFit = 'contain';
      share.videoElement.style.borderRadius = '8px';
      
      // Append the video element
      container.appendChild(share.videoElement);
      
      // Force the video to play if it's paused (fixes frozen stream issue)
      if (share.videoElement.tagName === 'VIDEO') {
        const videoEl = share.videoElement;
        // Check if the video is paused and has a valid srcObject
        if (videoEl.paused && videoEl.srcObject) {
          videoEl.play().catch(err => {
            console.log('Failed to auto-play video after navigation:', err);
          });
        }
      }
    }
  }, [share.videoElement, hidden, showsVideo, share.participantIdentity]);

  const isCamera = share.source === 'camera';
  const TileIcon = isCamera ? VideoIcon : ScreenShareIcon;

  // Stream audio: whether this screen comes with sound, and whether we've muted it
  const identity = share.participantIdentity != null ? String(share.participantIdentity) : null;
  const participant = !share.isLocal && !isCamera && identity
    ? voiceParticipants.find(p => String(p.identity) === identity)
    : null;
  const hasStreamAudio = !isCamera && (share.isLocal ? !!share.hasAudio : !!participant?.hasStreamAudio);
  const saved = (identity && voiceParticipantSettings[identity]) || {};
  const streamMuted = !!saved.streamMuted;
  const streamVolume = saved.streamVolume ?? 1;
  const canAdjustAudio = !share.isLocal && !isCamera && !!identity;
  // Someone else's feed: can be turned off, which stops it being sent to us
  const canToggleVideo = !share.isLocal && !!identity;
  const videoDisabled = !!saved.videoDisabled;

  function handleContextMenu(e) {
    if (!canAdjustAudio && !canToggleVideo && !popOutAvailable) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }
  const username = share.isLocal ? share.username || (isCamera ? 'Your Camera' : 'Your Screen') : (user?.username || users[share.participantIdentity]?.username || share.participantIdentity);
  const popoutTitle = share.isLocal
    ? (isCamera ? 'Your camera' : 'Your screen')
    : `${username}'s ${isCamera ? 'camera' : 'screen'}`;

  function handlePopOut(e) {
    e?.stopPropagation();
    if (poppedOut) {
      closePopout(key);
      return;
    }
    popOutStream(key, share.videoElement, popoutTitle).catch(err => {
      console.error('Pop out failed:', err);
      addToast({ title: 'Couldn\'t pop out the stream', body: err.message || String(err), type: 'danger' });
    });
  }

  function toggleVideo(e) {
    e?.stopPropagation();
    setVideoDisabledSetting(identity, !videoDisabled);
  }

   return (
    <div
      className="stream-tile"
      data-stream-identity={identity ?? undefined}
      onClick={() => (isExpanded ? zoom.handleClick(onClick, { delay: false }) : onClick())}
      onContextMenu={handleContextMenu}
      style={{
        background: isExpanded ? 'transparent' : 'var(--bg-tertiary)',
        borderRadius: '8px',
        padding: isExpanded ? 0 : '0.75rem',
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        cursor: 'pointer',
        transition: 'border 0.2s, box-shadow 0.2s',
        border: isExpanded ? 'none' : '2px solid transparent',
        minHeight: '0',
        flex: isExpanded ? 1 : 'initial',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {!isExpanded && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          flexShrink: 0,
        }}>
          <span style={{
            flex: 1,
            minWidth: 0,
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            <TileIcon size={14} /> {username}
          </span>
          {hasStreamAudio && (streamMuted && !share.isLocal ? (
            <span
              className="stream-muted-badge"
              title="Stream audio muted. Right-click to unmute."
              style={{ color: 'var(--danger)', display: 'flex', flexShrink: 0 }}
            >
              <SpeakerMutedIcon size={14} />
            </span>
          ) : (
            <span
              className="stream-audio-icon"
              title={share.isLocal ? 'Sharing audio' : 'This stream has audio. Right-click to mute or change its volume.'}
              style={{ color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
            >
              <SpeakerIcon size={14} />
            </span>
          ))}
          {share.isLocal && !isCamera && (
            <span style={{
              fontSize: '0.65rem',
              color: 'var(--success)',
              background: 'color-mix(in srgb, var(--success) 15%, transparent)',
              padding: '0.15rem 0.4rem',
              borderRadius: '3px',
              fontWeight: 600,
              flexShrink: 0,
            }}>
              LIVE
            </span>
          )}
          {!isExpanded && !isPlaceholder && !poppedOut && (
            <span className="stream-expand-hint" style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              flexShrink: 0,
            }}>
              Click to expand
            </span>
          )}
          {popOutAvailable && (
            <button
              type="button"
              className="stream-tile-btn"
              onClick={handlePopOut}
              title={poppedOut ? 'Bring back' : 'Pop out'}
              aria-label={poppedOut ? 'Bring back' : 'Pop out'}
            >
              {poppedOut ? <PopInIcon size={14} /> : <PopOutIcon size={14} />}
            </button>
          )}
        </div>
      )}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        // Without a video to size it, keep the tile the shape of one
        ...(!showsVideo && !isExpanded ? { aspectRatio: '16 / 9', flex: 'none' } : null),
      }}>
        <div
          ref={containerRef}
          style={{
            background: '#000',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            minHeight: '0',
            overflow: 'hidden',
            // Pinch zooms the stream rather than the page
            touchAction: isExpanded ? 'none' : 'auto',
            cursor: isExpanded && showsVideo ? (zoom.zoomed ? 'grab' : 'zoom-in') : 'pointer',
          }}
        />
        {/* Nothing to show: say why, with a way back */}
        {(isPlaceholder || poppedOut) && !hidden && (
          <div className="stream-placeholder" data-expanded={isExpanded}>
            {isPlaceholder ? <VideoOffIcon size={isExpanded ? 32 : 22} /> : <PopOutIcon size={isExpanded ? 32 : 22} />}
            <div className="stream-placeholder-text">
              {isPlaceholder ? `You turned off ${username}'s video` : 'Popped out'}
            </div>
            <VoiceButton
              size="sm"
              onClick={isPlaceholder ? toggleVideo : handlePopOut}
              onDoubleClick={e => e.stopPropagation()}
            >
              {isPlaceholder ? <><VideoIcon size={13} /> Turn on</> : <><PopInIcon size={13} /> Bring back</>}
            </VoiceButton>
          </div>
        )}
      </div>
      {/* Expanded tiles have no header, so the muted state goes over the video */}
      {isExpanded && hasStreamAudio && streamMuted && !share.isLocal && (
        <div
          className="stream-muted-badge"
          title="Stream audio muted. Right-click to unmute."
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            display: 'flex', alignItems: 'center', gap: '0.25rem',
            padding: '0.15rem 0.4rem',
            borderRadius: '4px',
            background: 'rgba(0,0,0,0.6)',
            color: 'var(--danger)',
            fontSize: '0.68rem', fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          <SpeakerMutedIcon size={12} /> Muted
        </div>
      )}
      {menu && (
        // The menu is portalled, but React events still bubble to the tile: keep clicks
        // in the menu from expanding it
        <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()} style={{ display: 'contents' }}>
          <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} minWidth={200}>
            {popOutAvailable && (
              <MenuItem
                icon={poppedOut ? PopInIcon : PopOutIcon}
                label={poppedOut ? 'Bring Back' : 'Pop Out'}
                onClick={() => { handlePopOut(); setMenu(null); }}
              />
            )}
            {canToggleVideo && (
              <MenuItem
                icon={videoDisabled ? VideoIcon : VideoOffIcon}
                label={videoDisabled ? 'Turn On Their Video' : 'Turn Off Their Video'}
                onClick={() => { toggleVideo(); setMenu(null); }}
              />
            )}
            {canAdjustAudio && (popOutAvailable || canToggleVideo) && <MenuDivider />}
            {!canAdjustAudio ? null : hasStreamAudio ? (
              <>
                <MenuItem
                  icon={streamMuted ? SpeakerMutedIcon : SpeakerIcon}
                  label={streamMuted ? 'Unmute Stream Audio' : 'Mute Stream Audio'}
                  onClick={() => setStreamAudioSetting(identity, { muted: !streamMuted })}
                />
                <div style={{ padding: '0.4rem 0.75rem' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '0.4rem',
                  }}>
                    <span>Stream Volume</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(streamVolume * 100)}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={500}
                    step={5}
                    value={Math.round(streamVolume * 100)}
                    onChange={v => setStreamAudioSetting(identity, { volume: v / 100 })}
                  />
                </div>
                {(streamMuted || streamVolume !== 1) && (
                  <>
                    <MenuDivider />
                    <MenuItem label="Reset" onClick={() => setStreamAudioSetting(identity, { muted: false, volume: 1 })} />
                  </>
                )}
              </>
            ) : (
              <MenuItem icon={SpeakerMutedIcon} label="This stream has no audio" disabled />
            )}
          </ContextMenu>
        </div>
      )}
      {isExpanded && !hidden && showsVideo && (
        <div
          className="stream-zoom-bar"
          data-zoomed={zoom.zoomed}
          onClick={e => e.stopPropagation()}
        >
          <button type="button" onClick={zoom.zoomOut} disabled={!zoom.zoomed} title="Zoom out" aria-label="Zoom out">
            <MinusIcon size={14} />
          </button>
          <button type="button" className="stream-zoom-level" onClick={zoom.reset} disabled={!zoom.zoomed} title="Reset zoom">
            {Math.round(zoom.scale * 100)}%
          </button>
          <button type="button" onClick={zoom.zoomIn} disabled={zoom.scale >= 7.99} title="Zoom in (or scroll, pinch)" aria-label="Zoom in">
            <PlusIcon size={14} />
          </button>
          {popOutAvailable && (
            <>
              <span className="stream-zoom-sep" />
              <button type="button" onClick={handlePopOut} title="Pop out" aria-label="Pop out">
                <PopOutIcon size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}