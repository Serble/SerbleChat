import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import Avatar from './Avatar.jsx';
import UserInteraction from './UserInteraction.jsx';

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

export default function VoiceParticipantPreview({ channelId, compact = false }) {
  const { resolveUser, voiceUsersByChannel, primeVoiceUsers } = useApp();
  const { voiceChannelId, remoteScreenShares, localScreenShare } = useVoice();
  const [users, setUsers] = useState({});
  const [showTooltip, setShowTooltip] = useState(false);
  const [expandedShare, setExpandedShare] = useState(null); // null or index of expanded share
  const [height, setHeight] = useState(null); // null = auto, or custom height
  const [gridLayout, setGridLayout] = useState({ cols: 1, rows: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenButton, setShowFullscreenButton] = useState(false);
  const fullscreenHideTimeoutRef = useRef(null);
  const panelRef = useRef(null);
  const contentRef = useRef(null);
  const userIds = voiceUsersByChannel[String(channelId)] ?? [];

  const getMaxPanelHeight = () => Math.max(200, window.innerHeight - 320);

  // Check if we're in this voice channel
  const isInVoiceChannel = voiceChannelId === Number(channelId);
  
  // Collect all screen shares (local + remote) if we're in this channel
  const allScreenShares = isInVoiceChannel ? [
    ...(localScreenShare ? [{ ...localScreenShare, isLocal: true }] : []),
    ...remoteScreenShares.map(share => ({ ...share, isLocal: false }))
  ] : [];

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
    if (allScreenShares.length === 0) return;
    
    const panel = panelRef.current;
    if (!panel) return;
    
    const checkAndConstrain = () => {
      const maxHeight = getMaxPanelHeight();
      const currentHeight = panel.offsetHeight;
      
      if (currentHeight > maxHeight) {
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
      if (panel) panel.style.cursor = 'default';
    };

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
        if (share.videoElement && share.videoElement.tagName === 'VIDEO') {
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
      setIsFullscreen(document.fullscreenElement === panelRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = async () => {
    const panel = panelRef.current;
    if (!panel) return;

    if (document.fullscreenElement === panel) {
      await document.exitFullscreen();
      return;
    }

    await panel.requestFullscreen();
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
          background: userIds.length > 0 ? 'rgba(35,165,90,0.15)' : 'rgba(100,100,100,0.1)',
          border: userIds.length > 0 ? '1px solid rgba(35,165,90,0.3)' : '1px solid rgba(100,100,100,0.2)',
          fontSize: '0.7rem',
          fontWeight: 600,
          color: userIds.length > 0 ? 'var(--success)' : 'var(--text-muted)',
          cursor: userIds.length > 0 ? 'pointer' : 'default',
        }}>
          <span>🎙️</span>
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
                      <span>{name}</span>
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
            <span style={{ fontSize: '0.95rem' }}>🎙️</span>
            <span style={{ flex: 1 }}>In Voice ({userIds.length})</span>
            <button
              onClick={handleToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.06)',
                color: 'var(--text-secondary)',
                borderRadius: '6px',
                padding: '0.2rem 0.5rem',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              {isFullscreen ? '⤢' : '⤢'}
            </button>
          </div>
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
                key={share.isLocal ? 'local' : share.participantIdentity}
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
              return (
                <UserInteraction key={id} userId={user?.id} username={name}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.3rem 0.5rem',
                      borderRadius: '4px',
                      background: 'rgba(124,58,237,0.08)',
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <Avatar userId={user?.id} name={name} size={20} color={user?.color} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
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
          {isFullscreen ? '⤢' : '⤢'}
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
  const containerRef = useRef(null);

  useEffect(() => {
    if (!share.isLocal && share.participantIdentity) {
      resolveUser(share.participantIdentity).then(setUser);
    }
  }, [share, resolveUser]);

  useEffect(() => {
    const container = containerRef.current;
    if (!hidden && container && share.videoElement && share.videoElement instanceof HTMLElement) {
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
  }, [share.videoElement, hidden, share.participantIdentity]);

  const username = share.isLocal ? share.username || 'Your Screen' : (user?.username || users[share.participantIdentity]?.username || share.participantIdentity);

   return (
    <div 
      onClick={onClick}
      style={{
        background: isExpanded ? 'transparent' : 'var(--bg-tertiary)',
        borderRadius: '8px',
        padding: isExpanded ? 0 : '0.75rem',
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        cursor: 'pointer',
        transition: 'border 0.2s, box-shadow 0.2s',
        border: isExpanded ? 'none' : (isExpanded ? '2px solid var(--accent)' : '2px solid transparent'),
        minHeight: '0',
        flex: isExpanded ? 1 : 'initial',
        overflow: 'hidden',
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
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            📺 {username}
          </span>
          {share.isLocal && (
            <span style={{
              fontSize: '0.65rem',
              color: 'var(--success)',
              background: 'rgba(34,197,94,0.15)',
              padding: '0.15rem 0.4rem',
              borderRadius: '3px',
              fontWeight: 600,
              flexShrink: 0,
            }}>
              LIVE
            </span>
          )}
          {!isExpanded && (
            <span style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              flexShrink: 0,
            }}>
              Click to expand
            </span>
          )}
        </div>
      )}
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
        }}
      />
    </div>
  );
}