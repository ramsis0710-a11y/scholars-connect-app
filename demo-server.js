require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'scholars_secret_key_2026';

const ai = new GoogleGenAI();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dbFile = path.join(__dirname, 'scholars.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Erreur d\'ouverture de la base de données', err.message);
  } else {
    console.log('Connecté à la base de données SQLite.');
    initDb();
  }
});

function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'visitor'
    )`, () => {
      const adminEmail = 'admin@scholars.com';
      db.get(`SELECT * FROM users WHERE email = ?`, [adminEmail], async (err, row) => {
        if (!row) {
          const hashedPassword = await bcrypt.hash('admin123', 10);
          db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
            ['Administrateur', adminEmail, hashedPassword, 'admin']);
          console.log('Compte Administrateur par défaut créé : admin@scholars.com / admin123');
        }
      });
    });
  });
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Scholars Connect - Plateforme Académique</title>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
        <style>
            :root { --primary: #2563eb; --admin-color: #dc2626; --bg: #f8fafc; --text: #1e293b; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 0; }
            header { background: white; padding: 1rem 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
            .logo-area { display: flex; align-items: center; gap: 10px; font-weight: bold; font-size: 1.2rem; color: var(--primary); }
            .logo-area img { width: 40px; height: 40px; border-radius: 8px; }
            .nav-links { display: flex; gap: 15px; align-items: center; flex-wrap: wrap; }
            .nav-links a { text-decoration: none; padding: 8px 14px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; transition: background 0.2s; cursor: pointer; }
            .link-visitor { background: #e0f2fe; color: #0369a1; }
            .link-visitor:hover { background: #bae6fd; }
            .link-admin-toggle { background: #f1f5f9; color: #64748b; font-size: 0.8rem; }
            .container { max-width: 900px; margin: 2rem auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            h1 { color: var(--primary); margin-top: 0; }
            .card { background: #f1f5f9; padding: 1.5rem; border-radius: 8px; margin-top: 1.5rem; }
            input, textarea, select { width: 100%; padding: 10px; margin: 8px 0 15px 0; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
            button { background: var(--primary); color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-right: 5px; margin-top: 5px; }
            button:hover { opacity: 0.9; }
            .btn-secondary { background: #0ea5e9; }
            .btn-success { background: #16a34a; }
            .share-box { text-align: center; margin-top: 2rem; padding: 1.5rem; background: #eff6ff; border-radius: 8px; }
            #qrcode { display: inline-block; margin-top: 10px; background: white; padding: 10px; border-radius: 6px; }
            .links-display { background: #e2e8f0; padding: 10px; border-radius: 6px; margin-bottom: 15px; font-size: 0.9rem; }
        </style>
    </head>
    <body>
        <header>
            <div class="logo-area">
                <img src="https://api.iconify.design/fluent-emoji-flat:mortar-board.svg" alt="Logo Scholars">
                <span>Scholars Connect</span>
            </div>
            <div class="nav-links">
                <a class="link-visitor" href="#" onclick="setMode('visitor')">🌍 Mode Visiteur</a>
                <a class="link-admin-toggle" href="#" onclick="toggleAdminPanel()">⚙️ Espace Admin</a>
            </div>
        </header>

        <div class="container">
            <h1>Bienvenue sur Scholars Connect</h1>
            <p>Plateforme multilingue d'entraide académique et d'assistance intelligente vocale.</p>

            <div class="links-display">
                <strong>🔗 Liens d'accès rapides :</strong><br>
                • <a href="#" id="link-v-url" onclick="setMode('visitor'); return false;">Lien Visiteur</a><br>
                • <a href="#" id="link-a-url" onclick="toggleAdminPanel(); return false;">Lien Administrateur</a>
            </div>

            <!-- Panneau Admin Caché par défaut pour les visiteurs -->
            <div class="card" id="admin-panel" style="display: none; border: 2px dashed var(--admin-color);">
                <h3 style="color: var(--admin-color);">🔐 Connexion Espace Administrateur</h3>
                <form id="loginForm" onsubmit="handleLogin(event)">
                    <label>Email :</label>
                    <input type="email" id="email" placeholder="admin@scholars.com">
                    <label>Mot de passe :</label>
                    <input type="password" id="password" placeholder="admin123">
                    <button type="submit" style="background: var(--admin-color);">Se connecter (Admin Auto)</button>
                </form>
                <p id="auth-status" style="margin-top: 10px; font-weight: bold;"></p>
            </div>

            <div class="card">
                <h3>🤖 Assistant IA Gemini (Vocale & Texte)</h3>
                <textarea id="aiPrompt" placeholder="Tapez votre question ou utilisez le micro..."></textarea>
                
                <div>
                    <button class="btn-secondary" onclick="startVoiceInput()">🎤 Parler (Saisie Vocale)</button>
                    <button class="btn-success" onclick="confirmAndSendAI()">✅ Confirmer la fin des questions</button>
                </div>

                <div id="timer-display" style="font-weight: bold; color: #ca8a04; margin-top: 8px;"></div>
                <div id="aiResponse" style="margin-top: 15px; white-space: pre-wrap; background: white; padding: 15px; border-radius: 6px; border: 1px solid #cbd5e1;"></div>
                <button onclick="speakResponse()" style="background: #475569; margin-top: 10px;">🔊 Écouter la réponse</button>
            </div>

            <div class="share-box">
                <h3>📱 Partager l'Application (Logo & QR Code)</h3>
                <p>Scannez ce QR code ou partagez l'URL officielle :</p>
                <div id="qrcode"></div>
                <p style="font-size: 0.85rem; color: #64748b; margin-top: 8px;" id="current-url"></p>
            </div>
        </div>

        <script>
            const currentUrl = window.location.href.split('#')[0];
            document.getElementById('current-url').innerText = currentUrl;
            document.getElementById('link-v-url').innerText = currentUrl;
            document.getElementById('link-a-url').innerText = currentUrl + '#admin';

            QRCode.toCanvas(document.getElementById('qrcode'), currentUrl, { width: 140 }, function (error) {
                if (error) console.error(error);
            });

            if(window.location.hash === '#admin') {
                toggleAdminPanel();
            }

            function setMode(mode) {
                alert('Mode Visiteur activé.');
                document.getElementById('admin-panel').style.display = 'none';
            }

            function toggleAdminPanel() {
                const panel = document.getElementById('admin-panel');
                if (panel.style.display === 'none') {
                    panel.style.display = 'block';
                    document.getElementById('email').value = 'admin@scholars.com';
                    document.getElementById('password').value = 'admin123';
                } else {
                    panel.style.display = 'none';
                }
            }

            async function handleLogin(event) {
                event.preventDefault();
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;

                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                const statusEl = document.getElementById('auth-status');
                if (res.ok) {
                    statusEl.innerText = '✅ Connecté en tant que ' + data.user.role.toUpperCase();
                    statusEl.style.color = 'green';
                } else {
                    statusEl.innerText = '❌ Erreur : ' + data.error;
                    statusEl.style.color = 'red';
                }
            }

            // Gestion de la Saisie Vocale (Speech-to-Text)
            function startVoiceInput() {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SpeechRecognition) {
                    alert("La reconnaissance vocale n'est pas supportée par votre navigateur. Utilisez Google Chrome.");
                    return;
                }
                const recognition = new SpeechRecognition();
                recognition.lang = 'fr-FR';
                recognition.interimResults = false;
                
                recognition.onstart = () => {
                    document.getElementById('aiPrompt').placeholder = "Écoute en cours... Parlez maintenant.";
                };

                recognition.onresult = (event) => {
                    const speechToText = event.results[0][0].transcript;
                    document.getElementById('aiPrompt').value = speechToText;
                };

                recognition.onerror = () => {
                    alert("Erreur lors de la capture vocale.");
                };

                recognition.start();
            }

            // Minuteur de 7 secondes et Bouton de confirmation
            let countdownInterval;
            function confirmAndSendAI() {
                let timeLeft = 7;
                const timerEl = document.getElementById('timer-display');
                clearInterval(countdownInterval);

                timerEl.innerText = "⏳ Envoi programmé dans " + timeLeft + " secondes... (Cliquez à nouveau pour annuler ou patientez)";
                
                countdownInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        timerEl.innerText = "⏳ Envoi programmé dans " + timeLeft + " secondes...";
                    } else {
                        clearInterval(countdownInterval);
                        timerEl.innerText = "🚀 Envoi de la question en cours...";
                        askAI();
                    }
                }, 1000);
            }

            async function askAI() {
                document.getElementById('timer-display').innerText = "";
                const prompt = document.getElementById('aiPrompt').value;
                const responseDiv = document.getElementById('aiResponse');
                responseDiv.innerText = 'Réflexion de l’IA en cours...';
                
                try {
                    const res = await fetch('/api/ai', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt })
                    });
                    const data = await res.json();
                    responseDiv.innerText = data.answer || data.error;
                } catch (e) {
                    responseDiv.innerText = 'Erreur de communication avec l’IA.';
                }
            }

            // Synthèse Vocale (Text-to-Speech)
            function speakResponse() {
                const text = document.getElementById('aiResponse').innerText;
                if (!text) return;
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'fr-FR';
                window.speechSynthesis.speak(utterance);
            }
        </script>
    </body>
    </html>
  `);
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé.' });
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Mot de passe incorrect.' });
    }
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Connexion réussie', token, user: { name: user.name, email: user.email, role: user.role } });
  });
});

app.post('/api/ai', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt requis.' });
  }
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    res.json({ answer: response.text });
  } catch (error) {
    console.error('Erreur IA Gemini:', error);
    res.status(500).json({ error: 'Erreur lors de la génération avec l’IA.' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
