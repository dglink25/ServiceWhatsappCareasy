
'use strict';

const express    = require('express');
const bodyParser = require('body-parser');
const QRCode     = require('qrcode');
const pino       = require('pino');
const fs         = require('fs');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 8100;
const HOST = process.env.IP   || '::';

const API_SECRET = process.env.WHATSAPP_API_SECRET || 'change-this-secret-key';

app.use(bodyParser.json());

// ─── Logger silencieux (évite les logs trop verbeux sur Alwaysdata) ───────────
const logger = pino({ level: 'silent' });

// ─── État global ──────────────────────────────────────────────────────────────
let sock        = null;
let isConnected = false;
let qrDataUrl   = null;
let qrString    = null;
let isInitializing = false;

// ─── Dossier de session ───────────────────────────────────────────────────────
const SESSION_DIR = path.join(__dirname, 'whatsapp_session');
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// ─── Chargement dynamique de Baileys (ESM dans CJS) ──────────────────────────
async function loadBaileys() {
    const baileys = await import('@whiskeysockets/baileys');
    return baileys;
}

// ─── Initialisation WhatsApp ──────────────────────────────────────────────────
async function initWhatsApp() {
    if (isInitializing) return;
    isInitializing = true;

    console.log('Initialisation WhatsApp...');

    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            DisconnectReason,
            fetchLatestBaileysVersion,
            makeInMemoryStore,
        } = await loadBaileys();

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const { version } = await fetchLatestBaileysVersion();

        console.log(`Baileys version WhatsApp: ${version.join('.')}`);

        sock = makeWASocket({
            version,
            auth:               state,
            logger:             logger,
            printQRInTerminal:  true,
            browser:            ['WhatsApp Gateway', 'Chrome', '1.0.0'],
            connectTimeoutMs:   60000,
            keepAliveIntervalMs: 30000,
        });

        // ── Événement : QR Code ───────────────────────────────────────────────
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrString = qr;
                console.log('\n========================================');
                console.log('📱 QR CODE DISPONIBLE');
                console.log('Ouvrez : http://votre-domaine/');
                console.log('========================================\n');

                try {
                    qrDataUrl = await QRCode.toDataURL(qr);
                } catch (e) {
                    console.error('Erreur génération QR:', e.message);
                }
            }

            if (connection === 'close') {
                isConnected    = false;
                isInitializing = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== 401; // 401 = déconnecté volontairement

                console.log(`Connexion fermée (code: ${statusCode}). Reconnexion: ${shouldReconnect}`);

                if (shouldReconnect) {
                    setTimeout(() => initWhatsApp(), 5000);
                } else {
                    // Session invalide, supprimer et recommencer
                    console.log('Session invalide, suppression...');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                    setTimeout(() => initWhatsApp(), 3000);
                }
            }

            if (connection === 'open') {
                isConnected    = true;
                isInitializing = false;
                qrDataUrl      = null;
                qrString       = null;
                console.log('WhatsApp connecté ! Prêt à envoyer des messages.');
            }
        });

        // ── Sauvegarder les credentials ───────────────────────────────────────
        sock.ev.on('creds.update', saveCreds);

    } catch (e) {
        console.error('Erreur initialisation:', e.message);
        isInitializing = false;
        setTimeout(() => initWhatsApp(), 8000);
    }
}

// ─── Formater le numéro WhatsApp ──────────────────────────────────────────────
function formatNumber(phone) {
    let number = String(phone).replace(/[\s\-()]/g, '');

    if (number.startsWith('+')) number = number.substring(1);
    if (number.startsWith('00')) number = number.substring(2);

    // Ajouter indicatif Bénin si numéro local (8 chiffres)
    if (number.length === 8) number = '229' + number;

    return number + '@s.whatsapp.net';
}

// ─── Middleware authentification ──────────────────────────────────────────────
function authenticate(req, res, next) {
    const secret = req.headers['x-api-secret'];
    if (!secret || secret !== API_SECRET) {
        return res.status(401).json({ success: false, message: 'Non autorisé' });
    }
    next();
}

// ─── Envoyer un message ───────────────────────────────────────────────────────
async function sendWhatsAppMessage(phone, message) {
    if (!isConnected || !sock) {
        throw new Error('WhatsApp non connecté');
    }
    const jid = formatNumber(phone);
    await sock.sendMessage(jid, { text: message });
}


