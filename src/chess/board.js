import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  WP, WN, WB, WR, WQ, WK, BP, BN, BB, BR, BQ, BK,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
  FLAG_NONE, FLAG_CAPTURE, FLAG_DOUBLE_PAWN, FLAG_EN_PASSANT,
  FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_PROMOTION,
  START_FEN, PIECE_CHARS, CHAR_TO_PIECE, FILES, RANKS,
  encodeMove, moveFrom, moveTo, moveFlags, movePromo, moveCapturedType,
  isCapture, sqToAlgebraic, algebraicToSq, moveToUCI, pieceIndex
} from './constants.js';

// Deterministic PRNG for Zobrist hashing (two 32-bit halves per key)
function createZobrist() {
  let seed = 0x9e3779b9;
  const next32 = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };

  const pieceLo = new Uint32Array(12 * 64);
  const pieceHi = new Uint32Array(12 * 64);
  for (let i = 0; i < 12 * 64; i++) {
    pieceLo[i] = next32();
    pieceHi[i] = next32();
  }

  const castleLo = new Uint32Array(16);
  const castleHi = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    castleLo[i] = next32();
    castleHi[i] = next32();
  }

  const epLo = new Uint32Array(9);
  const epHi = new Uint32Array(9);
  for (let i = 0; i < 9; i++) {
    epLo[i] = next32();
    epHi[i] = next32();
  }

  const sideLo = next32();
  const sideHi = next32();

  return { pieceLo, pieceHi, castleLo, castleHi, epLo, epHi, sideLo, sideHi };
}

export const ZOBRIST = createZobrist();

// Castling mask cleared whenever a piece moves from or is captured on a corner/king square
const CASTLE_MASK = new Uint8Array(64).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_BQ;  // a8
CASTLE_MASK[4] = 15 & ~(CASTLE_BK | CASTLE_BQ); // e8
CASTLE_MASK[7] = 15 & ~CASTLE_BK;  // h8
CASTLE_MASK[56] = 15 & ~CASTLE_WQ; // a1
CASTLE_MASK[60] = 15 & ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_MASK[63] = 15 & ~CASTLE_WK; // h1

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1]
];

const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1]
];

