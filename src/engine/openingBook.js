// Curated opening book with ECO codes, names, and weighted UCI continuations

const OPENING_LINES = [
  // Open Games (1. e4 e5)
  { moves: 'e2e4', eco: 'B00', name: "King's Pawn Opening" },
  { moves: 'e2e4 e7e5', eco: 'C20', name: "King's Pawn Game" },
  { moves: 'e2e4 e7e5 g1f3', eco: 'C40', name: "King's Knight Opening" },
  { moves: 'e2e4 e7e5 g1f3 b8c6', eco: 'C44', name: "King's Knight Opening" },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1b5', eco: 'C60', name: 'Ruy Lopez' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6', eco: 'C70', name: 'Ruy Lopez: Morphy Defense' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1', eco: 'C78', name: 'Ruy Lopez: Closed' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6', eco: 'C65', name: 'Ruy Lopez: Berlin Defense' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1c4', eco: 'C50', name: 'Italian Game' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5', eco: 'C50', name: 'Italian Game: Giuoco Piano' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3', eco: 'C53', name: 'Italian Game: Giuoco Pianissimo' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6', eco: 'C55', name: 'Italian Game: Two Knights Defense' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5', eco: 'C57', name: 'Italian Game: Fried Liver Attack' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 d2d4', eco: 'C44', name: 'Scotch Game' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4', eco: 'C45', name: 'Scotch Game: Classical' },
  { moves: 'e2e4 e7e5 g1f3 b8c6 b1c3 g8f6', eco: 'C47', name: 'Four Knights Game' },
  { moves: 'e2e4 e7e5 g1f3 g8f6', eco: 'C42', name: "Petrov's Defense" },
  { moves: 'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4', eco: 'C42', name: "Petrov's Defense: Classical" },
  { moves: 'e2e4 e7e5 g1f3 d7d6', eco: 'C41', name: 'Philidor Defense' },
  { moves: 'e2e4 e7e5 b1c3', eco: 'C25', name: 'Vienna Game' },
  { moves: 'e2e4 e7e5 b1c3 g8f6 f2f4', eco: 'C29', name: 'Vienna Gambit' },
  { moves: 'e2e4 e7e5 f2f4', eco: 'C30', name: "King's Gambit" },
  { moves: 'e2e4 e7e5 f2f4 e5f4 g1f3', eco: 'C34', name: "King's Gambit Accepted" },
  { moves: 'e2e4 e7e5 f1c4', eco: 'C23', name: "Bishop's Opening" },

  // Semi-Open Games (1. e4 ...)
  { moves: 'e2e4 c7c5', eco: 'B20', name: 'Sicilian Defense' },
  { moves: 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3', eco: 'B56', name: 'Sicilian Defense: Open' },
  { moves: 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6', eco: 'B90', name: 'Sicilian Defense: Najdorf' },
  { moves: 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6', eco: 'B70', name: 'Sicilian Defense: Dragon' },
  { moves: 'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4', eco: 'B32', name: 'Sicilian Defense: Open' },
  { moves: 'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4', eco: 'B40', name: 'Sicilian Defense: Kan / Taimanov' },
  { moves: 'e2e4 c7c5 b1c3', eco: 'B23', name: 'Sicilian Defense: Closed' },
  { moves: 'e2e4 c7c5 c2c3', eco: 'B22', name: 'Sicilian Defense: Alapin' },
  { moves: 'e2e4 e7e6', eco: 'C00', name: 'French Defense' },
  { moves: 'e2e4 e7e6 d2d4 d7d5', eco: 'C00', name: 'French Defense' },
  { moves: 'e2e4 e7e6 d2d4 d7d5 e4e5', eco: 'C02', name: 'French Defense: Advance' },
  { moves: 'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6', eco: 'C11', name: 'French Defense: Classical' },
  { moves: 'e2e4 e7e6 d2d4 d7d5 e4d5 e6d5', eco: 'C01', name: 'French Defense: Exchange' },
  { moves: 'e2e4 c7c6', eco: 'B10', name: 'Caro-Kann Defense' },
  { moves: 'e2e4 c7c6 d2d4 d7d5', eco: 'B12', name: 'Caro-Kann Defense' },
  { moves: 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5', eco: 'B18', name: 'Caro-Kann: Classical' },
  { moves: 'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5', eco: 'B12', name: 'Caro-Kann: Advance' },
  { moves: 'e2e4 d7d5', eco: 'B01', name: 'Scandinavian Defense' },
  { moves: 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5', eco: 'B01', name: 'Scandinavian Defense: Main Line' },
  { moves: 'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6', eco: 'B07', name: 'Pirc Defense' },
  { moves: 'e2e4 g8f6', eco: 'B02', name: "Alekhine's Defense" },

  // Closed & Queen's Pawn Games (1. d4 ...)
  { moves: 'd2d4', eco: 'A40', name: "Queen's Pawn Opening" },
  { moves: 'd2d4 d7d5', eco: 'D00', name: "Queen's Pawn Game" },
  { moves: 'd2d4 d7d5 c2c4', eco: 'D06', name: "Queen's Gambit" },
  { moves: 'd2d4 d7d5 c2c4 e7e6', eco: 'D30', name: "Queen's Gambit Declined" },
  { moves: 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7', eco: 'D37', name: "Queen's Gambit Declined: Orthodox" },
  { moves: 'd2d4 d7d5 c2c4 c7c6', eco: 'D10', name: 'Slav Defense' },
  { moves: 'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3', eco: 'D15', name: 'Slav Defense: Main Line' },
  { moves: 'd2d4 d7d5 c2c4 d5c4', eco: 'D20', name: "Queen's Gambit Accepted" },
  { moves: 'd2d4 d7d5 c1f4', eco: 'D00', name: 'London System' },
  { moves: 'd2d4 d7d5 c1f4 g8f6 e2e3 c7c5 c2c3', eco: 'D02', name: 'London System' },
  { moves: 'd2d4 g8f6', eco: 'A45', name: 'Indian Defense' },
  { moves: 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6', eco: 'E60', name: "King's Indian Defense" },
  { moves: 'd2d4 g8f6 c2c4 g7g6 b1c3 d7d5', eco: 'D80', name: 'Grünfeld Defense' },
  { moves: 'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4', eco: 'E20', name: 'Nimzo-Indian Defense' },
  { moves: 'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6', eco: 'E12', name: "Queen's Indian Defense" },
  { moves: 'd2d4 g8f6 c1f4 d7d5 e2e3', eco: 'D02', name: 'London System' },
  { moves: 'd2d4 f7f5', eco: 'A80', name: 'Dutch Defense' },

  // Flank Openings
  { moves: 'c2c4', eco: 'A10', name: 'English Opening' },
  { moves: 'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6', eco: 'A28', name: 'English Opening: Four Knights' },
  { moves: 'c2c4 c7c5 b1c3 b8c6', eco: 'A34', name: 'English Opening: Symmetrical' },
  { moves: 'g1f3', eco: 'A04', name: 'Réti Opening' },
  { moves: 'g1f3 d7d5 c2c4', eco: 'A09', name: 'Réti Opening' },
  { moves: 'g1f3 d7d5 g2g3', eco: 'A07', name: "King's Indian Attack" },
  { moves: 'b2b3', eco: 'A01', name: "Nimzo-Larsen Attack" },
  { moves: 'f2f4', eco: 'A02', name: "Bird's Opening" }
];

// Build prefix tree for fast lookup of opening names & book continuations
const BOOK_TREE = new Map();

function ensureNode(key) {
  if (!BOOK_TREE.has(key)) {
    BOOK_TREE.set(key, { eco: null, name: null, continuations: new Map() });
  }
  return BOOK_TREE.get(key);
}

for (const line of OPENING_LINES) {
  const parts = line.moves.split(' ');
  let prefix = '';
  for (let i = 0; i < parts.length; i++) {
    const uci = parts[i];
    const parentNode = ensureNode(prefix);
    parentNode.continuations.set(uci, (parentNode.continuations.get(uci) || 0) + 1);

    prefix = prefix ? `${prefix} ${uci}` : uci;
    const childNode = ensureNode(prefix);
    if (i === parts.length - 1) {
      childNode.eco = line.eco;
      childNode.name = line.name;
    }
  }
}

export function lookupOpening(uciHistory) {
  let latestEco = '';
  let latestName = 'Starting Position';
  let prefix = '';

  for (let i = 0; i < uciHistory.length; i++) {
    prefix = prefix ? `${prefix} ${uciHistory[i]}` : uciHistory[i];
    const node = BOOK_TREE.get(prefix);
    if (node && node.name) {
      latestEco = node.eco;
      latestName = node.name;
    }
  }

  const exactKey = uciHistory.join(' ');
  const exactNode = BOOK_TREE.get(exactKey);
  const continuations = exactNode
    ? Array.from(exactNode.continuations.entries()).map(([uci, weight]) => ({ uci, weight }))
    : [];

  return {
    eco: latestEco,
    name: latestName,
    inBook: Boolean(exactNode),
    continuations
  };
}

export function isOpeningBookMove(uciHistoryBefore, moveUci) {
  const key = uciHistoryBefore.join(' ');
  const node = BOOK_TREE.get(key);
  if (!node) return false;
  return node.continuations.has(moveUci);
}

export function pickBookMove(uciHistory) {
  const key = uciHistory.join(' ');
  const node = BOOK_TREE.get(key);
  if (!node || node.continuations.size === 0) return null;

  const entries = Array.from(node.continuations.entries());
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * totalWeight;
  for (const [uci, w] of entries) {
    r -= w;
    if (r <= 0) return uci;
  }
  return entries[0][0];
}
