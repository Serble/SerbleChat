import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CLIENT_ID, REDIRECT_URI, OAUTH_URL, exchangeCode } from '../api.js';
import { isElectron, electronOAuthFlow, getAssetPath } from '../electron-utils.js';
import { startConfetti } from '../confetti.js';

const PUZZLE_SIZE = 3;

const FEATURE_CARDS = [
  {
    icon: '⚡',
    title: 'Instant Access, No Email',
    text: 'Create your account in seconds without needing an email address. Start chatting immediately.',
  },
  {
    icon: '🔐',
    title: 'Privacy First',
    text: 'Deleted messages are purged forever. Control your privacy with the option to toggle sending typing indicators.',
  },
  {
    icon: '📹',
    title: 'Voice & Screenshare',
    text: 'Crystal-clear voice calls and screen sharing. Connect face-to-face with your friends instantly.',
  },
  {
    icon: '🔔',
    title: 'Smart Notifications',
    text: 'Fine-grained control over notifications. Set preferences per channel and per guild to stay focused.',
  },
  {
    icon: '🛡️',
    title: 'Fine-Grained Guild Permission System',
    text: 'Configure detailed role and channel access rules so guilds can be setup however they like.',
  },
  {
    icon: '📎',
    title: 'File Uploads',
    text: 'Upload files and images directly in chat to quickly share screenshots, media, and documents with your community.',
  },
  {
    icon: '💻',
    title: 'Fully Open Source',
    text: 'Complete transparency and community-driven development. Inspect the code, contribute, and fork it for your own community.',
  },
  {
    icon: '🎨',
    title: 'Client Theming',
    text: 'Customize your experience with flexible theming options. Make Serble Chat look and feel exactly how you want it.',
  },
];

// Extra card for tic-tac-toe only
const SERBLE_CHAT_CARD = {
  icon: '🎯',
  title: 'Serble Chat',
  text: 'The ultimate chat platform for communities. Fast, secure, and open source.',
  isSerble: true,
};

function shuffle(values) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getInversionCount(values) {
  const nums = values.filter(v => v !== 0);
  let inversions = 0;

  for (let i = 0; i < nums.length - 1; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i] > nums[j]) inversions++;
    }
  }

  return inversions;
}

function isSolvable(ordering) {
  // 3x3 puzzle is solvable when inversion count is even.
  return getInversionCount(ordering) % 2 === 0;
}

function isSolved(board) {
  if (board.length !== PUZZLE_SIZE * PUZZLE_SIZE) return false;

  for (let i = 0; i < board.length - 1; i++) {
    if (!board[i] || board[i].number !== i + 1) return false;
  }

  return board[board.length - 1] === null;
}

function createInitialBoard() {
  const randomNumbers = shuffle(Array.from({ length: FEATURE_CARDS.length }, (_, i) => i + 1));
  const cards = FEATURE_CARDS.map((card, index) => ({
    ...card,
    id: index,
    number: randomNumbers[index],
  }));

  let board;
  do {
    board = shuffle([...cards, null]);
  } while (!isSolvable(board.map(cell => (cell ? cell.number : 0))) || isSolved(board));

  return board;
}

function createMemoryBoard() {
  const pairs = FEATURE_CARDS.map((card, index) => ({
    ...card,
    id: index,
  }));
  const doubled = [...pairs, ...pairs];
  const shuffled = shuffle(doubled);
  return shuffled.map((card, index) => ({
    card,
    index,
    isFlipped: false,
    isMatched: false,
  }));
}

function memoryGameSolved(memoryBoard) {
  return memoryBoard.every(tile => tile.isMatched);
}

function createTicTacToeBoard() {
  // Map all 8 feature cards plus the Serble Chat card to tic-tac-toe cells
  const allCards = [...FEATURE_CARDS, SERBLE_CHAT_CARD];
  return allCards.map((card, index) => ({
    card,
    index,
    value: null, // 'X', 'O', or null
  }));
}

function checkTicTacToeWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6] // diagonals
  ];
  
  for (const [a, b, c] of lines) {
    const valA = board[a].value;
    const valB = board[b].value;
    const valC = board[c].value;
    if (valA && valA === valB && valA === valC) {
      return valA;
    }
  }
  
  return board.every(cell => cell.value !== null) ? 'draw' : null;
}

function getAIMove(board) {
  const available = board.map((cell, i) => cell.value === null ? i : null).filter(i => i !== null);
  if (available.length === 0) return null;
  
  // AI makes mistakes 30% of the time
  if (Math.random() < 0.3) {
    return available[Math.floor(Math.random() * available.length)];
  }
  
  // Check for winning move
  for (const index of available) {
    const testBoard = board.map((c, i) => i === index ? { ...c, value: 'O' } : c);
    if (checkTicTacToeWinner(testBoard) === 'O') return index;
  }
  
  // Block player from winning
  for (const index of available) {
    const testBoard = board.map((c, i) => i === index ? { ...c, value: 'X' } : c);
    if (checkTicTacToeWinner(testBoard) === 'X') return index;
  }
  
  // Take center if available
  if (board[4].value === null) return 4;
  
  // Take random available
  return available[Math.floor(Math.random() * available.length)];
}

