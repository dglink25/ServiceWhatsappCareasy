const express    = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode     = require('qrcode-terminal');
const QRCode     = require('qrcode');
const bodyParser = require('body-parser');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Clé secrète partagée avec Laravel (à mettre dans .env des deux côtés) ───
const API_SECRET = process.env.WHATSAPP_API_SECRET || 'change-this-secret-key-in-production';

app.use(bodyParser.json());

// ─── État du client WhatsApp ──────────────────────────────────────────────────
let clientReady = false;
let qrDataUrl   = null;
let qrString    = null;

// ─── Initialisation du client WhatsApp ───────────────────────────────────────
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './whatsapp_session'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

client.on('qr', async (qr) => {
    qrString = qr;
    console.log('\n========================================');
    console.log('📱 SCANNEZ CE QR CODE AVEC WHATSAPP');
    console.log('========================================\n');
    qrcode.generate(qr, { small: true });
    
    // Générer aussi le QR en base64 pour l'interface web
    try {
        qrDataUrl = await QRCode.toDataURL(qr);
    } catch (e) {
        console.error('Erreur génération QR base64:', e.message);
    }
});

client.on('ready', () => {
    clientReady = true;
    qrDataUrl   = null;
    qrString    = null;
    console.log('\n✅ WhatsApp connecté ! Prêt à envoyer des messages.');
    console.log(`🚀 Service disponible sur http://localhost:${PORT}`);
});

client.on('authenticated', () => {
    console.log('🔐 Session WhatsApp authentifiée.');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Échec authentification WhatsApp:', msg);
    clientReady = false;
});

client.on('disconnected', (reason) => {
    console.log('⚠️  WhatsApp déconnecté:', reason);
    clientReady = false;
    // Reconnexion automatique après 5 secondes
    setTimeout(() => {
        console.log('🔄 Tentative de reconnexion...');
        client.initialize();
    }, 5000);
});

client.initialize();

// ─── Middleware d'authentification ────────────────────────────────────────────
function authenticate(req, res, next) {
    const authHeader = req.headers['x-api-secret'];
    if (!authHeader || authHeader !== API_SECRET) {
        return res.status(401).json({ success: false, message: 'Non autorisé' });
    }
    next();
}

