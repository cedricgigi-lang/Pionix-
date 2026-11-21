// Pionix — Ludo entre amis (version 1 : contre l'ordinateur ou sur le même téléphone)
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

function createGame(count, types) {
  return {
    players: activeColors(count).map((c) => ({
      color: c,
      type: types[c],
      tokens: [-1, -1, -1, -1],
    })),
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
    rollId: 0, // fait tourner le dé
  };
}

// Applique la fin d'un déplacement : captures, arrivée, victoire, tour bonus
function resolveMove(s, i) {
  const pl = s.players[s.current];
  const np = pl.tokens[i];
  let bonus = s.dice === 6;
  let caught = 0;
  if (np <= LAST_TRACK) {
    const gi = globalIdx(pl.color, np);
    if (!SAFE.includes(gi)) {
      s.players.forEach((o, oi) => {
        if (oi === s.current) return;
        o.tokens.forEach((op, ti) => {
          if (op >= 0 && op <= LAST_TRACK && globalIdx(o.color, op) === gi) {
            o.tokens[ti] = -1;
            caught++;
          }
        });
      });
    }
  }
  if (caught) bonus = true;
  const arrived = np === GOAL;
  if (arrived) bonus = true;
  const won = pl.tokens.every((t) => t === GOAL);
  return { bonus, caught, arrived, won };
}

function inDanger(s, meIdx, gi) {
  if (SAFE.includes(gi)) return false;
  return s.players.some(
    (o, oi) =>
      oi !== meIdx &&
      o.tokens.some((op) => {
        if (op < 0 || op > LAST_TRACK) return false;
        const d = (gi - globalIdx(o.color, op) + 52) % 52;
        return d >= 1 && d <= 6;
      })
  );
}