function createLightsOutBoard() {
  const allCards = [...FEATURE_CARDS, SERBLE_CHAT_CARD];
  const board = allCards.map((card, index) => ({
    index,
    card,
    isLit: Math.random() > 0.5,
  }));

  // Ensure the puzzle is not already solved.
  if (board.every(tile => !tile.isLit)) {
    board[0].isLit = true;
  }

  return board;
}

function isLightsOutSolved(board) {
  return board.every(tile => !tile.isLit);
}

function toggleLightsOutTile(board, index) {
  const newBoard = board.map(tile => ({ ...tile }));
  const col = index % 3;

  // Toggle the clicked tile.
  newBoard[index].isLit = !newBoard[index].isLit;

  // Toggle adjacent tiles (up, down, left, right).
  const adjacent = [
    index - 3,
    index + 3,
    col > 0 ? index - 1 : -1,
    col < 2 ? index + 1 : -1,
  ];

  for (const adjIndex of adjacent) {
    if (adjIndex >= 0 && adjIndex < 9) {
      newBoard[adjIndex].isLit = !newBoard[adjIndex].isLit;
    }
  }

  return newBoard;
}

const c = {
  page: {
    minHeight: '100vh', overflow: 'auto',
    background: 'linear-gradient(135deg, #050e1f 0%, #0a1a35 50%, #05101f 100%)',
    display: 'flex', flexDirection: 'column',
  },
  nav: {
    padding: '1.25rem 2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '1px solid rgba(59,130,246,0.08)',
  },
  logoImg: { width: '2.5rem', height: '2.5rem', borderRadius: '8px' },
  logoText: { fontSize: '1.3rem', fontWeight: 800, color: '#3b82f6', margin: 0, letterSpacing: '-0.02em' },
  hero: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '3rem 2rem', textAlign: 'center', minHeight: 'auto',
  },
  badge: {
    display: 'inline-block', background: 'rgba(59,130,246,0.15)',
    border: '1px solid rgba(59,130,246,0.35)', color: '#60a5fa',
    borderRadius: '9999px', padding: '0.3rem 1rem',
    fontSize: '0.75rem', fontWeight: 700, marginBottom: '1.75rem',
    letterSpacing: '0.1em', textTransform: 'uppercase',
  },
  h1: {
    fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 800,
    color: '#f1f5f9', margin: '0 0 1.25rem', lineHeight: 1.1, letterSpacing: '-0.03em',
  },
  accent: { color: '#60a5fa' },
  sub: {
    fontSize: '1.1rem', color: '#cbd5e1', maxWidth: '480px',
    margin: '0 auto 2rem', lineHeight: 1.65,
  },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.9rem 2.5rem',
    background: 'linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)',
    color: '#fff', borderRadius: '9999px',
    fontWeight: 700, fontSize: '1rem', cursor: 'pointer', border: 'none',
    boxShadow: '0 4px 24px rgba(59,130,246,0.45)',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  featureSection: {
    padding: '3rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  featureSectionTitle: {
    fontSize: '1.75rem', fontWeight: 800, color: '#e2e8f0', marginBottom: '2.5rem', textAlign: 'center',
  },
  puzzleWrapper: {
    position: 'relative',
    maxWidth: '900px',
    width: '100%',
  },
  features: {
    display: 'contents',
  },
  card: {
    position: 'absolute',
    background: 'rgba(30,58,138,0.25)', border: '1px solid rgba(59,130,246,0.2)',
    borderRadius: '16px', padding: '2rem', textAlign: 'left',
    transition: 'left 0.14s cubic-bezier(0.4, 0, 0.2, 1), top 0.14s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s, background-color 0.3s',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 2,
  },
  emptyCard: {
    borderRadius: '16px',
    border: '1px dashed rgba(148,163,184,0.35)',
    background: 'rgba(15,23,42,0.35)',
    height: '100%',
    zIndex: 1,
  },
  cardIcon: { fontSize: '2.5rem', marginBottom: '1rem' },
  cardTitle: { fontWeight: 700, color: '#60a5fa', marginBottom: '0.75rem', fontSize: '1.1rem' },
  cardTitleCorrect: { color: '#86efac' },
  cardText: {
    color: '#cbd5e1',
    fontSize: '0.95rem',
    lineHeight: 1.6,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 5,
    WebkitBoxOrient: 'vertical',
  },
  cardNumber: {
    position: 'absolute',
    top: '0.75rem',
    right: '0.75rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.8rem',
    height: '1.8rem',
    borderRadius: '9999px',
    background: 'rgba(96,165,250,0.2)',
    border: '1px solid rgba(96,165,250,0.5)',
    color: '#bfdbfe',
    fontSize: '0.85rem',
    fontWeight: 800,
  },
  cardNumberCorrect: {
    background: 'rgba(34,197,94,0.25)',
    border: '1px solid rgba(74,222,128,0.7)',
    color: '#dcfce7',
  },
  cardCorrect: {
    background: 'rgba(34,197,94,0.22)',
    border: '1px solid rgba(74,222,128,0.6)',
    boxShadow: '0 0 14px rgba(34,197,94,0.2)',
  },
  memoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gridAutoRows: '140px',
    gap: '0.8rem',
    maxWidth: '600px',
    width: '100%',
  },
  memoryTile: {
    background: 'rgba(30,58,138,0.6)',
    border: '1px solid rgba(59,130,246,0.4)',
    borderRadius: '12px',
    cursor: 'pointer',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.3rem',
    transition: 'all 0.3s ease',
  },
  memoryTileBack: {
    background: 'rgba(15,23,42,0.7)',
    border: '1px solid rgba(59,130,246,0.25)',
  },
  memoryTileFront: {
    background: 'rgba(30,58,138,0.6)',
  },
  memoryTileMatched: {
    background: 'rgba(34,197,94,0.2)',
    border: '1px solid rgba(74,222,128,0.5)',
    boxShadow: '0 0 12px rgba(34,197,94,0.15)',
  },
  memoryIcon: {
    fontSize: '1.8rem',
  },
  memoryTitle: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: '#bfdbfe',
    textAlign: 'center',
    lineHeight: 1.2,
    maxWidth: '100%',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  ticTacToeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.8rem',
    maxWidth: '400px',
    width: '100%',
    margin: '0 auto',
  },
  ticTacToeCell: {
    aspectRatio: '1',
    background: 'rgba(30,58,138,0.4)',
    border: '2px solid rgba(59,130,246,0.3)',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '3rem',
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    opacity: 0.5,
    position: 'relative',
    flexDirection: 'column',
    padding: '0.5rem',
    overflow: 'hidden',
  },
  ticTacToeCellContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25rem',
    zIndex: 1,
  },
  ticTacToeCellIcon: {
    fontSize: '1.2rem',
  },
  ticTacToeCellTitle: {
    fontSize: '0.5rem',
    fontWeight: 600,
    color: '#bfdbfe',
    textAlign: 'center',
    lineHeight: 1.1,
    maxWidth: '100%',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 1,
    WebkitBoxOrient: 'vertical',
  },
  ticTacToeSymbol: {
    position: 'absolute',
    fontSize: '2.5rem',
    fontWeight: 800,
    zIndex: 2,
  },
  ticTacToeCellActive: {
    opacity: 1,
  },
  ticTacToeCellPlayer: {
    background: 'rgba(34,197,94,0.5)',
    border: '2px solid rgba(74,222,128,0.6)',
    color: '#86efac',
    boxShadow: '0 0 16px rgba(34,197,94,0.3)',
  },
  ticTacToeCellAI: {
    background: 'rgba(239,68,68,0.5)',
    border: '2px solid rgba(248,113,113,0.6)',
    color: '#fca5a5',
    boxShadow: '0 0 16px rgba(239,68,68,0.3)',
  },
  ticTacToeScore: {
    display: 'flex',
    gap: '2rem',
    justifyContent: 'center',
    marginBottom: '1.5rem',
  },
  ticTacToeScoreItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
  ticTacToeScoreLabel: {
    fontSize: '0.9rem',
    color: '#94a3b8',
    fontWeight: 600,
  },
  ticTacToeScoreValue: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#e2e8f0',
  },
  lightsOutGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.8rem',
    maxWidth: '400px',
    width: '100%',
    margin: '0 auto',
  },
  lightsOutTile: {
    aspectRatio: '1',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    border: '2px solid',
    position: 'relative',
    overflow: 'hidden',
    padding: '0.5rem',
  },
  lightsOutTileDark: {
    background: 'rgba(30,58,138,0.25)',
    border: '2px solid rgba(59,130,246,0.2)',
    color: '#94a3b8',
  },
  lightsOutTileLit: {
    background: 'rgba(30,58,138,0.8)',
    border: '2px solid rgba(96,165,250,0.8)',
    color: '#bfdbfe',
    boxShadow: '0 0 20px rgba(59,130,246,0.6)',
  },
  lightsOutTileContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25rem',
    zIndex: 1,
  },
  lightsOutTileIcon: {
    fontSize: '1.2rem',
  },
  lightsOutTileTitle: {
    fontSize: '0.5rem',
    fontWeight: 600,
    textAlign: 'center',
    lineHeight: 1.1,
    maxWidth: '100%',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 1,
    WebkitBoxOrient: 'vertical',
  },
};

