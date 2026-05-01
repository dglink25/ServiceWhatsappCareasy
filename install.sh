#!/bin/bash

# Script d'installation du WhatsApp Gateway



set -e

echo ""

echo " Installation WhatsApp Gateway"

echo ""

# ── 1. Vérifier Node.js ──────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "Installation de Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    NODE_VER=$(node -v)
    echo "Node.js déjà installé : $NODE_VER"
fi

# ── 2. Installer Chromium (requis par puppeteer/whatsapp-web.js) ──
echo ""
echo "Installation des dépendances système (Chromium)..."
sudo apt-get update -q
sudo apt-get install -y -q \
    chromium-browser \
    libgbm-dev \
    libxshmfence-dev \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils 2>/dev/null || true

echo "Dépendances système installées."

# ── 3. Installer les dépendances Node.js ──────────────────────────
echo ""
echo "Installation des packages Node.js..."
npm install

echo "Packages Node.js installés."

# ── 4. Configurer le fichier .env ─────────────────────────────────
if [ ! -f .env ]; then
    cp .env.example .env
    
    # Générer une clé secrète aléatoire
    SECRET=$(openssl rand -hex 32)
    sed -i "s/your-super-secret-key-here-2024/$SECRET/" .env
    
    echo ""
    echo "Fichier .env créé."
    echo "Clé secrète générée : $SECRET"
    echo ""
    echo " IMPORTANT : Copiez cette clé dans votre .env Laravel :"
    echo "   WHATSAPP_API_SECRET=$SECRET"
else
    echo "Fichier .env déjà existant."
fi

# ── 5. Installer PM2 pour la persistance ──────────────────────────
echo ""
echo "Installation de PM2 (gestionnaire de processus)..."
sudo npm install -g pm2 2>/dev/null || npm install -g pm2

echo "PM2 installé."

# ── 6. Résumé ─────────────────────────────────────────────────────
echo ""

echo " Installation terminée !"


echo "  1. Démarrer le service :"
echo "     pm2 start server.js --name whatsapp-gateway"
echo ""
echo "  2. Scanner le QR Code :"
echo "     Ouvrir http://localhost:3001 dans le navigateur"
echo "     OU voir dans les logs : pm2 logs whatsapp-gateway"
echo ""
echo "  3. Rendre PM2 persistant au redémarrage :"
echo "     pm2 save && pm2 startup"
echo ""
echo "  4. Ajouter dans .env Laravel :"
echo "     WHATSAPP_GATEWAY_URL=http://localhost:3001"
echo "     WHATSAPP_API_SECRET=<votre-cle-dans-.env>"
echo ""