// Choix de l'ordinateur : capturer > finir > sortir > se mettre à l'abri > avancer
function aiChoose(s) {
  const pl = s.players[s.current];
  const v = s.dice;
  let best = s.movable[0];
  let bestScore = -Infinity;
  for (const i of s.movable) {
    const p = pl.tokens[i];
    const np = p === -1 ? 0 : p + v;
    let score = np * 0.5;
    if (np === GOAL) score += 100;
    if (p === -1) score += 60;
    if (np <= LAST_TRACK) {
      const gi = globalIdx(pl.color, np);
      const captures =
        !SAFE.includes(gi) &&
        s.players.some(
          (o, oi) =>
            oi !== s.current &&
            o.tokens.some((op) => op >= 0 && op <= LAST_TRACK && globalIdx(o.color, op) === gi)
        );
      if (captures) score += 80;
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

// Emojis des effets
const EMOJIS = {
  arrive: ['🎉', '🥳', '⭐', '✨', '🏆', '🎊', '💫', '🙌'],
  capture: ['💥', '😈', '🔥', '😂', '⚡', '👊', '😜', '💨'],
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

  function nextPlayer(s) {
    s.current = (s.current + 1) % s.players.length;
    s.sixes = 0;
    s.phase = 'roll';
    s.movable = [];
    s.message = turnMsg(s);
    render();
    scheduleAI(s);
  }

  function startGame() {
    const s = createGame(count, types);
    s.message = turnMsg(s);
    g.current = s;
    setScreen('game');
    render();
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
    s.rollId++;
    const pl = s.players[s.current];
    for (let k = 0; k < 7; k++) {
      s.dice = 1 + Math.floor(Math.random() * 6);
      render();
      await sleep(60);
      if (g.current !== s) return;
    }
    const v = 1 + Math.floor(Math.random() * 6);
    s.dice = v;
    s.sixes = v === 6 ? s.sixes + 1 : 0;

    if (s.sixes === 3) {
      s.message = `${nameOf(pl)} fait trois 6 : tour perdu !`;
      fx(s, null, null, '😱 Trois 6 ! Tour perdu');
      await sleep(1200);
      if (g.current !== s) return;
      s.busy = false;
      nextPlayer(s);
      return;
    }

    const movable = [0, 1, 2, 3].filter((i) => canMove(pl.tokens[i], v));
    if (movable.length === 0) {
      s.message = `${nameOf(pl)} fait ${v} : aucun pion ne peut bouger`;
      render();
      await sleep(1200);
      if (g.current !== s) return;
      s.busy = false;
      nextPlayer(s);
      return;
    }

    if (v === 6) fx(s, null, null, '🎲 SIX ! 🔥');

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
    if (res.caught) fx(s, 'capture', tokenCell(pl.color, np, i), '💥 CAPTURE ! 💥');
    if (res.arrived) fx(s, 'arrive', FINISH[pl.color], '🎉 PION ARRIVÉ ! 🎉');
    if (res.won) {
      s.winner = s.current;
      s.phase = 'over';
      s.busy = false;
      render();
      return;
    }

    s.busy = false;
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
          <Text style={styles.title}>Pionix</Text>
          <Text style={styles.subtitle}>Le Ludo entre amis</Text>

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
            <Text style={styles.rulesText}>• Le premier qui amène ses 4 pions au centre gagne !</Text>
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

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Pionix</Text>
        <Pressable onPress={quit} style={styles.quitBtn}>
          <Text style={styles.quitText}>Quitter</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {s.players.map((pl, pi) => (
          <View
            key={pl.color}
            style={[
              styles.chip,
              { borderColor: COLORS[pl.color].main },
              pi === s.current && { backgroundColor: COLORS[pl.color].main },
            ]}
          >
            <Text style={styles.chipText}>
              {COLORS[pl.color].name} {pl.tokens.filter((t) => t === GOAL).length}/4
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.boardWrap}>
        <Board s={s} cell={cell} blink={blink} onToken={onToken} />
      </View>

      <Text style={styles.message}>{s.message}</Text>

      <View style={styles.diceArea}>
        <Dice
          value={s.dice}
          color={COLORS[cur.color].main}
          enabled={canRoll}
          blink={blink}
          onPress={roll}
          rollId={s.rollId}
        />
        {canRoll ? <Text style={styles.diceHint}>Touche le dé</Text> : null}
      </View>

      {s.phase === 'over' ? (
        <View style={styles.overlay}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Burst kind="win" x={width / 2} y={200} cell={40} count={14} />
            <Burst kind="win" x={width / 4} y={420} cell={34} count={10} />
            <Burst kind="win" x={(width * 3) / 4} y={420} cell={34} count={10} />
          </View>
          <View style={styles.winBox}>
            <Text style={styles.winEmoji}>🏆</Text>
            <Text style={styles.winConfetti}>🎊 🥳 🎊</Text>
            <Text style={[styles.winText, { color: COLORS[s.players[s.winner].color].main }]}>
              {nameOf(s.players[s.winner])} a gagné !
            </Text>
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

// ---------- PLATEAU ----------
function Board({ s, cell, blink, onToken }) {
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
            backgroundColor: startColor ? COLORS[startColor].main : '#FFFFFF',
          },
        ]}
      >
        {isStar ? <Text style={{ fontSize: cell * 0.6, color: '#9E9E9E' }}>★</Text> : null}
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
        <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: cell * 0.5 }} />
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
          <Pawn color={t.pl.color} size={sz} />
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
    <View style={{ width: size, height: size, backgroundColor: '#FFFFFF' }}>
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
function Pawn({ color, size }) {
  const c = COLORS[color];
  const line = Math.max(1, size * 0.05);
  return (
    <View style={{ width: size, height: size * 1.25, alignItems: 'center' }}>
      {/* ombre */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          width: size * 0.92,
          height: size * 0.26,
          borderRadius: size,
          backgroundColor: 'rgba(0,0,0,0.3)',
        }}
      />
      {/* socle */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.05,
          width: size * 0.86,
          height: size * 0.42,
          borderTopLeftRadius: size * 0.43,
          borderTopRightRadius: size * 0.43,
          borderBottomLeftRadius: size * 0.18,
          borderBottomRightRadius: size * 0.18,
          backgroundColor: c.main,
          borderWidth: line,
          borderColor: c.dark,
        }}
      />
      {/* cou */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.4,
          width: size * 0.3,
          height: size * 0.24,
          backgroundColor: c.main,
          borderLeftWidth: line,
          borderRightWidth: line,
          borderColor: c.dark,
        }}
      />
      {/* tête */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.56,
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: size * 0.3,
          backgroundColor: c.main,
          borderWidth: line,
          borderColor: c.dark,
        }}
      >
        {/* reflet brillant */}
        <View
          style={{
            position: 'absolute',
            top: size * 0.07,
            left: size * 0.1,
            width: size * 0.18,
            height: size * 0.13,
            borderRadius: size * 0.1,
            backgroundColor: 'rgba(255,255,255,0.75)',
          }}
        />
      </View>
    </View>
  );
}

// ---------- EFFETS ----------
function Burst({ kind, x, y, cell, count = 9 }) {
  const items = useRef(
    Array.from({ length: count }, (_, k) => ({
      emoji: EMOJIS[kind][k % EMOJIS[kind].length],
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

function Dice({ value, color, enabled, blink, onPress, rollId }) {
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

  return (
    <Pressable onPress={onPress} disabled={!enabled}>
      <View style={{ transform: [{ scale: enabled && blink ? 1.08 : 1 }] }}>
        <Animated.View style={[styles.diceOuter, { backgroundColor: color, transform: [{ rotate }, { scale }] }]}>
          <View style={styles.diceFace}>
            <View style={styles.diceGrid}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => (
                <View key={k} style={styles.diceSlot}>
                  {dots.includes(k) ? (
                    <View style={[styles.dot, big && styles.dotBig, big && { backgroundColor: '#E53935' }]} />
                  ) : null}
                </View>
              ))}
            </View>
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
  title: { fontSize: 48, fontWeight: '900', color: '#FFFFFF', marginTop: 10, letterSpacing: 2 },
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
  headerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  quitBtn: { backgroundColor: '#24244A', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10 },
  quitText: { color: '#FFFFFF', fontWeight: '700' },
  chips: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 2, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  boardWrap: { alignItems: 'center', justifyContent: 'center' },
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
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#14142B', borderTopWidth: 2, borderColor: '#000000' },
  dotBig: { width: 22, height: 22, borderRadius: 11 },
  bannerWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  banner: {
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