export default function LandingPage() {
  const nav = useNavigate();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [puzzleBoard, setPuzzleBoard] = useState(() => createInitialBoard());
  const [didCelebrateSolved, setDidCelebrateSolved] = useState(false);
  const [gameMode, setGameMode] = useState('puzzle');
  const [memoryBoard, setMemoryBoard] = useState(null);
  const [memoryFlipped, setMemoryFlipped] = useState([]);
  const [didCelebrateMem, setDidCelebrateMem] = useState(false);
  const [ticTacToeBoard, setTicTacToeBoard] = useState(null);
  const [ticTacToeScores, setTicTacToeScores] = useState({ player: 0, ai: 0 });
  const [currentTicTacToeRound, setCurrentTicTacToeRound] = useState(0);
  const [ticTacToeWaitingAI, setTicTacToeWaitingAI] = useState(false);
  const [ticTacToeGameOver, setTicTacToeGameOver] = useState(false);
  const [lightsOutBoard, setLightsOutBoard] = useState(null);
  const [didCelebrateLightsOut, setDidCelebrateLightsOut] = useState(false);
  
  const confettiCanvasRef = useRef(null);
  const stopConfettiRef = useRef(null);
  const puzzleContainerRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [puzzleContainerWidth, setPuzzleContainerWidth] = useState(0);
  const puzzleGapPx = 16;

  useEffect(() => {
    if (localStorage.getItem('jwt')) nav('/app', { replace: true });
    
    // Check for anchor to skip to a specific game
    const hash = window.location.hash.slice(1);
    if (hash === 'matching') {
      setGameMode('memory');
      setMemoryBoard(createMemoryBoard());
    } else if (hash === 'naughtsandcrosses') {
      setGameMode('tictactoe');
      setTicTacToeBoard(createTicTacToeBoard());
      setTicTacToeScores({ player: 0, ai: 0 });
      setCurrentTicTacToeRound(1);
    } else if (hash === 'lightsout') {
      setGameMode('lightsout');
      setLightsOutBoard(createLightsOutBoard());
    }
  }, [nav]);

  useEffect(() => {
    return () => {
      if (stopConfettiRef.current) {
        stopConfettiRef.current();
        stopConfettiRef.current = null;
      }
    };
  }, []);

  async function login() {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);
    
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    try {
      // Check if running in Electron
      if (isElectron()) {
        // Electron: Use external browser with local callback server
        const electronRedirectUri = 'http://localhost:13579/callback';
        const oauthUrl = `${OAUTH_URL}?${new URLSearchParams({
          client_id: CLIENT_ID, 
          redirect_uri: electronRedirectUri,
          response_type: 'code', 
          scope: 'user_info', 
          state,
        })}`;
        
        // Open browser and wait for callback
        const callbackData = await electronOAuthFlow(oauthUrl);
        
        // Verify state
        if (callbackData.state !== state) {
          throw new Error('State mismatch - possible security issue');
        }
        
        // Check authorization
        if (callbackData.authorized !== 'true' || !callbackData.code) {
          throw new Error('Login was cancelled or denied');
        }
        
        // Exchange code for token
        const data = await exchangeCode(callbackData.code);
        if (!data.success || !data.accessToken) {
          throw new Error('Server did not return an access token');
        }
        
        localStorage.setItem('jwt', data.accessToken);
        nav('/app', { replace: true });
      } else {
        // Web: Use normal redirect flow
        sessionStorage.setItem('oauth_state', state);
        window.location.href = `${OAUTH_URL}?${new URLSearchParams({
          client_id: CLIENT_ID, 
          redirect_uri: REDIRECT_URI,
          response_type: 'code', 
          scope: 'user_info', 
          state,
        })}`;
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError(error.message || 'Failed to login. Please try again.');
      setIsLoggingIn(false);
    }
  }

  function areAdjacent(indexA, indexB) {
    const rowA = Math.floor(indexA / PUZZLE_SIZE);
    const colA = indexA % PUZZLE_SIZE;
    const rowB = Math.floor(indexB / PUZZLE_SIZE);
    const colB = indexB % PUZZLE_SIZE;

    return Math.abs(rowA - rowB) + Math.abs(colA - colB) === 1;
  }

  function onPuzzleCardClick(clickedIndex) {
    if (isAnimating) return;
    
    const emptyIndex = puzzleBoard.findIndex(cell => cell === null);
    if (emptyIndex === -1 || !areAdjacent(clickedIndex, emptyIndex)) return;

    setIsAnimating(true);
    
    setPuzzleBoard(prev => {
      const next = [...prev];
      [next[clickedIndex], next[emptyIndex]] = [next[emptyIndex], next[clickedIndex]];
      return next;
    });
    
    setTimeout(() => {
      setIsAnimating(false);
    }, 140);
  }

  useEffect(() => {
    if (!didCelebrateSolved && isSolved(puzzleBoard)) {
      setDidCelebrateSolved(true);
      if (stopConfettiRef.current) stopConfettiRef.current();
      stopConfettiRef.current = startConfetti(confettiCanvasRef.current, {
        durationMs: 3200,
      });
      setTimeout(() => {
        setGameMode('memory');
        setMemoryBoard(createMemoryBoard());
      }, 1500);
    }
  }, [puzzleBoard, didCelebrateSolved]);

  useEffect(() => {
    if (memoryFlipped.length !== 2) return;

    const [idx1, idx2] = memoryFlipped;
    const tile1 = memoryBoard[idx1];
    const tile2 = memoryBoard[idx2];

    if (tile1.card.id === tile2.card.id) {
      setMemoryBoard(prev =>
        prev.map((t, i) =>
          i === idx1 || i === idx2 ? { ...t, isMatched: true, isFlipped: true } : t
        )
      );
      setMemoryFlipped([]);
    } else {
      setTimeout(() => {
        setMemoryBoard(prev =>
          prev.map((t, i) =>
            i === idx1 || i === idx2 ? { ...t, isFlipped: false } : t
          )
        );
        setMemoryFlipped([]);
      }, 1200);
    }
  }, [memoryFlipped, memoryBoard]);

  useEffect(() => {
    if (memoryBoard && !didCelebrateMem && memoryGameSolved(memoryBoard)) {
      setDidCelebrateMem(true);
      if (stopConfettiRef.current) stopConfettiRef.current();
      stopConfettiRef.current = startConfetti(confettiCanvasRef.current, {
        durationMs: 3200,
      });
      setTimeout(() => {
        setGameMode('tictactoe');
        setTicTacToeBoard(createTicTacToeBoard());
        setTicTacToeScores({ player: 0, ai: 0 });
        setCurrentTicTacToeRound(1);
      }, 1500);
    }
  }, [memoryBoard, didCelebrateMem]);

  useEffect(() => {
    if (lightsOutBoard && !didCelebrateLightsOut && isLightsOutSolved(lightsOutBoard)) {
      setDidCelebrateLightsOut(true);
      if (stopConfettiRef.current) stopConfettiRef.current();
      stopConfettiRef.current = startConfetti(confettiCanvasRef.current, {
        durationMs: 3200,
      });
      setTimeout(() => {
        setGameMode('puzzle');
        setPuzzleBoard(createInitialBoard());
        setLightsOutBoard(null);
      }, 2000);
    }
  }, [lightsOutBoard, didCelebrateLightsOut]);

  function isTileInCorrectSpot(card, index) {
    return Boolean(card) && card.number === index + 1;
  }

  function onTicTacToeClick(index) {
    if (ticTacToeWaitingAI || ticTacToeGameOver || !ticTacToeBoard || ticTacToeBoard[index].value) return;
    
    const newBoard = ticTacToeBoard.map((cell, i) => 
      i === index ? { ...cell, value: 'X' } : cell
    );
    setTicTacToeBoard(newBoard);
    
    const winner = checkTicTacToeWinner(newBoard);
    if (winner) {
      handleTicTacToeRoundEnd(winner);
      return;
    }
    
    // AI's turn
    setTicTacToeWaitingAI(true);
    setTimeout(() => {
      const aiMove = getAIMove(newBoard);
      if (aiMove !== null) {
        const aiBoard = newBoard.map((cell, i) =>
          i === aiMove ? { ...cell, value: 'O' } : cell
        );
        setTicTacToeBoard(aiBoard);
        
        const aiWinner = checkTicTacToeWinner(aiBoard);
        if (aiWinner) {
          handleTicTacToeRoundEnd(aiWinner);
        }
      }
      setTicTacToeWaitingAI(false);
    }, 600);
  }

  function onLightsOutClick(index) {
    if (!lightsOutBoard) return;
    const newBoard = toggleLightsOutTile(lightsOutBoard, index);
    setLightsOutBoard(newBoard);
  }

  function handleTicTacToeRoundEnd(winner) {
    setTicTacToeGameOver(true);
    
    // If it's a draw, ignore it and just start a new round
    if (winner === 'draw') {
      setTimeout(() => {
        setTicTacToeBoard(createTicTacToeBoard());
        setTicTacToeGameOver(false);
      }, 1500);
      return;
    }
    
    if (winner === 'X') {
      setTicTacToeScores(prev => ({ ...prev, player: prev.player + 1 }));
    } else if (winner === 'O') {
      setTicTacToeScores(prev => ({ ...prev, ai: prev.ai + 1 }));
    }
    
    setTimeout(() => {
      const newScores = winner === 'X' 
        ? { player: ticTacToeScores.player + 1, ai: ticTacToeScores.ai }
        : winner === 'O'
        ? { player: ticTacToeScores.player, ai: ticTacToeScores.ai + 1 }
        : ticTacToeScores;
      
      if (newScores.player === 2) {
        // Player wins best of 3! Move to Lights Out
        if (stopConfettiRef.current) stopConfettiRef.current();
        stopConfettiRef.current = startConfetti(confettiCanvasRef.current, {
          durationMs: 3200,
        });
        setTimeout(() => {
          setGameMode('lightsout');
          setLightsOutBoard(createLightsOutBoard());
          setTicTacToeBoard(null);
          setTicTacToeScores({ player: 0, ai: 0 });
          setCurrentTicTacToeRound(0);
        }, 1500);
      } else if (newScores.ai === 2) {
        // AI wins best of 3 - restart
        setTimeout(() => {
          setGameMode('puzzle');
          setPuzzleBoard(createInitialBoard());
          setTicTacToeBoard(null);
          setTicTacToeScores({ player: 0, ai: 0 });
          setCurrentTicTacToeRound(0);
        }, 1500);
      } else {
        // Next round
        setCurrentTicTacToeRound(prev => prev + 1);
        setTicTacToeBoard(createTicTacToeBoard());
        setTicTacToeGameOver(false);
      }
    }, 1500);
  }

  useEffect(() => {
    const el = puzzleContainerRef.current;
    if (!el) return;

    const updateWidth = () => setPuzzleContainerWidth(el.clientWidth || 0);
    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  const puzzleCellSize = puzzleContainerWidth > 0
    ? (puzzleContainerWidth - puzzleGapPx * (PUZZLE_SIZE - 1)) / PUZZLE_SIZE
    : 0;
  const puzzleBoardHeight = puzzleCellSize > 0
    ? puzzleCellSize * PUZZLE_SIZE + puzzleGapPx * (PUZZLE_SIZE - 1)
    : 0;

  return (
    <div style={c.page}>
      <canvas
        ref={confettiCanvasRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 100,
        }}
      />
      <nav style={c.nav}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src={getAssetPath('/favicon.webp')} alt="Serble Chat" style={c.logoImg} />
          <h1 style={c.logoText}>Serble Chat</h1>
        </div>
        <a
          href="https://github.com/Serble/SerbleChat"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            color: '#94a3b8', fontSize: '0.9rem',
            textDecoration: 'none', transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => e.target.style.color = '#cbd5e1'}
          onMouseLeave={(e) => e.target.style.color = '#94a3b8'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          GitHub
        </a>
      </nav>

      <section style={c.hero}>
        <img src={getAssetPath('/favicon.webp')} alt="Serble Chat" style={{ width: '12rem', height: '12rem', marginBottom: '2rem', borderRadius: '27px' }} />
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
          background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
          color: '#4ade80', borderRadius: '9999px', padding: '0.5rem 1.25rem',
          fontSize: '0.85rem', fontWeight: 700, marginBottom: '1.5rem',
          letterSpacing: '0.05em',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          No Email Required to Sign Up
        </div>
        <p style={c.sub}>
          Real-time messaging, group chats, guilds, friends. All powered by your Serble account.
        </p>
        {loginError && (
          <div style={{
            background: '#7f1d1d',
            color: '#fca5a5',
            padding: '0.75rem 1.25rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
            maxWidth: '400px',
          }}>
            {loginError}
          </div>
        )}
        <button
          style={{
            ...c.btn,
            opacity: isLoggingIn ? 0.6 : 1,
            cursor: isLoggingIn ? 'not-allowed' : 'pointer',
          }}
          onClick={login}
          disabled={isLoggingIn}
          className="hov-landing-btn"
        >
          {isLoggingIn ? (
            <>⏳ Logging in...</>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
              </svg>
              Login with Serble
            </>
          )}
        </button>
      </section>

      <section style={c.featureSection}>
        {gameMode === 'puzzle' ? (
          <>
            <h2 style={c.featureSectionTitle}>Why Choose Serble Chat? (Sliding Puzzle)</h2>
            <div style={{ color: '#94a3b8', marginBottom: '1rem', textAlign: 'center' }}>
              Click a card adjacent to the empty slot to slide it. Arrange numbers 1 through 8 to win.
            </div>
            <div
              style={{
                ...c.puzzleWrapper,
                height: puzzleBoardHeight > 0 ? `${puzzleBoardHeight}px` : undefined,
              }}
              ref={puzzleContainerRef}
            >
              {puzzleBoard.map((card, index) => {
                const row = Math.floor(index / PUZZLE_SIZE);
                const col = index % PUZZLE_SIZE;

                const left = col * (puzzleCellSize + puzzleGapPx);
                const top = row * (puzzleCellSize + puzzleGapPx);
                const width = puzzleCellSize;
                const height = puzzleCellSize;

                return card ? (
                  <div
                    key={card.id}
                    style={{
                      ...c.card,
                      ...(isTileInCorrectSpot(card, index) ? c.cardCorrect : {}),
                      left,
                      top,
                      width,
                      height,
                      pointerEvents: isAnimating ? 'none' : 'auto',
                    }}
                    onClick={() => onPuzzleCardClick(index)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPuzzleCardClick(index);
                      }
                    }}
                  >
                    <div style={{
                      ...c.cardNumber,
                      ...(isTileInCorrectSpot(card, index) ? c.cardNumberCorrect : {}),
                    }}>{card.number}</div>
                    <div style={c.cardIcon}>{card.icon}</div>
                    <div style={{
                      ...c.cardTitle,
                      ...(isTileInCorrectSpot(card, index) ? c.cardTitleCorrect : {}),
                    }}>{card.title}</div>
                    <div style={c.cardText}>{card.text}</div>
                  </div>
                ) : (
                  <div 
                    key={`empty-${index}`} 
                    style={{
                      ...c.emptyCard,
                      position: 'absolute',
                      left,
                      top,
                      width,
                      height,
                    }} 
                    aria-label="Empty puzzle slot" 
                  />
                );
              })}
            </div>
          </>
        ) : gameMode === 'memory' ? (
          <>
            <h2 style={c.featureSectionTitle}>Memory Game</h2>
            <div style={{ color: '#94a3b8', marginBottom: '1rem', textAlign: 'center' }}>
              Find all matching pairs. Click two tiles to reveal them.
            </div>
            <div style={c.memoryGrid}>
              {memoryBoard && memoryBoard.map((tile, index) => (
                <div
                  key={index}
                  style={{
                    ...c.memoryTile,
                    ...(tile.isMatched ? c.memoryTileMatched : {}),
                    ...(tile.isFlipped && !tile.isMatched ? c.memoryTileFront : {}),
                    ...(tile.isFlipped && tile.isMatched ? c.memoryTileMatched : {}),
                    ...(!tile.isFlipped && !tile.isMatched ? c.memoryTileBack : {}),
                  }}
                  onClick={() => {
                    if (tile.isFlipped || tile.isMatched || memoryFlipped.length >= 2) return;
                    setMemoryBoard(prev =>
                      prev.map((t, i) => i === index ? { ...t, isFlipped: true } : t)
                    );
                    setMemoryFlipped(prev => [...prev, index]);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={tile.isMatched ? 'Matched' : 'Memory tile'}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !tile.isFlipped && !tile.isMatched && memoryFlipped.length < 2) {
                      e.preventDefault();
                      setMemoryBoard(prev =>
                        prev.map((t, i) => i === index ? { ...t, isFlipped: true } : t)
                      );
                      setMemoryFlipped(prev => [...prev, index]);
                    }
                  }}
                >
                  {tile.isFlipped && (
                    <>
                      <div style={c.memoryIcon}>{tile.card.icon}</div>
                      <div style={c.memoryTitle}>{tile.card.title}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : gameMode === 'tictactoe' ? (
          <>
            <h2 style={c.featureSectionTitle}>Naughts & Crosses - Best of 3</h2>
            <div style={c.ticTacToeScore}>
              <div style={c.ticTacToeScoreItem}>
                <div style={c.ticTacToeScoreLabel}>You (X)</div>
                <div style={c.ticTacToeScoreValue}>{ticTacToeScores.player}</div>
              </div>
              <div style={c.ticTacToeScoreItem}>
                <div style={c.ticTacToeScoreLabel}>AI (O)</div>
                <div style={c.ticTacToeScoreValue}>{ticTacToeScores.ai}</div>
              </div>
            </div>
            <div style={{ color: '#94a3b8', marginBottom: '1.5rem', textAlign: 'center' }}>
              {ticTacToeGameOver 
                ? 'Round complete! Starting next round...' 
                : ticTacToeWaitingAI 
                ? 'AI is thinking...' 
                : `Round ${currentTicTacToeRound} - Your turn!`}
            </div>
            <div style={c.ticTacToeGrid}>
              {ticTacToeBoard && ticTacToeBoard.map((cell, index) => (
                <div
                  key={index}
                  style={{
                    ...c.ticTacToeCell,
                    ...(cell.value === 'X' ? { ...c.ticTacToeCellPlayer, ...c.ticTacToeCellActive } : {}),
                    ...(cell.value === 'O' ? { ...c.ticTacToeCellAI, ...c.ticTacToeCellActive } : {}),
                    cursor: (ticTacToeWaitingAI || ticTacToeGameOver || cell.value) ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => onTicTacToeClick(index)}
                  role="button"
                  tabIndex={0}
                  aria-label={cell.value ? `${cell.value}` : 'Empty cell'}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !cell.value && !ticTacToeWaitingAI && !ticTacToeGameOver) {
                      e.preventDefault();
                      onTicTacToeClick(index);
                    }
                  }}
                >
                  <div style={c.ticTacToeCellContent}>
                    {cell.card.isSerble ? (
                      <img src={getAssetPath('/favicon.webp')} alt="Serble Chat" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '4px' }} />
                    ) : (
                      <div style={c.ticTacToeCellIcon}>{cell.card.icon}</div>
                    )}
                    <div style={c.ticTacToeCellTitle}>{cell.card.title}</div>
                  </div>
                  {cell.value && (
                    <div style={c.ticTacToeSymbol}>{cell.value}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : gameMode === 'lightsout' ? (
          <>
            <h2 style={c.featureSectionTitle}>Lights Out</h2>
            <div style={{ color: '#94a3b8', marginBottom: '1rem', textAlign: 'center' }}>
              Turn off all the lights. Click a tile to toggle it and its neighbors.
            </div>
            {!lightsOutBoard ? (
              <div style={{ color: '#94a3b8' }}>Loading Lights Out game...</div>
            ) : !lightsOutBoard.length || lightsOutBoard.length === 0 ? (
              <div style={{ color: '#94a3b8' }}>Invalid board - no tiles</div>
            ) : (
            <div style={c.lightsOutGrid}>
              {lightsOutBoard.map((tile, index) => {
                const safeTile = tile ?? { isLit: false, card: null };
                const safeCard = safeTile.card ?? { icon: '?', title: 'Unknown tile', text: '' };
                return (
                <div
                  key={index}
                  style={{
                    ...c.lightsOutTile,
                    ...(safeTile.isLit ? c.lightsOutTileLit : c.lightsOutTileDark),
                  }}
                  onClick={() => onLightsOutClick(index)}
                  role="button"
                  tabIndex={0}
                  aria-label={safeCard.title}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onLightsOutClick(index);
                    }
                  }}
                >
                  <div style={c.lightsOutTileContent}>
                    {safeCard.isSerble ? (
                      <img src={getAssetPath('/favicon.webp')} alt="Serble Chat" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '4px' }} />
                    ) : (
                      <div style={c.lightsOutTileIcon}>{safeCard.icon}</div>
                    )}
                    <div style={c.lightsOutTileTitle}>{safeCard.title}</div>
                  </div>
                </div>
              );
              })}
            </div>
            )}
          </>
        ) : null}
      </section>

      <section style={{
        padding: '4rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: 'linear-gradient(135deg, rgba(79,172,254,0.08) 0%, rgba(139,92,246,0.05) 100%)',
        borderTop: '1px solid rgba(59,130,246,0.2)',
        borderBottom: '1px solid rgba(59,130,246,0.2)',
      }}>
        <div style={{
          maxWidth: '700px', textAlign: 'center',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
            background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.5)',
            color: '#d8b4fe', borderRadius: '9999px', padding: '0.5rem 1.25rem',
            fontSize: '0.85rem', fontWeight: 700, marginBottom: '1.5rem',
            letterSpacing: '0.05em',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Open Source & Community-Driven
          </div>
          <h2 style={{
            fontSize: '2rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 1rem', lineHeight: 1.2,
            letterSpacing: '-0.02em',
          }}>
            Built in the <span style={{ color: '#d8b4fe' }}>Open</span>
          </h2>
          <p style={{
            fontSize: '1rem', color: '#cbd5e1', margin: '0 0 2rem', lineHeight: 1.7,
          }}>
            Serble Chat is completely open source. Inspect the code, contribute features, report issues, or fork it for your own community. 
            We believe in transparency and the power of collaborative development. Your privacy and security matter—and you can verify it yourself.
          </p>
          <a
            href="https://github.com/Serble/SerbleChat"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.85rem 2.25rem',
              background: 'rgba(139,92,246,0.3)', border: '2px solid rgba(139,92,246,0.6)',
              color: '#d8b4fe', borderRadius: '9999px',
              fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
              textDecoration: 'none',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(139,92,246,0.5)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(139,92,246,0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(139,92,246,0.3)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Explore on GitHub
          </a>
        </div>
      </section>
    </div>
  );
}
