// Ludo Drama (projet Pionix) — le Ludo plein de rebondissements
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// === LOGIQUE ===
const COLORS = {
  red: { main: '#E53935', light: '#FFCDD2', dark: '#8E1B1B', name: 'Rouge' },
  green: { main: '#43A047', light: '#C8E6C9', dark: '#1B5E20', name: 'Vert' },
  yellow: { main: '#FBC02D', light: '#FFF9C4', dark: '#9A6F00', name: 'Jaune' },
  blue: { main: '#1E88E5', light: '#BBDEFB', dark: '#0D3C8C', name: 'Bleu' },
};
const ORDER = ['red', 'green', 'yellow', 'blue'];

// Case de départ de chaque couleur sur le parcours (52 cases)
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
// Cases protégées : départs + étoiles (on ne peut pas y être capturé)
const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];

// Parcours principal [ligne, colonne] sur une grille 15 x 15, sens des aiguilles d'une montre
const TRACK = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
];

// Couloir final (5 cases) de chaque couleur
const HOME = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

const YARD = { red: [0, 0], green: [0, 9], yellow: [9, 9], blue: [9, 0] };
const YARD_SPOTS = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]];
const FINISH = { red: [7, 6], green: [6, 7], yellow: [7, 8], blue: [8, 7] };

// Progression d'un pion : -1 = maison, 0..50 = parcours, 51..55 = couloir, 56 = arrivé
const LAST_TRACK = 50;
const GOAL = 56;

const globalIdx = (color, p) => (START[color] + p) % 52;

function canMove(p, v) {
  if (p === GOAL) return false;
  if (p === -1) return v === 6;
  return p + v <= GOAL;
}

function tokenCell(color, p, i) {
  if (p === -1) {
    const [yr, yc] = YARD[color];
    const [dr, dc] = YARD_SPOTS[i];
    return [yr + dr, yc + dc];
  }
  if (p <= LAST_TRACK) return TRACK[globalIdx(color, p)];
  if (p < GOAL) return HOME[color][p - LAST_TRACK - 1];
  return FINISH[color];
}

function activeColors(count) {
  if (count === 2) return ['red', 'yellow'];
  if (count === 3) return ['red', 'green', 'yellow'];
  return ORDER;
}

// Modes de jeu
const MODES = {
  classic: { name: 'Classique', emoji: '🎲', desc: 'Rentre tes 4 pions au centre pour gagner' },
  timed: { name: '5 Minutes', emoji: '⏱️', desc: 'Le meilleur score à la fin du chrono gagne' },
  quick: { name: 'Rapide', emoji: '🐇', desc: 'Capture 1 pion et rentres-en 1 pour gagner' },
  kill: { name: 'À mort', emoji: '💀', desc: 'Le premier à capturer 3 pions gagne' },
};
const MODE_ORDER = ['classic', 'timed', 'quick', 'kill'];

// Niveaux de difficulté des ordinateurs
const LEVELS = {
  easy: { name: 'Facile', emoji: '🙂' },
  normal: { name: 'Normal', emoji: '😎' },
  hard: { name: 'Difficile', emoji: '🔥' },
};
const LEVEL_ORDER = ['easy', 'normal', 'hard'];

// Pari (pièces virtuelles)
const BETS = [50, 100, 250, 500];
const START_COINS = 1000;
const TIMED_MS = 5 * 60 * 1000;
const KILL_TARGET = 3;

function createGame(count, types, mode = 'classic', team = false, level = 'normal', bet = 0) {
  const s = {
    players: activeColors(count).map((c) => ({
      color: c,
      type: types[c],
      tokens: [-1, -1, -1, -1],
      captures: 0,
      lastDice: null,
      rollId: 0,
    })),
    mode,
    level,
    bet, // mise de chaque joueur (0 = sans pari)
    team: team && count === 4, // Rouge + Jaune contre Vert + Bleu
    endTime: null,
    current: 0,
    dice: null,
    phase: 'roll', // roll | move | over
    sixes: 0,
    movable: [],
    busy: false,
    winner: null,
    message: '',
    effects: [], // pluies d'emojis en cours
    banner: null, // grand message animé au centre
    lastHit: {}, // qui m'a capturé en dernier (pour la vengeance)
    tension: {}, // message « plus qu'un pion » déjà affiché
    noSix: {}, // tours passés à attendre un 6
  };
  s.you = s.players.findIndex((p) => p.type === 'human'); // le joueur qui parie
  s.pot = bet * s.players.length; // la cagnotte
  return s;
}

// Gains du pari à la fin de la partie (0 si perdu)
function betPayout(s) {
  if (!s.bet || s.you < 0 || s.winner === null) return 0;
  if (sideOf(s, s.winner) !== sideOf(s, s.you)) return 0;
  const sideSize = s.players.filter((p, pi) => sideOf(s, pi) === sideOf(s, s.you)).length;
  return Math.floor(s.pot / sideSize);
}

// En équipe, les joueurs 0 et 2 sont ensemble, 1 et 3 aussi
const sideOf = (s, pi) => (s.team ? pi % 2 : pi);
const isEnemy = (s, a, b) => a !== b && sideOf(s, a) !== sideOf(s, b);

function playerScore(pl) {
  const moved = pl.tokens.reduce((a, t) => a + (t >= 0 ? t + 1 : 0), 0);
  const home = pl.tokens.filter((t) => t === GOAL).length;
  return moved + home * 15 + pl.captures * 20;
}

function sideStats(s, side) {
  let caps = 0, home = 0, score = 0, done = true;
  s.players.forEach((pl, pi) => {
    if (sideOf(s, pi) !== side) return;
    caps += pl.captures;
    const h = pl.tokens.filter((t) => t === GOAL).length;
    home += h;
    if (h < 4) done = false;
    score += playerScore(pl);
  });
  return { caps, home, score, done };
}

function checkWin(s, pi) {
  const st = sideStats(s, sideOf(s, pi));
  if (st.done) return true; // tous les pions rentrés : gagne dans tous les modes
  if (s.mode === 'quick') return st.caps >= 1 && st.home >= 1;
  if (s.mode === 'kill') return st.caps >= KILL_TARGET;
  return false;
}

// Fin du chrono : le camp avec le meilleur score gagne
function bestPlayer(s) {
  let best = 0, bestScore = -1;
  s.players.forEach((pl, pi) => {
    const sc = sideStats(s, sideOf(s, pi)).score;
    if (sc > bestScore) { bestScore = sc; best = pi; }
  });
  return best;
}

// Applique la fin d'un déplacement : captures, arrivée, victoire, tour bonus
function resolveMove(s, i) {
  const pl = s.players[s.current];
  const np = pl.tokens[i];
  let bonus = s.dice === 6;
  let caught = 0;
  const victims = [];
  if (np <= LAST_TRACK) {
    const gi = globalIdx(pl.color, np);
    if (!SAFE.includes(gi)) {
      s.players.forEach((o, oi) => {
        if (!isEnemy(s, s.current, oi)) return;
        o.tokens.forEach((op, ti) => {
          if (op >= 0 && op <= LAST_TRACK && globalIdx(o.color, op) === gi) {
            o.tokens[ti] = -1;
            caught++;
            if (!victims.includes(oi)) victims.push(oi);
          }
        });
      });
    }
  }
  pl.captures += caught;
  if (caught) bonus = true;
  const arrived = np === GOAL;
  if (arrived) bonus = true;
  const won = checkWin(s, s.current);
  return { bonus, caught, arrived, won, victims };
}

function inDanger(s, meIdx, gi) {
  if (SAFE.includes(gi)) return false;
  return s.players.some(
    (o, oi) =>
      isEnemy(s, meIdx, oi) &&
      o.tokens.some((op) => {
        if (op < 0 || op > LAST_TRACK) return false;
        const d = (gi - globalIdx(o.color, op) + 52) % 52;
        return d >= 1 && d <= 6;
      })
  );
}

