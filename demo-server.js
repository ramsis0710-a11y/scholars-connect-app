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

    db.run(`CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// 1. Interface Publique / Visiteur (Aucun lien admin visible)
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
            :root { --primary: #2563eb; --bg: #f8fafc; --text: #1e293b; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 0; }
            header { background: white; padding: 1rem 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; }
            .logo-area { display: flex; align-items: center; gap: 10px; font-weight: bold; font-size: 1.2rem; color: var(--primary); }
            .logo-area img { width: 40px; height: 40px; border-radius: 8px; }
            .container { max-width: 900px; margin: 2rem auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            h1 { color: var(--primary); margin-top: 0; }
            .card { background: #f1f5f9; padding: 1.5rem; border-radius: 8px; margin-top: 1.5rem; }
            textarea { width: 100%; padding: 10px; margin: 8px 0 15px 0; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
            button { background: var(--primary); color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-right: 5px; margin-top: 5px; }
            button:hover { opacity: 0.9; }
            .btn-secondary { background: #0ea5e9; }
            .btn-success { background: #16a34a; }
            .share-box { text-align: center; margin-top: 2rem; padding: 1.5rem; background: #eff6ff; border-radius: 8px; }
            #qrcode { display: inline-block; margin-top: 10px; background: white; padding: 10px; border-radius: 6px; }
        </style>
    </head>
    <body>
        <header>
            <div class="logo-area">
                <img src="https://api.iconify.design/fluent-emoji-flat:mortar-board.svg" alt="Logo Scholars">
                <span>Scholars Connect (Espace Public)</span>
            </div>
        </header>

        <div class="container">
            <h1>Bienvenue sur Scholars Connect</h1>
            <p>Plateforme multilingue d'entraide académique et d'assistance intelligente vocale.</p>

            <div class="card">
                <h3>🤖 Assistant IA Gemini (Vocale & Texte)</h3>
                <textarea id="aiPrompt" rows="3" placeholder="Tapez votre question ou utilisez le micro..."></textarea>
                
                <div>
                    <button class="btn-secondary" onclick="startVoiceInput()">🎤 Parler (Saisie Vocale)</button>
                    <button class="btn-success" onclick="confirmAndSendAI()">✅ Confirmer la fin des questions (7s)</button>
                </div>

                <div id="timer-display" style="font-weight: bold; color: #ca8a04; margin-top: 8px;"></div>
                <div id="aiResponse" style="margin-top: 15px; white-space: pre-wrap; background: white; padding: 15px; border-radius: 6px; border: 1px solid #cbd5e1;"></div>
                <button onclick="speakResponse()" style="background: #475569; margin-top: 10px;">🔊 Écouter la réponse</button>
            </div>

            <div class="share-box">
                <h3>📱 Partager cette application Visiteur</h3>
                <div id="qrcode"></div>
                <p style="font-size: 0.85rem; color: #64748b; margin-top: 8px;" id="current-url"></p>
            </div>
        </div>

        <script>
            const currentUrl = window.location.href;
            document.getElementById('current-url').innerText = currentUrl;
            QRCode.toCanvas(document.getElementById('qrcode'), currentUrl, { width: 140 }, function (error) {
                if (error) console.error(error);
            });

            function startVoiceInput() {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SpeechRecognition) {
                    alert("Non supporté par votre navigateur. Utilisez Google Chrome.");
                    return;
                }
                const recognition = new SpeechRecognition();
                recognition.lang = 'fr-FR';
                recognition.onresult = (event) => {
                    document.getElementById('aiPrompt').value = event.results[0][0].transcript;
                };
                recognition.start();
            }

            let countdownInterval;
            function confirmAndSendAI() {
                let timeLeft = 7;
                const timerEl = document.getElementById('timer-display');
                clearInterval(countdownInterval);
                timerEl.innerText = "⏳ Envoi programmé dans " + timeLeft + " secondes...";
                
                countdownInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        timerEl.innerText = "⏳ Envoi programmé dans " + timeLeft + " secondes...";
                    } else {
                        clearInterval(countdownInterval);
                        timerEl.innerText = "🚀 Envoi en cours...";
                        askAI();
                    }
                }, 1000);
            }

            async function askAI() {
                document.getElementById('timer-display').innerText = "";
                const prompt = document.getElementById('aiPrompt').value;
                const responseDiv = document.getElementById('aiResponse');
                responseDiv.innerText = 'Réflexion de l’IA en cours...';
                
                const res = await fetch('/api/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt })
                });
                const data = await res.json();
                responseDiv.innerText = data.answer || data.error;
            }

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

// 2. Interface Tableau de Bord Administrateur Secret avec tous les indicateurs
app.get('/admin-secret-dashboard', (req, res) => {
  db.all(`SELECT COUNT(*) as total_users FROM users`, [], (err, userRows) => {
    db.all(`SELECT * FROM users`, [], (err, users) => {
      res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Tableau de Bord Administrateur - Scholars Connect</title>
            <style>
                :root { --admin-primary: #dc2626; --bg: #f8fafc; --text: #1e293b; }
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2rem; }
                .dashboard-container { max-width: 1100px; margin: 0 auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                h1 { color: var(--admin-primary); margin-top: 0; display: flex; align-items: center; gap: 10px; }
                .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; }
                .metric-card { background: #fee2e2; border-left: 5px solid var(--admin-primary); padding: 1.5rem; border-radius: 8px; }
                .metric-card h3 { margin: 0; color: #991b1b; font-size: 0.9rem; text-transform: uppercase; }
                .metric-card .value { font-size: 2rem; font-weight: bold; margin-top: 10px; color: #7f1d1d; }
                .section { margin-top: 2.5rem; }
                table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #cbd5e1; }
                th { background: #f1f5f9; color: #334155; }
                .btn-back { display: inline-block; margin-bottom: 1rem; text-decoration: none; background: #475569; color: white; padding: 8px 14px; border-radius: 6px; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="dashboard-container">
                <a class="btn-back" href="/">⬅️ Retourner au site public</a>
                <h1>⚙️ Tableau de Bord Administrateur</h1>
                <p>Panneau de contrôle global, indicateurs de performance et gestion de la plateforme.</p>

                <div class="metrics-grid">
                    <div class="metric-card">
                        <h3>Utilisateurs Inscrits</h3>
                        <div class="value">${userRows[0].total_users}</div>
                    </div>
                    <div class="metric-card">
                        <h3>État du Système</h3>
                        <div class="value" style="font-size: 1.2rem; color: #16a34a; margin-top: 15px;">🟢 En Ligne (Render)</div>
                    </div>
                    <div class="metric-card">
                        <h3>Modèle IA Actif</h3>
                        <div class="value" style="font-size: 1.2rem; margin-top: 15px;">Gemini 2.5 Flash</div>
                    </div>
                </div>

                <div class="section">
                    <h3>👥 Liste des Utilisateurs & Rôles</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Nom</th>
                                <th>Email</th>
                                <th>Rôle</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(u => `
                                <tr>
                                    <td>${u.id}</td>
                                    <td>${u.name}</td>
                                    <td>${u.email}</td>
                                    <td><strong>${u.role.toUpperCase()}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div class="section" style="background: #f1f5f9; padding: 1.5rem; border-radius: 8px;">
                    <h3>🔗 Liens Officiels de la Plateforme</h3>
                    <p><strong>🌍 Lien Visiteur (À partager partout) :</strong> <br><code>https://scholars-connect-app-1.onrender.com/</code></p>
                    <p><strong>🔐 Lien Administrateur Secret (Ne pas partager) :</strong> <br><code>https://scholars-connect-app-1.onrender.com/admin-secret-dashboard</code></p>
                </div>
            </div>
        </body>
        </html>
      `);
    });
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
