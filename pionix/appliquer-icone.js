// Applique le nom, l'icône et l'écran de démarrage de Ludo Drama dans app.json
const fs = require('fs');
const path = require('path');

const fichier = path.join(__dirname, 'app.json');
const j = JSON.parse(fs.readFileSync(fichier, 'utf8'));
const e = j.expo;

e.name = 'Ludo Drama';
e.icon = './assets/pionix-icon.png';
e.android = e.android || {};
e.android.adaptiveIcon = {
  foregroundImage: './assets/pionix-adaptive.png',
  backgroundColor: '#FBC02D',
};
e.splash = {
  image: './assets/pionix-splash.png',
  resizeMode: 'contain',
  backgroundColor: '#14142B',
};
if (Array.isArray(e.plugins)) {
  e.plugins = e.plugins.map((p) =>
    Array.isArray(p) && p[0] === 'expo-splash-screen'
      ? ['expo-splash-screen', { ...p[1], image: './assets/pionix-splash.png', backgroundColor: '#14142B' }]
      : p
  );
}

fs.writeFileSync(fichier, JSON.stringify(j, null, 2) + '\n');
console.log('✅ Icône et nom « Ludo Drama » appliqués !');