// Choix de l'ordinateur : capturer > finir > sortir > se mettre à l'abri > avancer
function aiChoose(s) {
  // Facile : se trompe souvent / Normal : se trompe parfois / Difficile : joue toujours le meilleur coup
  const mistakes = { easy: 0.6, normal: 0.25, hard: 0 }[s.level] || 0;
  if (Math.random() < mistakes) {
    return s.movable[Math.floor(Math.random() * s.movable.length)];
  }
  const pl = s.players[s.current];
  const v = s.dice;
  const st = sideStats(s, sideOf(s, s.current));
  let captureValue = 80;
  if (s.mode === 'kill') captureValue = 160;
  if (s.mode === 'quick' && st.caps === 0) captureValue = 140;
  let homeValue = 100;
  if (s.mode === 'quick' && st.home === 0) homeValue = 150;
  if (s.mode === 'kill') homeValue = 30;
  let best = s.movable[0];
  let bestScore = -Infinity;
  for (const i of s.movable) {
    const p = pl.tokens[i];
    const np = p === -1 ? 0 : p + v;
    let score = np * 0.5;
    if (np === GOAL) score += homeValue;
    if (p === -1) score += 60;
    if (np <= LAST_TRACK) {
      const gi = globalIdx(pl.color, np);
      const captures =
        !SAFE.includes(gi) &&
        s.players.some(
          (o, oi) =>
            isEnemy(s, s.current, oi) &&
            o.tokens.some((op) => op >= 0 && op <= LAST_TRACK && globalIdx(o.color, op) === gi)
        );
      if (captures) score += captureValue;
      if (SAFE.includes(gi)) score += 20;
      if (inDanger(s, s.current, gi)) score -= 40;
    } else {
      score += 25; // dans le couloir final = à l'abri
    }
    if (p >= 0 && p <= LAST_TRACK && inDanger(s, s.current, globalIdx(pl.color, p))) score += 35;
    score += Math.random();
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
// === FIN LOGIQUE ===

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---------- BOUTIQUE : catalogue ----------
const PAWN_SKINS = {
  classic: { name: 'Classique', price: 0 },
  gold: { name: 'Doré', price: 200 },
  star: { name: 'Étoile', price: 250, emoji: '⭐' },
  neon: { name: 'Néon', price: 300 },
  crown: { name: 'Couronne', price: 400, emoji: '👑' },
  lion: { name: 'Lion', price: 500, emoji: '🦁' },
};
const DICE_SKINS = {
  classic: { name: 'Classique', price: 0, face: '#FFFFFF', edge: '#CFCFE0', pip: '#14142B', one: '#E53935' },
  wood: { name: 'Bois', price: 150, face: '#D7A86E', edge: '#8D5A2B', pip: '#4E2C0F', one: '#4E2C0F' },
  gold: { name: 'Or', price: 250, face: '#FFD54F', edge: '#C79100', pip: '#5D4037', one: '#B71C1C' },
  neon: { name: 'Néon', price: 300, face: '#101028', edge: '#00E5FF', pip: '#00E5FF', one: '#FF4081' },
  fire: { name: 'Feu', price: 400, face: '#FF7043', edge: '#BF360C', pip: '#FFFFFF', one: '#FFEB3B', deco: '🔥' },
};
const BOARDS = {
  classic: { name: 'Classique', price: 0, track: '#FFFFFF', yard: '#FFFFFF', line: '#555555', star: '#9E9E9E' },
  ocean: { name: 'Océan', price: 250, track: '#E0F7FA', yard: '#B2EBF2', line: '#00838F', star: '#00ACC1', deco: '🐠' },
  jungle: { name: 'Jungle', price: 250, track: '#F1F8E9', yard: '#C5E1A5', line: '#558B2F', star: '#7CB342', deco: '🌴' },
  night: { name: 'Nuit étoilée', price: 300, track: '#2B3768', yard: '#141A3A', line: '#5566A8', star: '#FFD54F', deco: '🌙' },
  pagne: { name: 'Pagne', price: 500, track: '#FFF8E1', yard: '#FFE0B2', line: '#6D4C41', star: '#E65100', pattern: true },
};
const WIN_FX = {
  classic: { name: 'Fête', price: 0, emojis: ['🏆', '👑', '🎊', '🎉', '🥇', '🌟', '🥳', '💃', '🕺', '✨'] },
  hearts: { name: 'Cœurs', price: 150, emojis: ['❤️', '💖', '😍', '💕', '🥰', '💘'] },
  fireworks: { name: "Feu d'artifice", price: 200, emojis: ['🎆', '🎇', '✨', '💥', '🌟', '🎉'] },
  money: { name: 'Pluie de billets', price: 250, emojis: ['💵', '💰', '🤑', '💸', '🪙', '💶'] },
  royal: { name: 'Royal', price: 350, emojis: ['👑', '💎', '🏆', '🥇', '✨', '🦁'] },
};
const SHOP_CATS = {
  pawn: { name: 'Pions', emoji: '♟️', items: PAWN_SKINS },
  dice: { name: 'Dés', emoji: '🎲', items: DICE_SKINS },
  board: { name: 'Plateaux', emoji: '🎨', items: BOARDS },
  win: { name: 'Victoire', emoji: '🎉', items: WIN_FX },
};
const SHOP_TABS = ['pawn', 'dice', 'board', 'win'];
const SHOP_KEY = 'pionix.shop';
const DEFAULT_SHOP = { owned: [], equip: { pawn: 'classic', dice: 'classic', board: 'classic', win: 'classic' } };

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const COINS_KEY = 'pionix.coins';

// 🎭 Les répliques du drama
const DRAMA = {
  capture: ['💔 TRAHISON !', '😱 QUELLE HUMILIATION !', '🎭 DRAME SUR LE PLATEAU !', '🔪 SANS PITIÉ !', '😭 RETOUR À LA MAISON…', '🍿 ÇA DEVIENT CHAUD !'],
  revenge: ['😈 LA VENGEANCE !', '🔥 ŒIL POUR ŒIL !', '😏 TU L\'AS CHERCHÉ !'],
  arrive: ['🎉 PION ARRIVÉ !', '🙌 IL EST SAUVÉ !', '🏠 ENFIN À LA MAISON !', '🥹 QUEL VOYAGE !'],
  six: ['🎲 SIX ! 🔥', '🔥 LE DÉ EST CHAUD !', '😎 ENCORE UN 6 !'],
  three: ['🤡 TROIS 6… LA HONTE !', '😱 TROIS 6 ! TOUR PERDU', '🙈 TROP DE CHANCE TUE LA CHANCE'],
  escape: ['😮‍💨 OUF, DE JUSTESSE !', '🏃 IL S\'ÉCHAPPE !', '😅 PAS AUJOURD\'HUI !'],
  noSix: ['😩 TOUJOURS PAS DE 6…', '🥲 LE 6 A DISPARU ?!', '😤 CE DÉ EST CONTRE MOI !'],
  win: ['😭 Les autres sont en larmes…', '🎭 Quel scénario !', '🍿 Un final digne d\'un film !', '👑 Le drama a un roi !'],
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Emojis des effets
const EMOJIS = {
  arrive: ['🎉', '🥳', '⭐', '✨', '🏆', '🎊', '💫', '🙌'],
  capture: ['💥', '😈', '🔥', '😂', '⚡', '👊', '😜', '💨'],
  coins: ['🪙', '💰', '🤑', '💵', '✨', '🪙'],
  cry: ['😭', '💔', '😱', '😢', '🥀', '😩'],
  win: ['🏆', '👑', '🎊', '🎉', '🥇', '🌟', '🥳', '💃', '🕺', '✨'],
};
let fxCounter = 0;
const nameOf = (pl) => COLORS[pl.color].name + (pl.type === 'ai' ? ' (ordi)' : '');
const turnMsg = (s) => {
  const pl = s.players[s.current];
  return pl.type === 'ai' ? `${nameOf(pl)} réfléchit…` : `${nameOf(pl)} : lance le dé !`;
};

export default function App() {
  const [screen, setScreen] = useState('menu');
  const [count, setCount] = useState(4);
  const [types, setTypes] = useState({ red: 'human', green: 'ai', yellow: 'ai', blue: 'ai' });
  const [mode, setMode] = useState('classic');
  const [team, setTeam] = useState(false);
  const [level, setLevel] = useState('normal');
  const [bet, setBet] = useState(0);
  const [coins, setCoins] = useState(START_COINS);
  const [shop, setShop] = useState(DEFAULT_SHOP);
  const [shopTab, setShopTab] = useState('pawn');
  const [shopMsg, setShopMsg] = useState('');

  // Porte-monnaie gardé dans le téléphone
  useEffect(() => {
    AsyncStorage.getItem(COINS_KEY)
      .then((v) => {
        if (v !== null) setCoins(parseInt(v, 10) || 0);
      })
      .catch(() => {});
    AsyncStorage.getItem(SHOP_KEY)
      .then((v) => {
        if (!v) return;
        const saved = JSON.parse(v);
        setShop({ owned: saved.owned || [], equip: { ...DEFAULT_SHOP.equip, ...(saved.equip || {}) } });
      })
      .catch(() => {});
  }, []);

  function saveShop(next) {
    setShop(next);
    AsyncStorage.setItem(SHOP_KEY, JSON.stringify(next)).catch(() => {});
  }

  function flash(msg) {
    setShopMsg(msg);
    setTimeout(() => setShopMsg((m) => (m === msg ? '' : m)), 2200);
  }

  function onShopItem(cat, id) {
    const it = SHOP_CATS[cat].items[id];
    const key = cat + ':' + id;
    const owned = it.price === 0 || shop.owned.includes(key);
    if (owned) {
      saveShop({ ...shop, equip: { ...shop.equip, [cat]: id } });
      flash(`✅ ${it.name} équipé !`);
      return;
    }
    if (coins < it.price) {
      flash('😕 Pas assez de pièces… Gagne des paris pour en avoir plus !');
      return;
    }
    addCoins(-it.price);
    saveShop({ owned: [...shop.owned, key], equip: { ...shop.equip, [cat]: id } });
    flash(`🎉 ${it.name} acheté et équipé !`);
  }

  function addCoins(delta) {
    setCoins((c) => {
      const n = Math.max(0, c + delta);
      AsyncStorage.setItem(COINS_KEY, String(n)).catch(() => {});
      return n;
    });
  }
  const [blink, setBlink] = useState(false);
  const [, setVersion] = useState(0);
  const g = useRef(null);
  const { width } = useWindowDimensions();

  const render = () => setVersion((v) => v + 1);

  useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 450);
    return () => clearInterval(t);
  }, []);

  // Lance une pluie d'emojis (sur une case) et/ou un grand message
  function fx(s, kind, cellRC, text) {
    const id = ++fxCounter;
    if (kind && cellRC) s.effects.push({ id, kind, r: cellRC[0], c: cellRC[1] });
    if (text) s.banner = { id, text };
    render();
    setTimeout(() => {
      s.effects = s.effects.filter((e) => e.id !== id);
      if (s.banner && s.banner.id === id) s.banner = null;
      if (g.current === s) render();
    }, 1800);
  }

  function scheduleAI(s) {
    const pl = s.players[s.current];
    if (pl.type === 'ai' && s.phase === 'roll') {
      setTimeout(() => {
        if (g.current === s) roll();
      }, 700);
    }
  }

  const timeUp = (s) => s.mode === 'timed' && s.endTime && Date.now() >= s.endTime;

  function endGame(s, winnerIdx) {
    s.winner = winnerIdx;
    s.dramaLine = pick(DRAMA.win);
    s.phase = 'over';
    s.busy = false;
    if (s.bet && s.you >= 0) {
      s.payout = betPayout(s);
      if (s.payout > 0) addCoins(s.payout);
    }
    render();
  }

  // Le chrono peut finir pendant qu'un humain réfléchit
  useEffect(() => {
    const s = g.current;
    if (s && s.phase === 'roll' && !s.busy && timeUp(s)) endGame(s, bestPlayer(s));
  }, [blink]);

  function nextPlayer(s) {
    if (timeUp(s)) {
      endGame(s, bestPlayer(s));
      return;
    }
    s.current = (s.current + 1) % s.players.length;
    s.sixes = 0;
    s.phase = 'roll';
    s.movable = [];
    s.message = turnMsg(s);
    render();
    scheduleAI(s);
  }

  function startGame() {
    const hasHuman = activeColors(count).some((c) => types[c] === 'human');
    const b = hasHuman && bet <= coins ? bet : 0;
    const s = createGame(count, types, mode, team, level, b);
    if (b) addCoins(-b);
    if (s.mode === 'timed') s.endTime = Date.now() + TIMED_MS;
    s.message = turnMsg(s);
    g.current = s;
    setScreen('game');
    fx(
      s,
      null,
      null,
      `${MODES[s.mode].emoji} ${MODES[s.mode].name}${s.team ? ' 🤝' : ''}${s.bet ? ` · 💰 ${fmt(s.pot)}` : ''}`
    );
    scheduleAI(s);
  }

  function quit() {
    g.current = null;
    setScreen('menu');
  }

  async function roll() {
    const s = g.current;
    if (!s || s.busy || s.phase !== 'roll') return;
    s.busy = true;
    const pl = s.players[s.current];
    pl.rollId = (pl.rollId || 0) + 1;
    for (let k = 0; k < 7; k++) {
      s.dice = 1 + Math.floor(Math.random() * 6);
      pl.lastDice = s.dice;
      render();
      await sleep(60);
      if (g.current !== s) return;
    }
    const v = 1 + Math.floor(Math.random() * 6);
    s.dice = v;
    pl.lastDice = v;
    s.sixes = v === 6 ? s.sixes + 1 : 0;

    if (s.sixes === 3) {
      s.message = `${nameOf(pl)} fait trois 6 : tour perdu !`;
      fx(s, null, null, pick(DRAMA.three));
      await sleep(1200);
      if (g.current !== s) return;
      s.busy = false;
      nextPlayer(s);
      return;
    }

    const movable = [0, 1, 2, 3].filter((i) => canMove(pl.tokens[i], v));
    if (v === 6) s.noSix[s.current] = 0;
    if (movable.length === 0 && pl.tokens.every((t) => t === -1)) {
      s.noSix[s.current] = (s.noSix[s.current] || 0) + 1;
      if (s.noSix[s.current] === 3) {
        s.noSix[s.current] = 0;
        fx(s, null, null, pick(DRAMA.noSix));
      }
    }
    if (movable.length === 0) {
      s.message = `${nameOf(pl)} fait ${v} : aucun pion ne peut bouger`;
      render();
      await sleep(1200);
      if (g.current !== s) return;
      s.busy = false;
      nextPlayer(s);
      return;
    }

    if (v === 6) fx(s, null, null, pick(DRAMA.six));

    s.movable = movable;
    s.phase = 'move';
    s.busy = false;
    s.message =
      pl.type === 'ai'
        ? `${nameOf(pl)} fait ${v}`
        : `${COLORS[pl.color].name} fait ${v} : touche un pion qui clignote`;
    render();

    const samePlace = movable.every((i) => pl.tokens[i] === pl.tokens[movable[0]]);
    if (pl.type === 'ai') {
      await sleep(600);
      if (g.current !== s) return;
      move(aiChoose(s));
    } else if (samePlace) {
      await sleep(500);
      if (g.current !== s) return;
      move(movable[0]);
    }
  }

  async function move(i) {
    const s = g.current;
    if (!s || s.busy || s.phase !== 'move' || !s.movable.includes(i)) return;
    s.busy = true;
    s.movable = [];
    const pl = s.players[s.current];
    const v = s.dice;
    const before = pl.tokens[i];
    const wasInDanger = before >= 0 && before <= LAST_TRACK && inDanger(s, s.current, globalIdx(pl.color, before));

    if (pl.tokens[i] === -1) {
      pl.tokens[i] = 0;
      render();
      await sleep(200);
    } else {
      for (let k = 0; k < v; k++) {
        pl.tokens[i]++;
        render();
        await sleep(150);
        if (g.current !== s) return;
      }
    }

    const res = resolveMove(s, i);
    const np = pl.tokens[i];
    if (res.caught) {
      const revenge = res.victims.some((vi) => s.lastHit[s.current] === vi);
      res.victims.forEach((vi) => {
        s.lastHit[vi] = s.current;
        const [yr, yc] = YARD[s.players[vi].color];
        fx(s, 'cry', [yr + 2.5, yc + 2.5], null); // la victime pleure dans sa maison
      });
      fx(s, 'capture', tokenCell(pl.color, np, i), pick(revenge ? DRAMA.revenge : DRAMA.capture));
    } else if (res.arrived) {
      fx(s, 'arrive', FINISH[pl.color], pick(DRAMA.arrive));
    } else if (wasInDanger && !(np <= LAST_TRACK && inDanger(s, s.current, globalIdx(pl.color, np)))) {
      fx(s, null, null, pick(DRAMA.escape));
    }
    const home = pl.tokens.filter((t) => t === GOAL).length;
    if (!res.won && home === 3 && !s.tension[s.current]) {
      s.tension[s.current] = true;
      fx(s, null, null, `😰 TENSION ! ${COLORS[pl.color].name} n'a plus qu'un pion…`);
    }
    if (res.won) {
      endGame(s, s.current);
      return;
    }

    s.busy = false;
    if (timeUp(s)) {
      endGame(s, bestPlayer(s));
      return;
    }
    if (res.bonus) {
      let msg = '';
      if (res.caught) msg = `${nameOf(pl)} capture un pion ! 💥 `;
      else if (res.arrived) msg = `Un pion ${COLORS[pl.color].name.toLowerCase()} est arrivé ! 🎉 `;
      s.phase = 'roll';
      s.message = `${msg}${nameOf(pl)} rejoue !`;
      render();
      scheduleAI(s);
    } else {
      nextPlayer(s);
    }
  }

  function onToken(pi, ti) {
    const s = g.current;
    if (!s || pi !== s.current || s.players[pi].type !== 'human') return;
    move(ti);
  }

  // ---------- ÉCRAN MENU ----------
  if (screen === 'shop') {
    const items = SHOP_CATS[shopTab].items;
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <Pressable onPress={() => setScreen('menu')} style={styles.quitBtn}>
            <Text style={styles.quitText}>← Retour</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Boutique</Text>
          <View style={styles.walletSmall}>
            <Text style={styles.walletSmallText}>🪙 {fmt(coins)}</Text>
          </View>
        </View>
        <View style={styles.tabs}>
          {SHOP_TABS.map((k) => (
            <Pressable key={k} onPress={() => setShopTab(k)} style={[styles.tab, shopTab === k && styles.tabOn]}>
              <Text style={styles.tabEmoji}>{SHOP_CATS[k].emoji}</Text>
              <Text style={[styles.tabText, shopTab === k && styles.tabTextOn]}>{SHOP_CATS[k].name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.shopMsg}>{shopMsg || ' '}</Text>
        <ScrollView contentContainerStyle={styles.shopGrid}>
          {Object.keys(items).map((id) => {
            const it = items[id];
            const owned = it.price === 0 || shop.owned.includes(shopTab + ':' + id);
            const equipped = shop.equip[shopTab] === id;
            const tooExpensive = !owned && coins < it.price;
            return (
              <Pressable
                key={id}
                onPress={() => onShopItem(shopTab, id)}
                style={[styles.shopCard, equipped && styles.shopCardOn]}
              >
                <View style={styles.shopPreview}>
                  <ShopPreview cat={shopTab} id={id} />
                </View>
                <Text style={styles.shopName}>{it.name}</Text>
                <View
                  style={[
                    styles.shopBtn,
                    equipped ? styles.shopBtnOn : owned ? styles.shopBtnOwned : null,
                    tooExpensive && { opacity: 0.45 },
                  ]}
                >
                  <Text style={[styles.shopBtnText, !owned && !equipped && { color: '#14142B' }]}>
                    {equipped ? '✅ Équipé' : owned ? 'Équiper' : `🪙 ${fmt(it.price)}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  if (screen === 'menu') {
    const colors = activeColors(count);
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="light-content" />
        <ScrollView contentContainerStyle={styles.menu}>
          <View style={styles.logoRow}>
            {ORDER.map((c) => (
              <Pawn key={c} color={c} size={38} />
            ))}
          </View>
          <Text style={styles.title}>
            Ludo <Text style={styles.titleFiesta}>Drama</Text> 🎭
          </Text>
          <Text style={styles.subtitle}>Le Ludo plein de rebondissements</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={styles.wallet}>
              <Text style={styles.walletText}>🪙 {fmt(coins)}</Text>
            </View>
            <Pressable onPress={() => setScreen('shop')} style={styles.shopOpen}>
              <Text style={styles.shopOpenText}>🛍️ Boutique</Text>
            </Pressable>
          </View>
          {coins < BETS[0] ? (
            <Pressable onPress={() => addCoins(500)} style={styles.refill}>
              <Text style={styles.refillText}>🎁 Recharge gratuite : +500 🪙</Text>
            </Pressable>
          ) : null}

          <Text style={styles.label}>Nombre de joueurs</Text>
          <View style={styles.row}>
            {[2, 3, 4].map((n) => (
              <Pressable
                key={n}
                onPress={() => setCount(n)}
                style={[styles.choice, count === n && styles.choiceOn]}
              >
                <Text style={[styles.choiceText, count === n && styles.choiceTextOn]}>{n}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Mode de jeu</Text>
          {MODE_ORDER.map((k) => (
            <Pressable key={k} onPress={() => setMode(k)} style={[styles.modeCard, mode === k && styles.modeCardOn]}>
              <ModeIcon emoji={MODES[k].emoji} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modeName}>{MODES[k].name}</Text>
                <Text style={styles.modeDesc}>{MODES[k].desc}</Text>
              </View>
            </Pressable>
          ))}
          {count === 4 ? (
            <Pressable onPress={() => setTeam(!team)} style={[styles.modeCard, team && styles.modeCardOn]}>
              <ModeIcon emoji="🤝" />
              <View style={{ flex: 1 }}>
                <Text style={styles.modeName}>En équipe</Text>
                <Text style={styles.modeDesc}>Rouge + Jaune contre Vert + Bleu</Text>
              </View>
              <View style={[styles.switch, team && styles.switchOn]}>
                <View style={[styles.switchKnob, team && styles.switchKnobOn]} />
              </View>
            </Pressable>
          ) : null}

          <Text style={styles.label}>Difficulté des ordinateurs</Text>
          <View style={styles.pillRow}>
            {LEVEL_ORDER.map((k) => (
              <Pressable key={k} onPress={() => setLevel(k)} style={[styles.pill, level === k && styles.pillOn]}>
                <Text style={[styles.pillText, level === k && styles.pillTextOn]}>
                  {LEVELS[k].emoji} {LEVELS[k].name}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Pari 💰</Text>
          <View style={styles.pillRow}>
            {[0, ...BETS].map((b) => {
              const off = b > coins;
              return (
                <Pressable
                  key={b}
                  disabled={off}
                  onPress={() => setBet(b)}
                  style={[styles.pill, bet === b && styles.pillOn, off && { opacity: 0.3 }]}
                >
                  <Text style={[styles.pillText, bet === b && styles.pillTextOn]}>{b ? `🪙 ${b}` : 'Sans'}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.betInfo}>
            {(() => {
              const colorsIn = activeColors(count);
              if (!colorsIn.some((c) => types[c] === 'human')) return 'Il faut au moins un joueur humain pour parier.';
              if (!bet || bet > coins) return 'Joue sans miser de pièces.';
              const n = colorsIn.length;
              const sideSize = team && count === 4 ? 2 : 1;
              return `Mise ${bet} 🪙 · tu gagnes ${fmt((bet * n) / sideSize)} 🪙 si tu gagnes. Quitter la partie = mise perdue.`;
            })()}
          </Text>

          <Text style={styles.label}>Joueurs</Text>
          {colors.map((c) => (
            <View key={c} style={styles.playerRow}>
              <View style={[styles.dotBig, { backgroundColor: COLORS[c].main }]} />
              <Text style={styles.playerName}>{COLORS[c].name}</Text>
              <Pressable
                onPress={() => setTypes({ ...types, [c]: types[c] === 'human' ? 'ai' : 'human' })}
                style={[styles.typeBtn, types[c] === 'human' ? styles.typeHuman : styles.typeAi]}
              >
                <Text style={styles.typeText}>{types[c] === 'human' ? '👤 Humain' : '🤖 Ordinateur'}</Text>
              </Pressable>
            </View>
          ))}

          <Pressable onPress={startGame} style={styles.playBtn}>
            <Text style={styles.playText}>JOUER</Text>
          </Pressable>

          <View style={styles.rules}>
            <Text style={styles.rulesTitle}>Règles</Text>
            <Text style={styles.rulesText}>• Il faut un 6 pour sortir un pion de la maison.</Text>
            <Text style={styles.rulesText}>• Un 6, une capture ou un pion arrivé = tu rejoues.</Text>
            <Text style={styles.rulesText}>• Trois 6 de suite = tour perdu.</Text>
            <Text style={styles.rulesText}>• Tombe sur un adversaire pour le renvoyer à sa maison.</Text>
            <Text style={styles.rulesText}>• Les cases ★ et les cases de départ sont protégées.</Text>
            <Text style={styles.rulesText}>• Il faut le nombre exact pour arriver au centre.</Text>
            <Text style={styles.rulesText}>
              • {MODES[mode].emoji} {MODES[mode].name} : {MODES[mode].desc}.
            </Text>
            {team && count === 4 ? (
              <Text style={styles.rulesText}>• 🤝 En équipe, on ne peut pas capturer son coéquipier.</Text>
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ---------- ÉCRAN JEU ----------
  const s = g.current;
  if (!s) return null;
  const cur = s.players[s.current];
  const boardMax = Math.min(width - 16, 460);
  const cell = Math.floor(boardMax / 15);
  const canRoll = s.phase === 'roll' && !s.busy && cur.type === 'human';
  const diceSize = Math.min(78, Math.floor(cell * 2.6));
  const winFx = (WIN_FX[shop.equip.win] || WIN_FX.classic).emojis;

  // Un dé à côté de chaque couleur (vide si la couleur ne joue pas)
  function diceFor(color) {
    const pi = s.players.findIndex((p) => p.color === color);
    if (pi === -1) return <View style={{ width: diceSize, height: diceSize + 22 }} />;
    const pl = s.players[pi];
    const isCur = pi === s.current && s.phase !== 'over';
    const done = pl.tokens.filter((t) => t === GOAL).length;
    const side = sideStats(s, sideOf(s, pi));
    let stat = null;
    if (s.mode === 'timed') {
      stat = <Text style={[styles.stat, { color: COLORS[color].main }]}>{playerScore(pl)} pts</Text>;
    } else if (s.mode === 'quick') {
      stat = (
        <Text style={styles.stat}>
          ⚔️ {Math.min(side.caps, 1)}/1  🏁 {Math.min(side.home, 1)}/1
        </Text>
      );
    } else if (s.mode === 'kill') {
      stat = <Text style={styles.stat}>💀 {Math.min(side.caps, KILL_TARGET)}/{KILL_TARGET}</Text>;
    }
    return (
      <View style={{ alignItems: 'center', opacity: isCur ? 1 : 0.35 }}>
        <Dice
          size={diceSize}
          value={pl.lastDice}
          color={COLORS[color].main}
          enabled={isCur && canRoll}
          blink={blink}
          onPress={roll}
          rollId={pl.rollId}
          skin={pl.type === 'human' ? shop.equip.dice : 'classic'}
        />
        {stat || (
        <View style={styles.progress}>
          {[0, 1, 2, 3].map((k) => (
            <View
              key={k}
              style={[
                styles.progressDot,
                { borderColor: COLORS[color].main },
                k < done && { backgroundColor: COLORS[color].main },
              ]}
            />
          ))}
        </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Ludo <Text style={{ color: '#FF5252' }}>Drama</Text> 🎭
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {s.mode === 'timed' ? <Timer endTime={s.endTime} over={s.phase === 'over'} /> : null}
          {s.bet ? (
            <View style={styles.timer}>
              <Text style={styles.timerText}>💰 {fmt(s.pot)}</Text>
            </View>
          ) : null}
        </View>
        <Pressable onPress={quit} style={styles.quitBtn}>
          <Text style={styles.quitText}>Quitter</Text>
        </Pressable>
      </View>

      <View style={styles.playArea}>
        <View style={[styles.diceRow, { width: cell * 15 }]}>
          {diceFor('red')}
          {diceFor('green')}
        </View>

        <View style={styles.boardWrap}>
          <Board s={s} cell={cell} blink={blink} onToken={onToken} equip={shop.equip} />
        </View>

        <View style={[styles.diceRow, { width: cell * 15 }]}>
          {diceFor('blue')}
          {diceFor('yellow')}
        </View>
      </View>

      {s.phase === 'over' ? (
        <View style={styles.overlay}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Burst kind="win" emojis={winFx} x={width / 2} y={200} cell={40} count={14} />
            <Burst kind="win" emojis={winFx} x={width / 4} y={420} cell={34} count={10} />
            <Burst kind="win" emojis={winFx} x={(width * 3) / 4} y={420} cell={34} count={10} />
            {s.payout > 0 ? <Burst kind="coins" x={width / 2} y={520} cell={40} count={14} /> : null}
          </View>
          <View style={styles.winBox}>
            <Text style={styles.winEmoji}>🏆</Text>
            <Text style={styles.winConfetti}>🎊 🥳 🎊</Text>
            <Text style={[styles.winText, { color: COLORS[s.players[s.winner].color].main }]}>
              {winnerLabel(s)}
            </Text>
            <Text style={styles.dramaLine}>{s.dramaLine}</Text>
            {s.bet && s.you >= 0 ? (
              <Text style={[styles.betResult, { color: s.payout > 0 ? '#66BB6A' : '#EF5350' }]}>
                {s.payout > 0 ? `🤑 +${fmt(s.payout)} 🪙` : `😢 −${fmt(s.bet)} 🪙`}
              </Text>
            ) : null}
            {s.mode === 'timed' ? <TimedResults s={s} /> : null}
            <Pressable onPress={startGame} style={styles.playBtn}>
              <Text style={styles.playText}>REJOUER</Text>
            </Pressable>
            <Pressable onPress={quit} style={styles.menuBtn}>
              <Text style={styles.menuText}>Menu</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function winnerLabel(s) {
  const w = s.winner;
  if (s.team) {
    const mates = s.players.filter((p, pi) => sideOf(s, pi) === sideOf(s, w));
    return 'Équipe ' + mates.map((p) => COLORS[p.color].name).join(' + ') + ' gagne !';
  }
  return nameOf(s.players[w]) + ' a gagné !';
}

// Classement du mode 5 minutes
function TimedResults({ s }) {
  const sides = [];
  s.players.forEach((pl, pi) => {
    const side = sideOf(s, pi);
    let e = sides.find((x) => x.side === side);
    if (!e) sides.push((e = { side, colors: [], score: sideStats(s, side).score }));
    e.colors.push(pl.color);
  });
  sides.sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];
  return (
    <View style={{ marginTop: 10, alignSelf: 'stretch' }}>
      {sides.map((e, k) => (
        <View key={e.side} style={styles.resultRow}>
          <Text style={styles.resultMedal}>{medals[k]}</Text>
          <View style={{ flexDirection: 'row', flex: 1, gap: 4 }}>
            {e.colors.map((c) => (
              <View key={c} style={[styles.dotBig, { backgroundColor: COLORS[c].main, marginRight: 0 }]} />
            ))}
          </View>
          <Text style={styles.resultScore}>{e.score} pts</Text>
        </View>
      ))}
    </View>
  );
}

function Timer({ endTime, over }) {
  const left = over ? 0 : Math.max(0, endTime - Date.now());
  const sec = Math.ceil(left / 1000);
  const txt = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return (
    <View style={[styles.timer, sec <= 30 && styles.timerHurry]}>
      <Text style={styles.timerText}>⏱️ {txt}</Text>
    </View>
  );
}

function ModeIcon({ emoji }) {
  return (
    <View style={styles.modeIcon}>
      <View style={styles.modeQuads}>
        {['red', 'green', 'blue', 'yellow'].map((c) => (
          <View key={c} style={{ width: '50%', height: '50%', backgroundColor: COLORS[c].main }} />
        ))}
      </View>
      <View style={styles.modeIconInner}>
        <Text style={styles.modeEmoji}>{emoji}</Text>
      </View>
    </View>
  );
}

// ---------- APERÇUS DE LA BOUTIQUE ----------
function ShopPreview({ cat, id }) {
  if (cat === 'pawn') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        <Pawn color="red" size={40} skin={id} />
        <Pawn color="blue" size={40} skin={id} />
      </View>
    );
  }
  if (cat === 'dice') return <Dice size={62} value={5} color="#E53935" enabled={false} skin={id} />;
  if (cat === 'board') return <MiniBoard theme={BOARDS[id]} />;
  return <Text style={{ fontSize: 26 }}>{WIN_FX[id].emojis.slice(0, 4).join('')}</Text>;
}

function MiniBoard({ theme }) {
  const u = 22;
  const corner = { 0: 'red', 2: 'green', 6: 'blue', 8: 'yellow' };
  return (
    <View style={{ width: u * 3, height: u * 3, flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: theme.line }}>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => (
        <View
          key={k}
          style={{
            width: u,
            height: u,
            backgroundColor: corner[k] ? COLORS[corner[k]].main : theme.track,
            borderWidth: corner[k] ? 0 : 0.5,
            borderColor: theme.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {corner[k] ? (
            <View style={{ width: u * 0.6, height: u * 0.6, borderRadius: 4, backgroundColor: theme.yard }} />
          ) : k === 4 ? (
            <Text style={{ fontSize: 12, color: theme.star }}>{theme.deco || '★'}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function PagnePattern({ size }) {
  const n = 6;
  const u = size / n;
  const cols = ['#E65100', '#00897B', '#6D4C41', '#FBC02D'];
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, flexDirection: 'row', flexWrap: 'wrap' }}>
      {Array.from({ length: n * n }, (_, k) => (
        <View key={k} style={{ width: u, height: u, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: u * 0.5,
              height: u * 0.5,
              backgroundColor: cols[(k + Math.floor(k / n)) % cols.length],
              opacity: 0.55,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      ))}
    </View>
  );
}

// ---------- PLATEAU ----------
function Board({ s, cell, blink, onToken, equip = DEFAULT_SHOP.equip }) {
  const th = BOARDS[equip.board] || BOARDS.classic;
  const size = cell * 15;
  const parts = [];

  // Parcours
  TRACK.forEach(([r, c], idx) => {
    const startColor = ORDER.find((col) => START[col] === idx);
    const isStar = SAFE.includes(idx) && !startColor;
    parts.push(
      <View
        key={'t' + idx}
        style={[
          styles.cell,
          {
            top: r * cell,
            left: c * cell,
            width: cell,
            height: cell,
            backgroundColor: startColor ? COLORS[startColor].main : th.track,
            borderColor: th.line,
          },
        ]}
      >
        {isStar ? <Text style={{ fontSize: cell * 0.6, color: th.star }}>★</Text> : null}
        {startColor ? <Text style={{ fontSize: cell * 0.5, color: '#FFFFFF' }}>➜</Text> : null}
      </View>
    );
  });

  // Couloirs finaux
  ORDER.forEach((col) =>
    HOME[col].forEach(([r, c], k) =>
      parts.push(
        <View
          key={col + 'h' + k}
          style={[
            styles.cell,
            { top: r * cell, left: c * cell, width: cell, height: cell, backgroundColor: COLORS[col].main },
          ]}
        />
      )
    )
  );

  // Maisons
  ORDER.forEach((col) => {
    const [r, c] = YARD[col];
    parts.push(
      <View
        key={'y' + col}
        style={{
          position: 'absolute',
          top: r * cell,
          left: c * cell,
          width: 6 * cell,
          height: 6 * cell,
          backgroundColor: COLORS[col].main,
          padding: cell * 0.6,
          borderWidth: 1,
          borderColor: '#333',
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: th.yard,
            borderRadius: cell * 0.5,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {th.pattern ? <PagnePattern size={cell * 4.8} /> : null}
          {th.deco ? <Text style={{ fontSize: cell * 1.1, opacity: 0.8 }}>{th.deco}</Text> : null}
        </View>
      </View>
    );
    YARD_SPOTS.forEach(([dr, dc], k) =>
      parts.push(
        <View
          key={'ys' + col + k}
          style={{
            position: 'absolute',
            top: (r + dr) * cell,
            left: (c + dc) * cell,
            width: cell,
            height: cell,
            borderRadius: cell / 2,
            backgroundColor: COLORS[col].light,
          }}
        />
      )
    );
  });

  // Centre (4 triangles)
  parts.push(
    <View
      key="center"
      style={{
        position: 'absolute',
        top: 6 * cell,
        left: 6 * cell,
        width: 0,
        height: 0,
        borderTopWidth: 1.5 * cell,
        borderBottomWidth: 1.5 * cell,
        borderLeftWidth: 1.5 * cell,
        borderRightWidth: 1.5 * cell,
        borderTopColor: COLORS.green.main,
        borderRightColor: COLORS.yellow.main,
        borderBottomColor: COLORS.blue.main,
        borderLeftColor: COLORS.red.main,
      }}
    />
  );

  // Pions (regroupés quand plusieurs sont sur la même case)
  const groups = {};
  s.players.forEach((pl, pi) =>
    pl.tokens.forEach((p, ti) => {
      const [r, c] = tokenCell(pl.color, p, ti);
      const key = r + ',' + c;
      (groups[key] = groups[key] || []).push({ pl, pi, ti, r, c });
    })
  );
  const current = s.players[s.current];
  const pawns = [];
  Object.values(groups).forEach((list) =>
    list.forEach((t, k) => {
      const n = list.length;
      let sz = cell * 0.86;
      let offR = cell * 0.08;
      let offC = cell * 0.07;
      if (n > 1) {
        sz = cell * 0.56;
        const [a, b] = [[0, 0], [0, 1], [1, 0], [1, 1]][k % 4];
        offR = a * cell * 0.44;
        offC = b * cell * 0.44;
      }
      const active =
        s.phase === 'move' &&
        t.pi === s.current &&
        current.type === 'human' &&
        s.movable.includes(t.ti);
      const h = sz * 1.25;
      const bottom = t.r * cell + offR + sz; // bas du pion
      pawns.push({ bottom, el: (
        <Pressable
          key={'p' + t.pl.color + t.ti}
          onPress={() => onToken(t.pi, t.ti)}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: bottom - h,
            left: t.c * cell + offC,
            width: sz,
            height: h,
            transform: [{ translateY: active && blink ? -cell * 0.18 : 0 }],
          }}
        >
          {active ? (
            <View
              style={{
                position: 'absolute',
                bottom: -sz * 0.08,
                left: -sz * 0.1,
                width: sz * 1.2,
                height: sz * 0.5,
                borderRadius: sz,
                backgroundColor: blink ? '#FFFFFF' : COLORS[t.pl.color].light,
                borderWidth: 2,
                borderColor: COLORS[t.pl.color].dark,
              }}
            />
          ) : null}
          <Pawn color={t.pl.color} size={sz} skin={t.pl.type === 'human' ? equip.pawn : 'classic'} />
        </Pressable>
      ) });
    })
  );
  // Les pions plus bas à l'écran passent devant
  pawns.sort((a, b) => a.bottom - b.bottom).forEach((p) => parts.push(p.el));

  // Pluies d'emojis
  s.effects.forEach((e) =>
    parts.push(
      <Burst key={'fx' + e.id} kind={e.kind} x={(e.c + 0.5) * cell} y={(e.r + 0.5) * cell} cell={cell} />
    )
  );

  return (
    <View style={{ width: size, height: size, backgroundColor: th.track }}>
      {parts}
      {s.banner ? (
        <View pointerEvents="none" style={styles.bannerWrap}>
          <Banner key={'b' + s.banner.id} text={s.banner.text} />
        </View>
      ) : null}
    </View>
  );
}

// ---------- PION (forme de quille) ----------
function Pawn({ color, size, skin = 'classic' }) {
  // Forme « goutte » : un rond avec une pointe en bas qui montre la case
  const base = COLORS[color];
  const sk = PAWN_SKINS[skin] || PAWN_SKINS.classic;
  let line = Math.max(1, size * 0.05);
  let edge = base.dark;
  let ring = '#FFFFFF';
  if (skin === 'gold') {
    edge = '#FFB300';
    ring = '#FFD54F';
    line = Math.max(1.5, size * 0.08);
  }
  if (skin === 'neon') edge = '#FFFFFF';
  const d = size * 0.84; // diamètre de la tête
  const tip = size * 0.06; // hauteur de la pointe au-dessus du sol
  const center = tip + d * 0.707; // centre du rond, mesuré depuis le bas
  const showEmoji = skin === 'star' || skin === 'lion';
  return (
    <View style={{ width: size, height: size * 1.25, alignItems: 'center' }}>
      {skin === 'neon' ? (
        <View
          style={{
            position: 'absolute',
            bottom: center - d * 0.68,
            width: d * 1.36,
            height: d * 1.36,
            borderRadius: d,
            backgroundColor: base.main,
            opacity: 0.35,
          }}
        />
      ) : null}
      {/* ombre */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          width: size * 0.56,
          height: size * 0.18,
          borderRadius: size,
          backgroundColor: 'rgba(0,0,0,0.3)',
        }}
      />
      {/* goutte (carré arrondi sur 3 coins, tourné de 45°) */}
      <View
        style={{
          position: 'absolute',
          bottom: center - d / 2,
          width: d,
          height: d,
          borderTopLeftRadius: d / 2,
          borderTopRightRadius: d / 2,
          borderBottomLeftRadius: d / 2,
          borderBottomRightRadius: d * 0.08,
          backgroundColor: base.main,
          borderWidth: line,
          borderColor: edge,
          transform: [{ rotate: '45deg' }],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {!showEmoji ? (
          <View
            style={{
              width: d * 0.5,
              height: d * 0.5,
              borderRadius: d * 0.25,
              backgroundColor: ring,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ width: d * 0.26, height: d * 0.26, borderRadius: d * 0.13, backgroundColor: base.main }} />
          </View>
        ) : null}
      </View>
      {/* reflet brillant */}
      <View
        style={{
          position: 'absolute',
          bottom: center + d * 0.2,
          left: size / 2 - d * 0.36,
          width: d * 0.2,
          height: d * 0.13,
          borderRadius: d * 0.1,
          backgroundColor: 'rgba(255,255,255,0.6)',
          transform: [{ rotate: '-35deg' }],
        }}
      />
      {showEmoji ? (
        <View
          style={{
            position: 'absolute',
            bottom: center - d * 0.32,
            width: d * 0.64,
            height: d * 0.64,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: d * (skin === 'lion' ? 0.46 : 0.4) }}>{sk.emoji}</Text>
        </View>
      ) : null}
      {skin === 'crown' ? (
        <Text style={{ position: 'absolute', bottom: center + d * 0.38, fontSize: size * 0.34 }}>👑</Text>
      ) : null}
    </View>
  );
}

// ---------- EFFETS ----------
function Burst({ kind, x, y, cell, count = 9, emojis }) {
  const list = emojis || EMOJIS[kind];
  const items = useRef(
    Array.from({ length: count }, (_, k) => ({
      emoji: list[k % list.length],
      dx: (Math.random() - 0.5) * cell * 7,
      dy: -(cell * 2 + Math.random() * cell * 4),
      rot: (Math.random() - 0.5) * 540,
      anim: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    Animated.stagger(
      45,
      items.map((it) =>
        Animated.timing(it.anim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      )
    ).start();
  }, []);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {items.map((it, k) => (
        <Animated.Text
          key={k}
          style={{
            position: 'absolute',
            left: x - cell * 0.55,
            top: y - cell * 0.65,
            fontSize: cell * 1.1,
            opacity: it.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: it.anim.interpolate({ inputRange: [0, 1], outputRange: [0, it.dx] }) },
              { translateY: it.anim.interpolate({ inputRange: [0, 1], outputRange: [0, it.dy] }) },
              { scale: it.anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.3, 1.4, 1] }) },
              { rotate: it.anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', it.rot + 'deg'] }) },
            ],
          }}
        >
          {it.emoji}
        </Animated.Text>
      ))}
    </View>
  );
}

function Banner({ text }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(a, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(a, { toValue: 2, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View
      style={[
        styles.banner,
        {
          opacity: a.interpolate({ inputRange: [0, 0.3, 1, 2], outputRange: [0, 1, 1, 0] }),
          transform: [{ scale: a.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.2] }) }],
        },
      ]}
    >
      <Text style={styles.bannerText}>{text}</Text>
    </Animated.View>
  );
}

// ---------- DÉ (3D, qui tourne) ----------
const DOTS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function Dice({ value, color, enabled, blink, onPress, rollId, size = 80, skin = 'classic' }) {
  const ds = DICE_SKINS[skin] || DICE_SKINS.classic;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!rollId) return;
    spin.setValue(0);
    Animated.timing(spin, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [rollId]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] });
  const scale = spin.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.3, 1] });
  const dots = value ? DOTS[value] : [];
  const big = value === 1;
  const grid = size * 0.6;
  const slot = grid / 3;
  const dot = slot * 0.7;

  return (
    <Pressable onPress={onPress} disabled={!enabled} hitSlop={10}>
      <View style={{ transform: [{ scale: enabled && blink ? 1.1 : 1 }] }}>
        <Animated.View
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.26,
            padding: size * 0.06,
            backgroundColor: color,
            elevation: 10,
            transform: [{ rotate }, { scale }],
          }}
        >
          <View
            style={{
              flex: 1,
              borderRadius: size * 0.2,
              backgroundColor: ds.face,
              borderBottomWidth: size * 0.07,
              borderRightWidth: size * 0.035,
              borderColor: ds.edge,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ width: grid, height: grid, flexDirection: 'row', flexWrap: 'wrap' }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => (
                <View key={k} style={{ width: slot, height: slot, alignItems: 'center', justifyContent: 'center' }}>
                  {dots.includes(k) ? (
                    <View
                      style={{
                        width: big ? dot * 1.5 : dot,
                        height: big ? dot * 1.5 : dot,
                        borderRadius: dot,
                        backgroundColor: big ? ds.one : ds.pip,
                      }}
                    />
                  ) : null}
                </View>
              ))}
            </View>
            {ds.deco ? (
              <Text style={{ position: 'absolute', top: -size * 0.02, right: size * 0.02, fontSize: size * 0.22 }}>
                {ds.deco}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#14142B',
    paddingTop: StatusBar.currentHeight || 24,
  },
  menu: { alignItems: 'center', padding: 20, paddingBottom: 40 },
  logoRow: { flexDirection: 'row', marginTop: 20, gap: 8 },
  logoPawn: { width: 28, height: 28, borderRadius: 14, borderWidth: 3, borderColor: '#FFFFFF' },
  title: { fontSize: 40, fontWeight: '900', color: '#FFFFFF', marginTop: 10, letterSpacing: 1 },
  titleFiesta: { color: '#FF5252' },
  subtitle: { fontSize: 16, color: '#B0B0D0', marginBottom: 20 },
  label: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', alignSelf: 'flex-start', marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12, alignSelf: 'flex-start' },
  choice: { width: 56, height: 56, borderRadius: 14, backgroundColor: '#24244A', alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: '#FFFFFF' },
  choiceText: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  choiceTextOn: { color: '#14142B' },
  playerRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#24244A', borderRadius: 14, padding: 12, marginBottom: 8 },
  dotBig: { width: 24, height: 24, borderRadius: 12, marginRight: 12, borderWidth: 2, borderColor: '#FFFFFF' },
  playerName: { color: '#FFFFFF', fontSize: 16, flex: 1, fontWeight: '600' },
  typeBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  typeHuman: { backgroundColor: '#3949AB' },
  typeAi: { backgroundColor: '#555577' },
  typeText: { color: '#FFFFFF', fontWeight: '700' },
  playBtn: { marginTop: 24, backgroundColor: '#FBC02D', paddingVertical: 16, paddingHorizontal: 60, borderRadius: 30 },
  playText: { fontSize: 20, fontWeight: '900', color: '#14142B', letterSpacing: 1 },
  rules: { marginTop: 28, backgroundColor: '#24244A', borderRadius: 14, padding: 16, alignSelf: 'stretch' },
  rulesTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 16, marginBottom: 8 },
  rulesText: { color: '#C8C8E8', fontSize: 14, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  headerTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '900' },
  quitBtn: { backgroundColor: '#24244A', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10 },
  quitText: { color: '#FFFFFF', fontWeight: '700' },
  chips: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 2, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  boardWrap: { alignItems: 'center', justifyContent: 'center' },
  playArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
  diceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10, paddingHorizontal: 4 },
  progress: { flexDirection: 'row', marginTop: 6, gap: 4 },
  stat: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', marginTop: 5 },
  shopOpen: { marginTop: 4, backgroundColor: '#FBC02D', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16 },
  shopOpenText: { color: '#14142B', fontSize: 16, fontWeight: '900' },
  walletSmall: { backgroundColor: '#24244A', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 2, borderColor: '#FBC02D' },
  walletSmallText: { color: '#FBC02D', fontSize: 15, fontWeight: '900' },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, marginTop: 6 },
  tab: { flex: 1, alignItems: 'center', backgroundColor: '#24244A', borderRadius: 14, paddingVertical: 8 },
  tabOn: { backgroundColor: '#FFFFFF' },
  tabEmoji: { fontSize: 20 },
  tabText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12, marginTop: 2 },
  tabTextOn: { color: '#14142B' },
  shopMsg: { color: '#FBC02D', textAlign: 'center', fontWeight: '800', marginTop: 10, minHeight: 20, paddingHorizontal: 12 },
  shopGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', padding: 12, paddingBottom: 40 },
  shopCard: {
    width: '48%',
    backgroundColor: '#24244A',
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  shopCardOn: { borderColor: '#66BB6A' },
  shopPreview: { height: 86, alignItems: 'center', justifyContent: 'center' },
  shopName: { color: '#FFFFFF', fontWeight: '800', fontSize: 15, marginTop: 6 },
  shopBtn: { marginTop: 8, backgroundColor: '#FBC02D', borderRadius: 12, paddingVertical: 6, paddingHorizontal: 14 },
  shopBtnOwned: { backgroundColor: '#3949AB' },
  shopBtnOn: { backgroundColor: '#2E7D32' },
  shopBtnText: { color: '#FFFFFF', fontWeight: '900' },
  wallet: { marginTop: 4, backgroundColor: '#24244A', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 18, borderWidth: 2, borderColor: '#FBC02D' },
  walletText: { color: '#FBC02D', fontSize: 20, fontWeight: '900' },
  refill: { marginTop: 10, backgroundColor: '#43A047', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14 },
  refillText: { color: '#FFFFFF', fontWeight: '800' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'flex-start' },
  pill: { backgroundColor: '#24244A', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 2, borderColor: 'transparent' },
  pillOn: { backgroundColor: '#FFFFFF', borderColor: '#FBC02D' },
  pillText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  pillTextOn: { color: '#14142B' },
  betInfo: { color: '#B0B0D0', fontSize: 13, alignSelf: 'flex-start', marginTop: 8 },
  betResult: { fontSize: 26, fontWeight: '900', marginTop: 8 },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#24244A',
    borderRadius: 16,
    padding: 10,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: 12,
  },
  modeCardOn: { borderColor: '#FBC02D', backgroundColor: '#2E2E5C' },
  modeIcon: { width: 54, height: 54, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#8D6E63' },
  modeQuads: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', flexWrap: 'wrap' },
  modeIconInner: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  modeEmoji: { fontSize: 22 },
  modeName: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  modeDesc: { color: '#B0B0D0', fontSize: 13, marginTop: 2 },
  switch: { width: 46, height: 26, borderRadius: 13, backgroundColor: '#555577', padding: 3 },
  switchOn: { backgroundColor: '#43A047' },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  switchKnobOn: { marginLeft: 20 },
  timer: { backgroundColor: '#24244A', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12 },
  timerHurry: { backgroundColor: '#C62828' },
  timerText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  resultMedal: { fontSize: 22, width: 36 },
  resultScore: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  progressDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  cell: { position: 'absolute', borderWidth: 0.5, borderColor: '#555', alignItems: 'center', justifyContent: 'center' },
  message: { color: '#FFFFFF', fontSize: 16, textAlign: 'center', marginTop: 12, paddingHorizontal: 16, minHeight: 44 },
  diceArea: { alignItems: 'center', marginTop: 4 },
  diceOuter: { width: 92, height: 92, borderRadius: 24, padding: 5, elevation: 10 },
  diceFace: {
    flex: 1,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 6,
    borderRightWidth: 3,
    borderColor: '#CFCFE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diceGrid: { width: 60, height: 60, flexDirection: 'row', flexWrap: 'wrap' },
  diceSlot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  bannerWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  dramaLine: { color: '#FFFFFF', fontSize: 16, fontStyle: 'italic', marginTop: 6, textAlign: 'center' },
  banner: {
    maxWidth: '92%',
    backgroundColor: 'rgba(20,20,43,0.92)',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#FBC02D',
  },
  bannerText: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  winConfetti: { fontSize: 30, marginTop: 4 },
  diceHint: { color: '#B0B0D0', marginTop: 6 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  winBox: { backgroundColor: '#24244A', borderRadius: 20, padding: 28, alignItems: 'center', width: '85%' },
  winEmoji: { fontSize: 64 },
  winText: { fontSize: 26, fontWeight: '900', marginTop: 8, textAlign: 'center' },
  menuBtn: { marginTop: 12, padding: 10 },
  menuText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
