import { pickBookMove } from './openingBook.js';
import { MATE_THRESHOLD } from './search.js';
import { moveToUCI } from '../chess/constants.js';

export const BOT_PROFILES = [
  {
    id: 'martin',
    name: 'Martin',
    elo: 400,
    tier: 'Beginner',
    avatar: '🧔',
    color: '#6fb556',
    bio: 'Friendly beginner who plays quickly and occasionally hangs pieces.'
  },
  {
    id: 'elani',
    name: 'Elani',
    elo: 600,
    tier: 'Novice',
    avatar: '👩🏽',
    color: '#7ab855',
    bio: 'Knows piece values and basic captures, still misses simple tactics.'
  },
  {
    id: 'emir',
    name: 'Emir',
    elo: 800,
    tier: 'Casual',
    avatar: '🧑🏻',
    color: '#8ab449',
    bio: 'Develops actively and loves open lines, but vulnerable to forks.'
  },
  {
    id: 'sven',
    name: 'Sven',
    elo: 1000,
    tier: 'Club Novice',
    avatar: '👨🏼',
    color: '#d4a63a',
    bio: 'Solid opening habits and spots 1-move threats reliably.'
  },
  {
    id: 'nelson',
    name: 'Nelson',
    elo: 1200,
    tier: 'Intermediate',
    avatar: '🕶️',
    color: '#df8b33',
    bio: 'Aggressive tactician who tries to punish passive play early.'
  },
  {
    id: 'isabel',
    name: 'Isabel',
    elo: 1400,
    tier: 'Club Player',
    avatar: '👩🏻‍💼',
    color: '#dc7331',
    bio: 'Balanced positional and tactical player who converts advantages cleanly.'
  },
  {
    id: 'wally',
    name: 'Wally',
    elo: 1600,
    tier: 'Advanced',
    avatar: '🧙‍♂️',
    color: '#c95248',
    bio: 'Calculates sharp 4-5 ply combinations and plays main-line theory.'
  },
  {
    id: 'li',
    name: 'Li',
    elo: 1800,
    tier: 'Expert',
    avatar: '🥋',
    color: '#a948a8',
    bio: 'Disciplined, accurate, and tough to crack in quiet endgames.'
  },
  {
    id: 'noam',
    name: 'Noam',
    elo: 2000,
    tier: 'Master',
    avatar: '👑',
    color: '#5c8bb0',
    bio: 'Deep tactical vision with near-flawless calculation.'
  },
  {
    id: 'arena-max',
    name: 'Arena Max',
    elo: 2200,
    tier: 'Engine Max',
    avatar: '🤖',
    color: '#1baca6',
    bio: 'Full-strength custom engine with zero artificial throttling.'
  }
];

/**
 * Calibrate search & move-selection parameters smoothly for any ELO in [400, 2200].
 */
export function getEloParameters(elo) {
  const clamped = Math.max(400, Math.min(2200, Number(elo) || 1200));
  const t = (clamped - 400) / 1800; // 0.0 at 400 ELO -> 1.0 at 2200 ELO

  let maxDepth = 2;
  let maxTimeMs = 120;
  let bookMaxPly = 0;

  if (clamped <= 550) {
    maxDepth = 1;
    maxTimeMs = 80;
    bookMaxPly = 2;
  } else if (clamped <= 850) {
    maxDepth = 2;
    maxTimeMs = 150;
    bookMaxPly = 4;
  } else if (clamped <= 1150) {
    maxDepth = 3;
    maxTimeMs = 240;
    bookMaxPly = 6;
  } else if (clamped <= 1450) {
    maxDepth = 4;
    maxTimeMs = 380;
    bookMaxPly = 8;
  } else if (clamped <= 1750) {
    maxDepth = 5;
    maxTimeMs = 550;
    bookMaxPly = 10;
  } else if (clamped <= 2000) {
    maxDepth = 6;
    maxTimeMs = 850;
    bookMaxPly = 12;
  } else {
    maxDepth = 7;
    maxTimeMs = 1350;
    bookMaxPly = 14;
  }

  // Noise & blunder probabilities decrease sharply as ELO rises
  const noiseCp = Math.round(Math.pow(1 - t, 2.0) * 340);
  const blunderRate = clamped >= 1700 ? 0 : Math.max(0, Math.pow(1 - t, 2.6) * 0.34);
  const multiPV = clamped >= 1950 ? 1 : 6;

  return {
    elo: clamped,
    maxDepth,
    maxTimeMs,
    noiseCp,
    blunderRate,
    bookMaxPly,
    multiPV
  };
}

/**
 * Pick an ELO-appropriate move using our custom engine + opening book.
 */
export function chooseBotMove(board, uciHistory, elo, engine) {
  const params = getEloParameters(elo);

  // 1. Opening book lookup (higher ELO bots use deeper theory)
  if (uciHistory.length < params.bookMaxPly && Math.random() < 0.85) {
    const bookUci = pickBookMove(uciHistory);
    if (bookUci) {
      const bookMove = board.uciToMove(bookUci);
      if (bookMove) {
        return {
          move: bookMove,
          uci: bookUci,
          fromBook: true,
          searchInfo: { depth: 0, nodes: 0, timeMs: 1, score: 0 }
        };
      }
    }
  }

  // 2. Run custom engine search
  const result = engine.search(board, {
    maxDepth: params.maxDepth,
    maxTimeMs: params.maxTimeMs,
    multiPV: params.multiPV
  });

  if (!result.bestMove) {
    return { move: 0, uci: null, fromBook: false, searchInfo: result };
  }

  // Maximum strength plays the strict top engine move
  if (params.noiseCp === 0 || result.candidates.length <= 1) {
    return {
      move: result.bestMove,
      uci: moveToUCI(result.bestMove),
      fromBook: false,
      searchInfo: result
    };
  }

  const candidates = result.candidates;
  const bestScore = candidates[0].score;

  // Always play forced mate-in-1 if ELO >= 700
  if (params.elo >= 700 && bestScore > MATE_THRESHOLD && candidates[0].pv.length <= 2) {
    return {
      move: candidates[0].move,
      uci: candidates[0].uci,
      fromBook: false,
      searchInfo: result
    };
  }

  // Controlled human-like blunder for low/mid ELOs
  if (params.blunderRate > 0 && Math.random() < params.blunderRate) {
    const legal = board.generateLegalMoves();
    if (legal.length > 1) {
      // Pick a suboptimal move from candidate list or random legal move for very low ELO
      if (params.elo <= 600) {
        const pick = legal[Math.floor(Math.random() * legal.length)];
        return {
          move: pick,
          uci: moveToUCI(pick),
          fromBook: false,
          searchInfo: result
        };
      } else {
        const idx = Math.min(candidates.length - 1, 1 + Math.floor(Math.random() * (candidates.length - 1)));
        const pick = candidates[idx];
        return {
          move: pick.move,
          uci: pick.uci,
          fromBook: false,
          searchInfo: result
        };
      }
    }
  }

  // Softmax-weighted selection with ELO noise
  const temperature = Math.max(18, params.noiseCp * 0.55);
  const weights = candidates.map((c) => {
    const diff = Math.max(-900, Math.min(0, c.score - bestScore));
    return Math.exp(diff / temperature);
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let chosen = candidates[0];
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      chosen = candidates[i];
      break;
    }
  }

  return {
    move: chosen.move,
    uci: chosen.uci,
    fromBook: false,
    searchInfo: result
  };
}