app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WhatsApp Gateway ${isConnected ? '' : ''}</title>
    <meta http-equiv="refresh" content="4">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f0f2f5;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 20px;
            padding: 40px;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 4px 24px rgba(0,0,0,.08);
            text-align: center;
        }
        .logo { font-size: 48px; margin-bottom: 16px; }
        h1 { font-size: 22px; color: #111; margin-bottom: 8px; }
        .subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
        .badge {
            display: inline-block;
            padding: 8px 20px;
            border-radius: 100px;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 24px;
        }
        .badge.ok   { background: #d1fae5; color: #065f46; }
        .badge.wait { background: #fef3c7; color: #92400e; }
        .badge.init { background: #dbeafe; color: #1e40af; }
        .qr-wrap { margin: 20px 0; }
        .qr-wrap img { max-width: 280px; width: 100%; border-radius: 12px; border: 1px solid #eee; }
        .instructions {
            background: #f8fafc;
            border-radius: 12px;
            padding: 16px;
            text-align: left;
            font-size: 13px;
            color: #444;
            line-height: 1.8;
        }
        .instructions strong { color: #111; }
        .refresh { color: #aaa; font-size: 12px; margin-top: 20px; }
        .sender { background: #f0fdf4; border-radius: 8px; padding: 10px; font-size: 13px; color: #166534; margin-top: 16px; }
    </style>
</head>
<body>
<div class="card">
    <div class="logo">📱</div>
    <h1>WhatsApp Gateway</h1>
    <div class="subtitle">Notifications automatiques RDV</div>

    ${isConnected ? `
        <div class="badge ok">Connecté — Prêt à envoyer</div>
        <div class="sender">📞 Expéditeur : <strong>+2290194119476</strong></div>
    ` : qrDataUrl ? `
        <div class="badge wait">Scannez le QR Code</div>
        <div class="qr-wrap">
            <img src="${qrDataUrl}" alt="QR Code WhatsApp">
        </div>
        <div class="instructions">
            <strong>Comment scanner :</strong><br>
            1. Ouvrez WhatsApp sur le téléphone<br>
            2. Allez dans <strong>Paramètres</strong><br>
            3. Appuyez sur <strong>Appareils liés</strong><br>
            4. Appuyez sur <strong>Lier un appareil</strong><br>
            5. Scannez ce QR code
        </div>
    ` : `
        <div class="badge init">Initialisation en cours...</div>
        <p style="color:#888;font-size:14px;margin-top:16px">Démarrage du service WhatsApp...</p>
    `}

    <p class="refresh">Page se rafraîchit automatiquement toutes les 4 secondes</p>
</div>
</body>
</html>`);
});

// ── Statut ────────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
    res.json({
        success:  true,
        ready:    isConnected,
        has_qr:   qrDataUrl !== null,
        service:  'WhatsApp Gateway v2 (Baileys)',
        sender:   '+2290194119476',
    });
});

// ── Envoyer un message simple ─────────────────────────────────────────────────
app.post('/send', authenticate, async (req, res) => {
    const { phone, message } = req.body;

    if (!isConnected) {
        return res.status(503).json({
            success: false,
            message: 'WhatsApp non connecté. Scannez le QR sur la page d\'accueil.',
        });
    }
    if (!phone || !message) {
        return res.status(400).json({ success: false, message: 'phone et message requis' });
    }

    try {
        await sendWhatsAppMessage(phone, message);
        console.log(`Message envoyé à ${phone}`);
        res.json({ success: true, message: 'Message envoyé', to: phone });
    } catch (e) {
        console.error(`Erreur envoi à ${phone}:`, e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── Envoi en masse ────────────────────────────────────────────────────────────
app.post('/send-bulk', authenticate, async (req, res) => {
    const { recipients } = req.body;

    if (!isConnected) {
        return res.status(503).json({ success: false, message: 'WhatsApp non connecté' });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ success: false, message: 'recipients requis (tableau)' });
    }

    const results = [];
    for (const { phone, message } of recipients) {
        try {
            await sendWhatsAppMessage(phone, message);
            results.push({ phone, success: true });
            await new Promise(r => setTimeout(r, 1000)); // anti-spam
        } catch (e) {
            results.push({ phone, success: false, error: e.message });
        }
    }

    res.json({
        success: true,
        sent:    results.filter(r => r.success).length,
        failed:  results.filter(r => !r.success).length,
        results,
    });
});

// ── Notification RDV ──────────────────────────────────────────────────────────
app.post('/send-rdv', authenticate, async (req, res) => {
    const { rdv, event, recipients } = req.body;

    if (!isConnected) {
        return res.status(503).json({ success: false, message: 'WhatsApp non connecté' });
    }

    const messages = buildRdvMessages(rdv, event, recipients);
    const results  = [];

    for (const { phone, message } of messages) {
        try {
            await sendWhatsAppMessage(phone, message);
            results.push({ phone, success: true });
            await new Promise(r => setTimeout(r, 800));
        } catch (e) {
            results.push({ phone, success: false, error: e.message });
        }
    }

    res.json({ success: true, results });
});

// ─── Construction des messages RDV ────────────────────────────────────────────
function buildRdvMessages(rdv, event, recipients) {
    const messages = [];
    const dateStr  = formatDate(rdv.date);
    const timeStr  = `${rdv.start_time} - ${rdv.end_time}`;

    for (const recipient of recipients) {
        let text = '';

        if (event === 'pending') {
            if (recipient.role === 'prestataire') {
                text = `*Nouvelle demande de RDV*\n\n`
                     + `Client : *${rdv.client_name}*\n`
                     + `Service : *${rdv.service_name}*\n`
                     + `Date : *${dateStr}*\n`
                     + `Heure : *${timeStr}*\n`
                     + (rdv.client_notes ? `Note : ${rdv.client_notes}\n` : '')
                     + `\nConfirmez ou annulez via l'application.`;
            } else {
                text = `*Demande de RDV envoyée !*\n\n`
                     + `Service : *${rdv.service_name}*\n`
                     + `Entreprise : *${rdv.entreprise_name}*\n`
                     + `Date : *${dateStr}*\n`
                     + `Heure : *${timeStr}*\n\n`
                     + `En attente de confirmation du prestataire.`;
            }
        } else if (event === 'confirmed') {
            text = `*RDV Confirmé !*\n\n`
                 + `Service : *${rdv.service_name}*\n`
                 + `Entreprise : *${rdv.entreprise_name}*\n`
                 + `Date : *${dateStr}*\n`
                 + `Heure : *${timeStr}*\n\n`
                 + `Rendez-vous confirmé. À bientôt !`;
        } else if (event === 'cancelled') {
            text = `*RDV Annulé*\n\n`
                 + `Service : *${rdv.service_name}*\n`
                 + `Date : *${dateStr}*\n`
                 + `Heure : *${timeStr}*\n`
                 + (rdv.cancel_reason ? `Raison : ${rdv.cancel_reason}\n` : '')
                 + `\nVous pouvez reprendre un nouveau RDV via l'application.`;
        } else if (event === 'completed') {
            text = `*RDV Terminé — Merci !*\n\n`
                 + `Service : *${rdv.service_name}*\n`
                 + `Date : *${dateStr}*\n\n`
                 + `N'hésitez pas à laisser un avis sur l'application.`;
        } else if (event === 'reminder') {
            text = `*Rappel RDV — Demain !*\n\n`
                 + `Service : *${rdv.service_name}*\n`
                 + `Entreprise : *${rdv.entreprise_name}*\n`
                 + `Date : *${dateStr}*\n`
                 + `Heure : *${timeStr}*\n\n`
                 + `N'oubliez pas votre rendez-vous de demain !`;
        }

        if (text && recipient.phone) {
            messages.push({ phone: recipient.phone, message: text });
        }
    }

    return messages;
}

function formatDate(dateStr) {
    const days   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const months = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
    const d      = new Date(dateStr);
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Démarrage ────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
    console.log('\n========================================');
    console.log(`WhatsApp Gateway v2 démarré sur :${PORT}`);
    console.log(`Interface QR : http://localhost:${PORT}`);
    console.log('========================================\n');

    // Initialiser WhatsApp après démarrage du serveur
    setTimeout(() => initWhatsApp(), 1000);
});