// ─── Formater le numéro WhatsApp ──────────────────────────────────────────────
function formatWhatsAppNumber(phone) {
    // Supprimer tous les caractères non numériques sauf +
    let number = phone.replace(/[\s\-()]/g, '');
    
    // Supprimer le + au début
    if (number.startsWith('+')) {
        number = number.substring(1);
    }
    
    // Si commence par 00, remplacer par rien (ex: 00229 -> 229)
    if (number.startsWith('00')) {
        number = number.substring(2);
    }
    
    // Ajouter l'indicatif Bénin si numéro local (8 chiffres)
    if (number.length === 8) {
        number = '229' + number;
    }
    
    return number + '@c.us';
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Statut du service
app.get('/status', (req, res) => {
    res.json({
        success:      true,
        ready:        clientReady,
        has_qr:       qrDataUrl !== null,
        service:      'WhatsApp Gateway',
        version:      '1.0.0',
        sender:       '+22994119476'
    });
});

// QR Code pour la connexion initiale (interface web)
app.get('/qr', (req, res) => {
    if (clientReady) {
        return res.json({ success: true, connected: true, message: 'Déjà connecté' });
    }
    if (!qrDataUrl) {
        return res.json({ success: false, message: 'QR code pas encore disponible, patientez...' });
    }
    res.json({ success: true, qr: qrDataUrl, connected: false });
});

// Page HTML pour scanner le QR
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Gateway - ${clientReady ? 'Connecté' : 'En attente'}</title>
        <meta charset="utf-8">
        <meta http-equiv="refresh" content="5">
        <style>
            body { font-family: Arial; text-align: center; padding: 40px; background: #f0f0f0; }
            .card { background: white; padding: 40px; border-radius: 16px; max-width: 400px; margin: auto; box-shadow: 0 4px 20px rgba(0,0,0,.1); }
            .status { font-size: 18px; font-weight: bold; padding: 10px 20px; border-radius: 8px; }
            .ok  { background: #d1fae5; color: #065f46; }
            .wait{ background: #fef3c7; color: #92400e; }
            img  { max-width: 300px; margin: 20px auto; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>📱 WhatsApp Gateway</h2>
            ${clientReady
                ? '<div class="status ok">Connecté — Prêt à envoyer</div>'
                : qrDataUrl
                    ? `<div class="status wait">⏳ Scannez le QR avec WhatsApp</div><img src="${qrDataUrl}" alt="QR Code"><p>Ouvrez WhatsApp → Appareils liés → Lier un appareil</p>`
                    : '<div class="status wait">⏳ Initialisation en cours...</div>'
            }
            <p style="color:#888;font-size:13px">Page se rafraîchit toutes les 5 secondes</p>
        </div>
    </body>
    </html>
    `);
});

// ─── Envoyer un message simple ────────────────────────────────────────────────
app.post('/send', authenticate, async (req, res) => {
    const { phone, message } = req.body;

    if (!clientReady) {
        return res.status(503).json({
            success: false,
            message: 'WhatsApp non connecté. Scannez le QR sur http://localhost:' + PORT
        });
    }

    if (!phone || !message) {
        return res.status(400).json({ success: false, message: 'phone et message requis' });
    }

    try {
        const chatId = formatWhatsAppNumber(phone);
        await client.sendMessage(chatId, message);
        
        console.log(`Message envoyé à ${phone}`);
        res.json({ success: true, message: 'Message envoyé', to: phone });
    } catch (e) {
        console.error(`Erreur envoi à ${phone}:`, e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── Envoyer à plusieurs destinataires (bulk) ─────────────────────────────────
app.post('/send-bulk', authenticate, async (req, res) => {
    const { recipients } = req.body;
    // recipients = [{ phone: '...', message: '...' }, ...]

    if (!clientReady) {
        return res.status(503).json({ success: false, message: 'WhatsApp non connecté' });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ success: false, message: 'recipients requis (tableau)' });
    }

    const results = [];

    for (const recipient of recipients) {
        const { phone, message } = recipient;
        if (!phone || !message) {
            results.push({ phone, success: false, error: 'phone ou message manquant' });
            continue;
        }

        try {
            const chatId = formatWhatsAppNumber(phone);
            await client.sendMessage(chatId, message);
            results.push({ phone, success: true });
            console.log(`Bulk: envoyé à ${phone}`);
            
            // Délai anti-spam (1 seconde entre chaque message)
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            results.push({ phone, success: false, error: e.message });
            console.error(`Bulk: erreur pour ${phone}:`, e.message);
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        success: true,
        sent: successCount,
        failed: results.length - successCount,
        results
    });
});

// ─── Envoyer notification RDV spécifique ─────────────────────────────────────
app.post('/send-rdv', authenticate, async (req, res) => {
    const { rdv, event, recipients } = req.body;
    // event: 'pending' | 'confirmed' | 'cancelled' | 'completed'
    // recipients: [{ phone, name, role }]  role: 'client' | 'prestataire'

    if (!clientReady) {
        return res.status(503).json({ success: false, message: 'WhatsApp non connecté' });
    }

    const messages = buildRdvMessages(rdv, event, recipients);
    const results  = [];

    for (const { phone, message } of messages) {
        try {
            const chatId = formatWhatsAppNumber(phone);
            await client.sendMessage(chatId, message);
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
                 + `📍 Rendez-vous confirmé. À bientôt !`;
        } else if (event === 'cancelled') {
            text = `*RDV Annulé*\n\n`
                 + `Service : *${rdv.service_name}*\n`
                 + `Date : *${dateStr}*\n`
                 + `Heure : *${timeStr}*\n`
                 + (rdv.cancel_reason ? `Raison : ${rdv.cancel_reason}\n` : '')
                 + `\nVous pouvez reprendre un nouveau rendez-vous via l'application.`;
        } else if (event === 'completed') {
            text = `*RDV Terminé*\n\n`
                 + `Merci pour votre confiance !\n\n`
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

// ─── Démarrage serveur ────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log(`WhatsApp Gateway démarré sur :${PORT}`);
    console.log(`Interface QR : http://localhost:${PORT}`);
    console.log('========================================\n');
});