const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export class ChessBoard {
  constructor(fen = START_FEN) {
    this.squares = new Int8Array(64);
    this.turn = WHITE;
    this.castling = 0;
    this.epSquare = -1;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.whiteKingSq = 60;
    this.blackKingSq = 4;
    this.hashLo = 0;
    this.hashHi = 0;

    // Undo stack for fast search make/unmake
    this.history = [];
    this.positionHashHistory = [];

    this.loadFEN(fen);
  }

  clone() {
    const copy = new ChessBoard(this.toFEN());
    copy.positionHashHistory = this.positionHashHistory.slice();
    return copy;
  }

  loadFEN(fen) {
    this.squares.fill(EMPTY);
    this.history = [];
    this.positionHashHistory = [];

    const parts = fen.trim().split(/\s+/);
    const boardPart = parts[0];
    const turnPart = parts[1] || 'w';
    const castlePart = parts[2] || '-';
    const epPart = parts[3] || '-';
    const halfPart = parts[4] || '0';
    const fullPart = parts[5] || '1';

    let sq = 0;
    for (let i = 0; i < boardPart.length; i++) {
      const ch = boardPart[i];
      if (ch === '/') continue;
      if (ch >= '1' && ch <= '8') {
        sq += ch.charCodeAt(0) - 48;
      } else {
        const piece = CHAR_TO_PIECE[ch];
        if (piece !== undefined) {
          this.squares[sq] = piece;
          if (piece === WK) this.whiteKingSq = sq;
          else if (piece === BK) this.blackKingSq = sq;
          sq++;
        }
      }
    }

    this.turn = turnPart === 'b' ? BLACK : WHITE;

    this.castling = 0;
    if (castlePart.includes('K')) this.castling |= CASTLE_WK;
    if (castlePart.includes('Q')) this.castling |= CASTLE_WQ;
    if (castlePart.includes('k')) this.castling |= CASTLE_BK;
    if (castlePart.includes('q')) this.castling |= CASTLE_BQ;

    this.epSquare = epPart !== '-' ? algebraicToSq(epPart) : -1;
    this.halfmoveClock = parseInt(halfPart, 10) || 0;
    this.fullmoveNumber = parseInt(fullPart, 10) || 1;

    this.recomputeHash();
    this.positionHashHistory.push(this.getHashKey());
  }

  toFEN() {
    let fen = '';
    for (let rank = 0; rank < 8; rank++) {
      let emptyCount = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.squares[(rank << 3) | file];
        if (p === EMPTY) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            fen += emptyCount;
            emptyCount = 0;
          }
          fen += PIECE_CHARS[p];
        }
      }
      if (emptyCount > 0) fen += emptyCount;
      if (rank < 7) fen += '/';
    }

    const turnStr = this.turn === WHITE ? 'w' : 'b';
    let castleStr = '';
    if (this.castling & CASTLE_WK) castleStr += 'K';
    if (this.castling & CASTLE_WQ) castleStr += 'Q';
    if (this.castling & CASTLE_BK) castleStr += 'k';
    if (this.castling & CASTLE_BQ) castleStr += 'q';
    if (!castleStr) castleStr = '-';

    const epStr = this.epSquare >= 0 ? sqToAlgebraic(this.epSquare) : '-';
    return `${fen} ${turnStr} ${castleStr} ${epStr} ${this.halfmoveClock} ${this.fullmoveNumber}`;
  }

  recomputeHash() {
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.squares[sq];
      if (p !== EMPTY) {
        const idx = pieceIndex(p) * 64 + sq;
        lo ^= ZOBRIST.pieceLo[idx];
        hi ^= ZOBRIST.pieceHi[idx];
      }
    }
    lo ^= ZOBRIST.castleLo[this.castling];
    hi ^= ZOBRIST.castleHi[this.castling];
    const epIdx = this.epSquare >= 0 ? (this.epSquare & 7) : 8;
    lo ^= ZOBRIST.epLo[epIdx];
    hi ^= ZOBRIST.epHi[epIdx];
    if (this.turn === BLACK) {
      lo ^= ZOBRIST.sideLo;
      hi ^= ZOBRIST.sideHi;
    }
    this.hashLo = lo >>> 0;
    this.hashHi = hi >>> 0;
  }

  getHashKey() {
    // 53-bit safe numeric key combining hashLo and top 21 bits of hashHi
    return this.hashLo + (this.hashHi & 0x1fffff) * 4294967296;
  }

  isSquareAttacked(sq, byColor) {
    const rank = sq >> 3;
    const file = sq & 7;
    const squares = this.squares;

    // 1. Pawns
    // White pawns attack upwards (from rank+1 to rank), Black pawns attack downwards (from rank-1 to rank)
    const pawnRank = byColor === WHITE ? rank + 1 : rank - 1;
    if (pawnRank >= 0 && pawnRank <= 7) {
      const targetPawn = byColor * PAWN;
      if (file > 0 && squares[(pawnRank << 3) | (file - 1)] === targetPawn) return true;
      if (file < 7 && squares[(pawnRank << 3) | (file + 1)] === targetPawn) return true;
    }

    // 2. Knights
    const targetKnight = byColor * KNIGHT;
    for (let i = 0; i < 8; i++) {
      const nr = rank + KNIGHT_OFFSETS[i][0];
      const nf = file + KNIGHT_OFFSETS[i][1];
      if (nr >= 0 && nr <= 7 && nf >= 0 && nf <= 7) {
        if (squares[(nr << 3) | nf] === targetKnight) return true;
      }
    }

    // 3. King
    const targetKing = byColor * KING;
    for (let i = 0; i < 8; i++) {
      const kr = rank + KING_OFFSETS[i][0];
      const kf = file + KING_OFFSETS[i][1];
      if (kr >= 0 && kr <= 7 && kf >= 0 && kf <= 7) {
        if (squares[(kr << 3) | kf] === targetKing) return true;
      }
    }

    // 4. Bishops / Queens (diagonals)
    const targetBishop = byColor * BISHOP;
    const targetQueen = byColor * QUEEN;
    for (let d = 0; d < 4; d++) {
      const dr = BISHOP_DIRS[d][0];
      const df = BISHOP_DIRS[d][1];
      let r = rank + dr;
      let f = file + df;
      while (r >= 0 && r <= 7 && f >= 0 && f <= 7) {
        const p = squares[(r << 3) | f];
        if (p !== EMPTY) {
          if (p === targetBishop || p === targetQueen) return true;
          break;
        }
        r += dr;
        f += df;
      }
    }

    // 5. Rooks / Queens (orthogonals)
    const targetRook = byColor * ROOK;
    for (let d = 0; d < 4; d++) {
      const dr = ROOK_DIRS[d][0];
      const df = ROOK_DIRS[d][1];
      let r = rank + dr;
      let f = file + df;
      while (r >= 0 && r <= 7 && f >= 0 && f <= 7) {
        const p = squares[(r << 3) | f];
        if (p !== EMPTY) {
          if (p === targetRook || p === targetQueen) return true;
          break;
        }
        r += dr;
        f += df;
      }
    }

    return false;
  }

  getAttackers(sq, byColor) {
    const attackers = [];
    const rank = sq >> 3;
    const file = sq & 7;
    const squares = this.squares;

    const pawnRank = byColor === WHITE ? rank + 1 : rank - 1;
    if (pawnRank >= 0 && pawnRank <= 7) {
      const targetPawn = byColor * PAWN;
      if (file > 0 && squares[(pawnRank << 3) | (file - 1)] === targetPawn) {
        attackers.push({ sq: (pawnRank << 3) | (file - 1), piece: targetPawn });
      }
      if (file < 7 && squares[(pawnRank << 3) | (file + 1)] === targetPawn) {
        attackers.push({ sq: (pawnRank << 3) | (file + 1), piece: targetPawn });
      }
    }

    const targetKnight = byColor * KNIGHT;
    for (let i = 0; i < 8; i++) {
      const nr = rank + KNIGHT_OFFSETS[i][0];
      const nf = file + KNIGHT_OFFSETS[i][1];
      if (nr >= 0 && nr <= 7 && nf >= 0 && nf <= 7) {
        const s = (nr << 3) | nf;
        if (squares[s] === targetKnight) attackers.push({ sq: s, piece: targetKnight });
      }
    }

    const targetKing = byColor * KING;
    for (let i = 0; i < 8; i++) {
      const kr = rank + KING_OFFSETS[i][0];
      const kf = file + KING_OFFSETS[i][1];
      if (kr >= 0 && kr <= 7 && kf >= 0 && kf <= 7) {
        const s = (kr << 3) | kf;
        if (squares[s] === targetKing) attackers.push({ sq: s, piece: targetKing });
      }
    }

    const targetBishop = byColor * BISHOP;
    const targetQueen = byColor * QUEEN;
    for (let d = 0; d < 4; d++) {
      const dr = BISHOP_DIRS[d][0];
      const df = BISHOP_DIRS[d][1];
      let r = rank + dr;
      let f = file + df;
      while (r >= 0 && r <= 7 && f >= 0 && f <= 7) {
        const s = (r << 3) | f;
        const p = squares[s];
        if (p !== EMPTY) {
          if (p === targetBishop || p === targetQueen) attackers.push({ sq: s, piece: p });
          break;
        }
        r += dr;
        f += df;
      }
    }

    const targetRook = byColor * ROOK;
    for (let d = 0; d < 4; d++) {
      const dr = ROOK_DIRS[d][0];
      const df = ROOK_DIRS[d][1];
      let r = rank + dr;
      let f = file + df;
      while (r >= 0 && r <= 7 && f >= 0 && f <= 7) {
        const s = (r << 3) | f;
        const p = squares[s];
        if (p !== EMPTY) {
          if (p === targetRook || p === targetQueen) attackers.push({ sq: s, piece: p });
          break;
        }
        r += dr;
        f += df;
      }
    }

    return attackers;
  }

  inCheck(color = this.turn) {
    const kingSq = color === WHITE ? this.whiteKingSq : this.blackKingSq;
    return this.isSquareAttacked(kingSq, -color);
  }

  generatePseudoLegalMoves(capturesOnly = false) {
    const moves = [];
    const squares = this.squares;
    const side = this.turn;
    const enemy = -side;

    for (let sq = 0; sq < 64; sq++) {
      const p = squares[sq];
      if (p === EMPTY || (p > 0 ? WHITE : BLACK) !== side) continue;

      const type = Math.abs(p);
      const rank = sq >> 3;
      const file = sq & 7;

      if (type === PAWN) {
        const dir = side === WHITE ? -1 : 1;
        const startRank = side === WHITE ? 6 : 1;
        const promoRank = side === WHITE ? 0 : 7;
        const nextRank = rank + dir;

        // Forward moves
        if (!capturesOnly && nextRank >= 0 && nextRank <= 7) {
          const oneStep = (nextRank << 3) | file;
          if (squares[oneStep] === EMPTY) {
            if (nextRank === promoRank) {
              moves.push(encodeMove(sq, oneStep, FLAG_PROMOTION, QUEEN, 0));
              moves.push(encodeMove(sq, oneStep, FLAG_PROMOTION, ROOK, 0));
              moves.push(encodeMove(sq, oneStep, FLAG_PROMOTION, BISHOP, 0));
              moves.push(encodeMove(sq, oneStep, FLAG_PROMOTION, KNIGHT, 0));
            } else {
              moves.push(encodeMove(sq, oneStep, FLAG_NONE, 0, 0));
              if (rank === startRank) {
                const twoStep = ((rank + 2 * dir) << 3) | file;
                if (squares[twoStep] === EMPTY) {
                  moves.push(encodeMove(sq, twoStep, FLAG_DOUBLE_PAWN, 0, 0));
                }
              }
            }
          }
        }

        // Captures (including promotion captures and en passant)
        if (nextRank >= 0 && nextRank <= 7) {
          for (let df = -1; df <= 1; df += 2) {
            const nf = file + df;
            if (nf < 0 || nf > 7) continue;
            const targetSq = (nextRank << 3) | nf;
            const targetPiece = squares[targetSq];
            if (targetPiece !== EMPTY && (targetPiece > 0 ? WHITE : BLACK) === enemy) {
              const capType = Math.abs(targetPiece);
              if (nextRank === promoRank) {
                moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE | FLAG_PROMOTION, QUEEN, capType));
                moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE | FLAG_PROMOTION, ROOK, capType));
                moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE | FLAG_PROMOTION, BISHOP, capType));
                moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE | FLAG_PROMOTION, KNIGHT, capType));
              } else {
                moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE, 0, capType));
              }
            } else if (targetSq === this.epSquare) {
              moves.push(encodeMove(sq, targetSq, FLAG_EN_PASSANT | FLAG_CAPTURE, 0, PAWN));
            }
          }
        }
        // In capturesOnly (quiescence), also include queen promotions by push
        if (capturesOnly && nextRank === promoRank) {
          const oneStep = (nextRank << 3) | file;
          if (squares[oneStep] === EMPTY) {
            moves.push(encodeMove(sq, oneStep, FLAG_PROMOTION, QUEEN, 0));
          }
        }
      } else if (type === KNIGHT) {
        for (let i = 0; i < 8; i++) {
          const nr = rank + KNIGHT_OFFSETS[i][0];
          const nf = file + KNIGHT_OFFSETS[i][1];
          if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
          const targetSq = (nr << 3) | nf;
          const tp = squares[targetSq];
          if (tp === EMPTY) {
            if (!capturesOnly) moves.push(encodeMove(sq, targetSq, FLAG_NONE, 0, 0));
          } else if ((tp > 0 ? WHITE : BLACK) === enemy) {
            moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE, 0, Math.abs(tp)));
          }
        }
      } else if (type === BISHOP || type === ROOK || type === QUEEN) {
        const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
        for (let d = 0; d < dirs.length; d++) {
          const dr = dirs[d][0];
          const df = dirs[d][1];
          let r = rank + dr;
          let f = file + df;
          while (r >= 0 && r <= 7 && f >= 0 && f <= 7) {
            const targetSq = (r << 3) | f;
            const tp = squares[targetSq];
            if (tp === EMPTY) {
              if (!capturesOnly) moves.push(encodeMove(sq, targetSq, FLAG_NONE, 0, 0));
            } else {
              if ((tp > 0 ? WHITE : BLACK) === enemy) {
                moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE, 0, Math.abs(tp)));
              }
              break;
            }
            r += dr;
            f += df;
          }
        }
      } else if (type === KING) {
        for (let i = 0; i < 8; i++) {
          const kr = rank + KING_OFFSETS[i][0];
          const kf = file + KING_OFFSETS[i][1];
          if (kr < 0 || kr > 7 || kf < 0 || kf > 7) continue;
          const targetSq = (kr << 3) | kf;
          const tp = squares[targetSq];
          if (tp === EMPTY) {
            if (!capturesOnly) moves.push(encodeMove(sq, targetSq, FLAG_NONE, 0, 0));
          } else if ((tp > 0 ? WHITE : BLACK) === enemy) {
            moves.push(encodeMove(sq, targetSq, FLAG_CAPTURE, 0, Math.abs(tp)));
          }
        }

        // Castling
        if (!capturesOnly) {
          if (side === WHITE && sq === 60) {
            if (
              (this.castling & CASTLE_WK) &&
              squares[61] === EMPTY && squares[62] === EMPTY &&
              squares[63] === WR &&
              !this.isSquareAttacked(60, BLACK) &&
              !this.isSquareAttacked(61, BLACK) &&
              !this.isSquareAttacked(62, BLACK)
            ) {
              moves.push(encodeMove(60, 62, FLAG_CASTLE_K, 0, 0));
            }
            if (
              (this.castling & CASTLE_WQ) &&
              squares[59] === EMPTY && squares[58] === EMPTY && squares[57] === EMPTY &&
              squares[56] === WR &&
              !this.isSquareAttacked(60, BLACK) &&
              !this.isSquareAttacked(59, BLACK) &&
              !this.isSquareAttacked(58, BLACK)
            ) {
              moves.push(encodeMove(60, 58, FLAG_CASTLE_Q, 0, 0));
            }
          } else if (side === BLACK && sq === 4) {
            if (
              (this.castling & CASTLE_BK) &&
              squares[5] === EMPTY && squares[6] === EMPTY &&
              squares[7] === BR &&
              !this.isSquareAttacked(4, WHITE) &&
              !this.isSquareAttacked(5, WHITE) &&
              !this.isSquareAttacked(6, WHITE)
            ) {
              moves.push(encodeMove(4, 6, FLAG_CASTLE_K, 0, 0));
            }
            if (
              (this.castling & CASTLE_BQ) &&
              squares[3] === EMPTY && squares[2] === EMPTY && squares[1] === EMPTY &&
              squares[0] === BR &&
              !this.isSquareAttacked(4, WHITE) &&
              !this.isSquareAttacked(3, WHITE) &&
              !this.isSquareAttacked(2, WHITE)
            ) {
              moves.push(encodeMove(4, 2, FLAG_CASTLE_Q, 0, 0));
            }
          }
        }
      }
    }

    return moves;
  }

  generateLegalMoves(capturesOnly = false) {
    const pseudo = this.generatePseudoLegalMoves(capturesOnly);
    const legal = [];
    const mover = this.turn;
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      this.makeMove(m);
      if (!this.inCheck(mover)) {
        legal.push(m);
      }
      this.unmakeMove(m);
    }
    return legal;
  }

  makeMove(move, trackRepetition = false) {
    const from = moveFrom(move);
    const to = moveTo(move);
    const flags = moveFlags(move);
    const promo = movePromo(move);
    const squares = this.squares;
    const movingPiece = squares[from];
    let capturedPiece = squares[to];

    // Save undo state
    this.history.push({
      move,
      capturedPiece,
      castling: this.castling,
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      whiteKingSq: this.whiteKingSq,
      blackKingSq: this.blackKingSq,
      hashLo: this.hashLo,
      hashHi: this.hashHi,
      trackedRepetition: trackRepetition
    });

    let lo = this.hashLo;
    let hi = this.hashHi;

    // Remove old castling & ep hash
    lo ^= ZOBRIST.castleLo[this.castling];
    hi ^= ZOBRIST.castleHi[this.castling];
    const oldEpIdx = this.epSquare >= 0 ? (this.epSquare & 7) : 8;
    lo ^= ZOBRIST.epLo[oldEpIdx];
    hi ^= ZOBRIST.epHi[oldEpIdx];

    // Remove moving piece from source square
    const movingIdx = pieceIndex(movingPiece) * 64 + from;
    lo ^= ZOBRIST.pieceLo[movingIdx];
    hi ^= ZOBRIST.pieceHi[movingIdx];
    squares[from] = EMPTY;

    // Handle capture
    if (flags & FLAG_EN_PASSANT) {
      const capSq = this.turn === WHITE ? to + 8 : to - 8;
      capturedPiece = squares[capSq];
      const capIdx = pieceIndex(capturedPiece) * 64 + capSq;
      lo ^= ZOBRIST.pieceLo[capIdx];
      hi ^= ZOBRIST.pieceHi[capIdx];
      squares[capSq] = EMPTY;
      this.history[this.history.length - 1].capturedPiece = capturedPiece;
    } else if (capturedPiece !== EMPTY) {
      const capIdx = pieceIndex(capturedPiece) * 64 + to;
      lo ^= ZOBRIST.pieceLo[capIdx];
      hi ^= ZOBRIST.pieceHi[capIdx];
    }

    // Place moved (or promoted) piece on destination
    const placedPiece = promo ? this.turn * promo : movingPiece;
    squares[to] = placedPiece;
    const placedIdx = pieceIndex(placedPiece) * 64 + to;
    lo ^= ZOBRIST.pieceLo[placedIdx];
    hi ^= ZOBRIST.pieceHi[placedIdx];

    // Update king square & castling rook movement
    if (movingPiece === WK) {
      this.whiteKingSq = to;
      if (flags & FLAG_CASTLE_K) {
        lo ^= ZOBRIST.pieceLo[pieceIndex(WR) * 64 + 63];
        hi ^= ZOBRIST.pieceHi[pieceIndex(WR) * 64 + 63];
        lo ^= ZOBRIST.pieceLo[pieceIndex(WR) * 64 + 61];
        hi ^= ZOBRIST.pieceHi[pieceIndex(WR) * 64 + 61];
        squares[63] = EMPTY;
        squares[61] = WR;
      } else if (flags & FLAG_CASTLE_Q) {
        lo ^= ZOBRIST.pieceLo[pieceIndex(WR) * 64 + 56];
        hi ^= ZOBRIST.pieceHi[pieceIndex(WR) * 64 + 56];
        lo ^= ZOBRIST.pieceLo[pieceIndex(WR) * 64 + 59];
        hi ^= ZOBRIST.pieceHi[pieceIndex(WR) * 64 + 59];
        squares[56] = EMPTY;
        squares[59] = WR;
      }
    } else if (movingPiece === BK) {
      this.blackKingSq = to;
      if (flags & FLAG_CASTLE_K) {
        lo ^= ZOBRIST.pieceLo[pieceIndex(BR) * 64 + 7];
        hi ^= ZOBRIST.pieceHi[pieceIndex(BR) * 64 + 7];
        lo ^= ZOBRIST.pieceLo[pieceIndex(BR) * 64 + 5];
        hi ^= ZOBRIST.pieceHi[pieceIndex(BR) * 64 + 5];
        squares[7] = EMPTY;
        squares[5] = BR;
      } else if (flags & FLAG_CASTLE_Q) {
        lo ^= ZOBRIST.pieceLo[pieceIndex(BR) * 64 + 0];
        hi ^= ZOBRIST.pieceHi[pieceIndex(BR) * 64 + 0];
        lo ^= ZOBRIST.pieceLo[pieceIndex(BR) * 64 + 3];
        hi ^= ZOBRIST.pieceHi[pieceIndex(BR) * 64 + 3];
        squares[0] = EMPTY;
        squares[3] = BR;
      }
    }

    // Update castling rights
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= ZOBRIST.castleLo[this.castling];
    hi ^= ZOBRIST.castleHi[this.castling];

    // Update en passant square
    if (flags & FLAG_DOUBLE_PAWN) {
      this.epSquare = (from + to) >> 1;
    } else {
      this.epSquare = -1;
    }
    const newEpIdx = this.epSquare >= 0 ? (this.epSquare & 7) : 8;
    lo ^= ZOBRIST.epLo[newEpIdx];
    hi ^= ZOBRIST.epHi[newEpIdx];

    // Update clocks
    if (Math.abs(movingPiece) === PAWN || capturedPiece !== EMPTY) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock++;
    }
    if (this.turn === BLACK) {
      this.fullmoveNumber++;
    }

    // Flip turn
    this.turn = -this.turn;
    lo ^= ZOBRIST.sideLo;
    hi ^= ZOBRIST.sideHi;

    this.hashLo = lo >>> 0;
    this.hashHi = hi >>> 0;

    if (trackRepetition) {
      this.positionHashHistory.push(this.getHashKey());
    }
  }

  unmakeMove(move) {
    const state = this.history.pop();
    if (!state) return;

    if (state.trackedRepetition) {
      this.positionHashHistory.pop();
    }

    const from = moveFrom(move);
    const to = moveTo(move);
    const flags = moveFlags(move);
    const promo = movePromo(move);
    const squares = this.squares;

    // Restore turn first
    this.turn = -this.turn;
    const movedPiece = promo ? this.turn * PAWN : squares[to];

    squares[from] = movedPiece;
    if (flags & FLAG_EN_PASSANT) {
      squares[to] = EMPTY;
      const capSq = this.turn === WHITE ? to + 8 : to - 8;
      squares[capSq] = state.capturedPiece;
    } else {
      squares[to] = state.capturedPiece;
    }

    // Restore castling rook
    if (flags & FLAG_CASTLE_K) {
      if (this.turn === WHITE) {
        squares[63] = WR;
        squares[61] = EMPTY;
      } else {
        squares[7] = BR;
        squares[5] = EMPTY;
      }
    } else if (flags & FLAG_CASTLE_Q) {
      if (this.turn === WHITE) {
        squares[56] = WR;
        squares[59] = EMPTY;
      } else {
        squares[0] = BR;
        squares[3] = EMPTY;
      }
    }

    this.castling = state.castling;
    this.epSquare = state.epSquare;
    this.halfmoveClock = state.halfmoveClock;
    this.fullmoveNumber = state.fullmoveNumber;
    this.whiteKingSq = state.whiteKingSq;
    this.blackKingSq = state.blackKingSq;
    this.hashLo = state.hashLo;
    this.hashHi = state.hashHi;
  }

  makeNullMove() {
    this.history.push({
      move: 0,
      capturedPiece: EMPTY,
      castling: this.castling,
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      whiteKingSq: this.whiteKingSq,
      blackKingSq: this.blackKingSq,
      hashLo: this.hashLo,
      hashHi: this.hashHi,
      trackedRepetition: false
    });

    let lo = this.hashLo;
    let hi = this.hashHi;
    const oldEpIdx = this.epSquare >= 0 ? (this.epSquare & 7) : 8;
    lo ^= ZOBRIST.epLo[oldEpIdx];
    hi ^= ZOBRIST.epHi[oldEpIdx];
    this.epSquare = -1;
    lo ^= ZOBRIST.epLo[8];
    hi ^= ZOBRIST.epHi[8];
    this.turn = -this.turn;
    lo ^= ZOBRIST.sideLo;
    hi ^= ZOBRIST.sideHi;
    this.hashLo = lo >>> 0;
    this.hashHi = hi >>> 0;
  }

  unmakeNullMove() {
    const state = this.history.pop();
    if (!state) return;
    this.turn = -this.turn;
    this.epSquare = state.epSquare;
    this.hashLo = state.hashLo;
    this.hashHi = state.hashHi;
  }

  isThreefoldRepetition() {
    const current = this.getHashKey();
    let count = 0;
    for (let i = this.positionHashHistory.length - 1; i >= 0; i--) {
      if (this.positionHashHistory[i] === current) {
        count++;
        if (count >= 3) return true;
      }
    }
    return false;
  }

  isRepetitionInSearch(hashKey) {
    let count = 0;
    for (let i = this.positionHashHistory.length - 1; i >= 0; i--) {
      if (this.positionHashHistory[i] === hashKey) {
        count++;
        if (count >= 2) return true;
      }
    }
    return false;
  }

  isInsufficientMaterial() {
    let whiteMinors = 0;
    let blackMinors = 0;
    let whiteBishopColor = -1;
    let blackBishopColor = -1;

    for (let sq = 0; sq < 64; sq++) {
      const p = this.squares[sq];
      if (p === EMPTY) continue;
      const type = Math.abs(p);
      if (type === PAWN || type === ROOK || type === QUEEN) return false;
      if (type === KNIGHT || type === BISHOP) {
        if (p > 0) {
          whiteMinors++;
          if (type === BISHOP) whiteBishopColor = ((sq >> 3) + (sq & 7)) & 1;
        } else {
          blackMinors++;
          if (type === BISHOP) blackBishopColor = ((sq >> 3) + (sq & 7)) & 1;
        }
      }
    }

    if (whiteMinors === 0 && blackMinors === 0) return true;
    if ((whiteMinors === 1 && blackMinors === 0) || (whiteMinors === 0 && blackMinors === 1)) {
      return true;
    }
    if (
      whiteMinors === 1 && blackMinors === 1 &&
      whiteBishopColor !== -1 && blackBishopColor !== -1 &&
      whiteBishopColor === blackBishopColor
    ) {
      return true;
    }
    return false;
  }

  getGameStatus() {
    const legalMoves = this.generateLegalMoves();
    if (legalMoves.length === 0) {
      if (this.inCheck(this.turn)) {
        return {
          over: true,
          result: this.turn === WHITE ? '0-1' : '1-0',
          winner: -this.turn,
          reason: 'checkmate'
        };
      }
      return { over: true, result: '1/2-1/2', winner: 0, reason: 'stalemate' };
    }
    if (this.halfmoveClock >= 100) {
      return { over: true, result: '1/2-1/2', winner: 0, reason: 'fifty-move' };
    }
    if (this.isThreefoldRepetition()) {
      return { over: true, result: '1/2-1/2', winner: 0, reason: 'repetition' };
    }
    if (this.isInsufficientMaterial()) {
      return { over: true, result: '1/2-1/2', winner: 0, reason: 'insufficient-material' };
    }
    return { over: false, result: '*', winner: 0, reason: null };
  }

  moveToSAN(move, legalMoves = null) {
    const from = moveFrom(move);
    const to = moveTo(move);
    const flags = moveFlags(move);
    const promo = movePromo(move);
    const piece = this.squares[from];
    const type = Math.abs(piece);

    let san = '';
    if (flags & FLAG_CASTLE_K) {
      san = 'O-O';
    } else if (flags & FLAG_CASTLE_Q) {
      san = 'O-O-O';
    } else {
      const pieceLetter = { [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' }[type] || '';
      const capture = isCapture(move);

      if (type === PAWN) {
        if (capture) {
          san += FILES[from & 7] + 'x';
        }
        san += sqToAlgebraic(to);
      } else {
        san += pieceLetter;
        // Disambiguation
        const allMoves = legalMoves || this.generateLegalMoves();
        const ambiguous = allMoves.filter(
          (m) => m !== move && moveTo(m) === to && this.squares[moveFrom(m)] === piece
        );
        if (ambiguous.length > 0) {
          const fromFile = from & 7;
          const fromRank = from >> 3;
          const sameFile = ambiguous.some((m) => (moveFrom(m) & 7) === fromFile);
          const sameRank = ambiguous.some((m) => (moveFrom(m) >> 3) === fromRank);
          if (!sameFile) {
            san += FILES[fromFile];
          } else if (!sameRank) {
            san += RANKS[fromRank];
          } else {
            san += FILES[fromFile] + RANKS[fromRank];
          }
        }
        if (capture) san += 'x';
        san += sqToAlgebraic(to);
      }

      if (promo) {
        const promoLetter = { [QUEEN]: 'Q', [ROOK]: 'R', [BISHOP]: 'B', [KNIGHT]: 'N' }[promo] || 'Q';
        san += '=' + promoLetter;
      }
    }

    // Check / Checkmate suffix
    this.makeMove(move);
    if (this.inCheck(this.turn)) {
      const replies = this.generateLegalMoves();
      san += replies.length === 0 ? '#' : '+';
    }
    this.unmakeMove(move);

    return san;
  }

  uciToMove(uci) {
    if (!uci || uci.length < 4) return 0;
    const from = algebraicToSq(uci.slice(0, 2));
    const to = algebraicToSq(uci.slice(2, 4));
    const promoChar = uci[4]?.toLowerCase();
    const promoMap = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT };
    const promo = promoChar ? (promoMap[promoChar] || 0) : 0;

    const legal = this.generateLegalMoves();
    for (let i = 0; i < legal.length; i++) {
      const m = legal[i];
      if (moveFrom(m) === from && moveTo(m) === to && movePromo(m) === promo) {
        return m;
      }
    }
    return 0;
  }

  sanToMove(san) {
    const clean = san.replace(/[+#!?]+$/g, '');
    const legal = this.generateLegalMoves();
    for (let i = 0; i < legal.length; i++) {
      const mSan = this.moveToSAN(legal[i], legal).replace(/[+#!?]+$/g, '');
      if (mSan === clean) return legal[i];
    }
    return 0;
  }

  getMaterialBalance() {
    const values = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9 };
    const startCounts = { [PAWN]: 8, [KNIGHT]: 2, [BISHOP]: 2, [ROOK]: 2, [QUEEN]: 1 };
    const whiteCounts = { [PAWN]: 0, [KNIGHT]: 0, [BISHOP]: 0, [ROOK]: 0, [QUEEN]: 0 };
    const blackCounts = { [PAWN]: 0, [KNIGHT]: 0, [BISHOP]: 0, [ROOK]: 0, [QUEEN]: 0 };

    let whiteScore = 0;
    let blackScore = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.squares[sq];
      if (p === EMPTY) continue;
      const t = Math.abs(p);
      if (t === KING) continue;
      if (p > 0) {
        whiteCounts[t]++;
        whiteScore += values[t];
      } else {
        blackCounts[t]++;
        blackScore += values[t];
      }
    }

    const capturedByWhite = [];
    const capturedByBlack = [];
    for (const t of [QUEEN, ROOK, BISHOP, KNIGHT, PAWN]) {
      for (let i = 0; i < Math.max(0, startCounts[t] - blackCounts[t]); i++) {
        capturedByWhite.push(-t);
      }
      for (let i = 0; i < Math.max(0, startCounts[t] - whiteCounts[t]); i++) {
        capturedByBlack.push(t);
      }
    }

    return {
      whiteAdvantage: whiteScore - blackScore,
      capturedByWhite,
      capturedByBlack
    };
  }

  perft(depth) {
    if (depth === 0) return 1;
    const moves = this.generateLegalMoves();
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (let i = 0; i < moves.length; i++) {
      this.makeMove(moves[i]);
      nodes += this.perft(depth - 1);
      this.unmakeMove(moves[i]);
    }
    return nodes;
  }
}

export { moveToUCI };
