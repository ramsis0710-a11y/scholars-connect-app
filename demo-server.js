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

    db.run(`CREATE TABLE IF NOT EXISTS visitor_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_name TEXT,
      visitor_email TEXT,
      login_time DATETIME,
      logout_time DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS visitor_qa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_email TEXT,
      question TEXT,
      answer TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// 1. Interface Publique / Visiteur (Authentification, 20+ Domaines, 12+ Langues, Dictée multi-questions, Traduction & Partage)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Scholars Connect - Plateforme Académique Internationale</title>
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
            textarea, input, select { width: 100%; padding: 10px; margin: 8px 0 15px 0; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
            button { background: var(--primary); color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-right: 5px; margin-top: 5px; }
            button:hover { opacity: 0.9; }
            .btn-secondary { background: #0ea5e9; }
            .btn-success { background: #16a34a; }
            .btn-warning { background: #d97706; }
            .share-box { text-align: center; margin-top: 2rem; padding: 1.5rem; background: #eff6ff; border-radius: 8px; }
            #qrcode { display: inline-block; margin-top: 10px; background: white; padding: 10px; border-radius: 6px; }
        </style>
    </head>
    <body onunload="handleVisitorLogout()">
        <header>
            <div class="logo-area">
                <img src="https://api.iconify.design/fluent-emoji-flat:mortar-board.svg" alt="Logo Scholars">
                <span>Scholars Connect (Espace Public Multilingue)</span>
            </div>
        </header>

        <div class="container">
            <h1>Bienvenue sur Scholars Connect</h1>
            <p>Plateforme multilingue (12+ langues) d'entraide académique couvrant 20+ domaines, avec dictée vocale multi-questions et partage traduisible.</p>

            <div class="card" id="visitor-auth-card" style="border: 2px solid var(--primary);">
                <h3>👤 Identification Visiteur obligatoire</h3>
                <input type="text" id="vName" placeholder="Votre Nom">
                <input type="email" id="vEmail" placeholder="Votre Email (Login)">
                <input type="password" id="vPass" placeholder="Votre Mot de passe (MP)">
                <button onclick="registerVisitorLogin()">Se connecter en tant que Visiteur</button>
                <div id="v-status" style="margin-top: 8px; font-weight: bold;"></div>
            </div>

            <div class="card" id="main-app-content" style="display:none;">
                <h3>🤖 Assistant IA, Réseau de Scholars & Traduction (12+ Langues)</h3>
                
                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1;">
                        <label><strong>Domaine (20+ domaines) :</strong></label>
                        <select id="domainSelect">
                            <option value="Mathématiques">Mathématiques</option>
                            <option value="Physique-Chimie">Physique-Chimie</option>
                            <option value="Philosophie">Philosophie</option>
                            <option value="Religions & Théologie">Religions & Théologie</option>
                            <option value="Histoire">Histoire</option>
                            <option value="Géographie">Géographie</option>
                            <option value="Intelligence Artificielle">Intelligence Artificielle</option>
                            <option value="Informatique">Informatique</option>
                            <option value="Arts & Culture Générale">Arts & Culture Générale</option>
                            <option value="Restauration & Gastronomie">Restauration & Gastronomie</option>
                            <option value="Économie & Gestion">Économie & Gestion</option>
                            <option value="Droit">Droit</option>
                            <option value="Médecine & Santé">Médecine & Santé</option>
                            <option value="Littérature">Littérature</option>
                            <option value="Sociologie">Sociologie</option>
                            <option value="Psychologie">Psychologie</option>
                            <option value="Architecture">Architecture</option>
                            <option value="Environnement & Écologie">Environnement & Écologie</option>
                            <option value="Astronomie">Astronomie</option>
                            <option value="Musique">Musique</option>
                        </select>
                    </div>
                    <div style="flex: 1;">
                        <label><strong>Langue d'échange & Traduction (12+ langues) :</strong></label>
                        <select id="langSelect">
                            <option value="fr">Français</option>
                            <option value="ar">العربية (Arabe)</option>
                            <option value="en">English (Anglais)</option>
                            <option value="es">Español (Espagnol)</option>
                            <option value="de">Deutsch (Allemand)</option>
                            <option value="it">Italiano (Italien)</option>
                            <option value="pt">Português (Portugais)</option>
                            <option value="ru">Русский (Russe)</option>
                            <option value="zh">中文 (Chinois)</option>
                            <option value="ja">日本語 (Japonais)</option>
                            <option value="tr">Türkçe (Turc)</option>
                            <option value="hi">हिन्दी (Hindi)</option>
                        </select>
                    </div>
                </div>

                <label><strong>Vos questions (Dictée multi-questions en une seule fois ou saisie texte) :</strong></label>
                <textarea id="aiPrompt" rows="4" placeholder="Dictez ou tapez plusieurs questions d'affilée..."></textarea>
                
                <div>
                    <button class="btn-secondary" onclick="startMultiVoiceInput()">🎤 Dictée Multi-Questions Vocale</button>
                    <button class="btn-warning" onclick="translatePrompt()">🌐 Traduire le texte dans la langue choisie</button>
                    <button class="btn-success" onclick="confirmAndSendAI()">✅ Soumettre aux Scholars (7s)</button>
                </div>

                <div id="scholars-assigned" style="margin-top: 10px; font-style: italic; color: #475569;"></div>
                <div id="timer-display" style="font-weight: bold; color: #ca8a04; margin-top: 8px;"></div>
                
                <div id="aiResponse" style="margin-top: 15px; white-space: pre-wrap; background: white; padding: 15px; border-radius: 6px; border: 1px solid #cbd5e1;"></div>
                
                <div style="margin-top: 10px;">
                    <button onclick="speakResponse()" style="background: #475569;">🔊 Écouter la réponse (dans la langue choisie)</button>
                    <button class="btn-secondary" onclick="shareQA()">📤 Partager la Q/R traduite</button>
                </div>
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

            let currentVisitorEmail = '';

            async function registerVisitorLogin() {
                const name = document.getElementById('vName').value;
                const email = document.getElementById('vEmail').value;
                const password = document.getElementById('vPass').value;
                if(!name || !email || !password) {
                    alert('Veuillez remplir tous les champs.');
                    return;
                }
                currentVisitorEmail = email;
                const res = await fetch('/api/visitor-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });
                if(res.ok) {
                    document.getElementById('v-status').innerText = '✅ Session démarrée.';
                    document.getElementById('v-status').style.color = 'green';
                    document.getElementById('visitor-auth-card').style.opacity = '0.7';
                    document.getElementById('main-app-content').style.display = 'block';
                }
            }

            window.addEventListener('beforeunload', () => {
                if(currentVisitorEmail) {
                    navigator.sendBeacon('/api/visitor-logout', JSON.stringify({ email: currentVisitorEmail }));
                }
            });

            // Dictée multi-questions en une seule dictée continue
            let recognitionInstance = null;
            function startMultiVoiceInput() {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SpeechRecognition) { alert("Reconnaissance vocale non supportée par votre navigateur."); return; }
                
                const selectedLang = document.getElementById('langSelect').value;
                const langMap = { 'fr': 'fr-FR', 'ar': 'ar-SA', 'en': 'en-US', 'es': 'es-ES', 'de': 'de-DE', 'it': 'it-IT', 'pt': 'pt-PT', 'ru': 'ru-RU', 'zh': 'zh-CN', 'ja': 'ja-JP', 'tr': 'tr-TR', 'hi': 'hi-IN' };
                
                recognitionInstance = new SpeechRecognition();
                recognitionInstance.lang = langMap[selectedLang] || 'fr-FR';
                recognitionInstance.continuous = true; // Permet plusieurs questions d'affilée dans la même dictée
                recognitionInstance.interimResults = true;

                let finalTranscript = document.getElementById('aiPrompt').value;

                recognitionInstance.onresult = (event) => {
                    let interim = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript += (finalTranscript ? "\n" : "") + event.results[i][0].transcript;
                        } else {
                            interim += event.results[i][0].transcript;
                        }
                    }
                    document.getElementById('aiPrompt').value = finalTranscript + (interim ? " [" + interim + "]" : "");
                };

                recognitionInstance.onerror = (err) => { console.error(err); };
                recognitionInstance.onend = () => { console.log('Dictée multi-questions terminée.'); };

                recognitionInstance.start();
                alert("🎤 Dictée vocale continue démbrée : vous pouvez poser plusieurs questions à la suite. Cliquez à nouveau sur 'Confirmer' pour valider.");
            }

            async function translatePrompt() {
                const prompt = document.getElementById('aiPrompt').value;
                const lang = document.getElementById('langSelect').value;
                if(!prompt) return;
                const res = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: prompt, targetLang: lang })
                });
                const data = await res.json();
                if(data.translatedText) {
                    document.getElementById('aiPrompt').value = data.translatedText;
                }
            }

            let countdownInterval;
            function confirmAndSendAI() {
                if(recognitionInstance) { try { recognitionInstance.stop(); } catch(e){} }
                let timeLeft = 7;
                const timerEl = document.getElementById('timer-display');
                const domain = document.getElementById('domainSelect').value;
                document.getElementById('scholars-assigned').innerText = "⏳ Sélection des Scholars pour le domaine [" + domain + "] (délai de réponse 5 min / arbitrage et enrichissement Gemini en cours)...";
                
                clearInterval(countdownInterval);
                countdownInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        timerEl.innerText = "⏳ Envoi programmé dans " + timeLeft + " secondes...";
                    } else {
                        clearInterval(countdownInterval);
                        timerEl.innerText = "🚀 Transmission aux publications des Scholars...";
                        askAI();
                    }
                }, 1000);
            }

            async function askAI() {
                document.getElementById('timer-display').innerText = "";
                const prompt = document.getElementById('aiPrompt').value;
                const domain = document.getElementById('domainSelect').value;
                const lang = document.getElementById('langSelect').value;
                const responseDiv = document.getElementById('aiResponse');
                responseDiv.innerText = 'Compilation des avis des Scholars et synthèse Gemini en cours...';
                
                const res = await fetch('/api/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt, domain, lang, email: currentVisitorEmail })
                });
                const data = await res.json();
                document.getElementById('scholars-assigned').innerHTML = "👥 <strong>Scholars assignés & consultés :</strong> " + (data.scholars || "Experts certifiés");
                responseDiv.innerText = data.answer;
            }

            function speakResponse() {
                const text = document.getElementById('aiResponse').innerText;
                const lang = document.getElementById('langSelect').value;
                if (!text) return;
                const utterance = new SpeechSynthesisUtterance(text);
                const langMap = { 'fr': 'fr-FR', 'ar': 'ar-SA', 'en': 'en-US', 'es': 'es-ES', 'de': 'de-DE', 'it': 'it-IT', 'pt': 'pt-PT', 'ru': 'ru-RU', 'zh': 'zh-CN', 'ja': 'ja-JP', 'tr': 'tr-TR', 'hi': 'hi-IN' };
                utterance.lang = langMap[lang] || 'fr-FR';
                window.speechSynthesis.speak(utterance);
            }

            function shareQA() {
                const q = document.getElementById('aiPrompt').value;
                const a = document.getElementById('aiResponse').innerText;
                const shareText = "Q/R Scholars Connect:\\nQ: " + q + "\\nR: " + a;
                if (navigator.share) {
                    navigator.share({ title: 'Scholars Connect Q/R', text: shareText }).catch(console.error);
                } else {
                    navigator.clipboard.writeText(shareText);
                    alert("Q/R copiée dans le presse-papier pour partage !");
                }
            }
        </script>
    </body>
    </html>
  `);
});

app.post('/api/visitor-login', (req, res) => {
  const { name, email } = req.body;
  const loginTime = new Date().toISOString();
  db.run(`INSERT INTO visitor_sessions (visitor_name, visitor_email, login_time) VALUES (?, ?, ?)`, 
    [name, email, loginTime], (err) => {
      res.json({ success: true });
    });
});

app.post('/api/visitor-logout', express.json(), (req, res) => {
  const { email } = req.body;
  const logoutTime = new Date().toISOString();
  db.run(`UPDATE visitor_sessions SET logout_time = ? WHERE visitor_email = ? AND logout_time IS NULL`, 
    [logoutTime, email], (err) => {
      res.json({ success: true });
    });
});

app.post('/api/translate', async (req, res) => {
  const { text, targetLang } = req.body;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Translate the following text accurately into language code "${targetLang}". Return ONLY the translated text: ${text}`,
    });
    res.json({ translatedText: response.text.trim() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Tableau de bord Administrateur Secret avec Accès Direct Admin et Suivi Complet
app.get('/admin-secret-dashboard', (req, res) => {
  db.all(`SELECT COUNT(*) as total_users FROM users`, [], (err, userRows) => {
    db.all(`SELECT * FROM visitor_sessions ORDER BY id DESC`, [], (err, sessions) => {
      db.all(`SELECT * FROM visitor_qa ORDER BY id DESC`, [], (err, qas) => {
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
                  .dashboard-container { max-width: 1200px; margin: 0 auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                  h1 { color: var(--admin-primary); margin-top: 0; }
                  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; }
                  .metric-card { background: #fee2e2; border-left: 5px solid var(--admin-primary); padding: 1.5rem; border-radius: 8px; }
                  .metric-card h3 { margin: 0; color: #991b1b; font-size: 0.9rem; text-transform: uppercase; }
                  .metric-card .value { font-size: 2rem; font-weight: bold; margin-top: 10px; color: #7f1d1d; }
                  .section { margin-top: 2.5rem; }
                  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
                  th, td { padding: 10px; text-align: left; border-bottom: 1px solid #cbd5e1; font-size: 0.9rem; }
                  th { background: #f1f5f9; color: #334155; }
                  .btn-back { display: inline-block; margin-bottom: 1rem; text-decoration: none; background: #475569; color: white; padding: 8px 14px; border-radius: 6px; font-weight: bold; }
                  textarea, select { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
                  button { background: var(--admin-primary); color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; }
              </style>
          </head>
          <body>
              <div class="dashboard-container">
                  <a class="btn-back" href="/">⬅️ Retourner au site public</a>
                  <h1>⚙️ Tableau de Bord Administrateur (Accès Direct & Scholars)</h1>

                  <div class="section" style="background: #fff5f5; padding: 1.5rem; border-radius: 8px; border: 2px dashed var(--admin-primary);">
                      <h3 style="color: var(--admin-primary);">⚡ Accès Direct Administrateur (Poser une question directement sans passer par le public)</h3>
                      <div style="display: flex; gap: 15px;">
                          <div style="flex: 1;">
                              <label>Domaine :</label>
                              <select id="adminDomain">
                                  <option value="Mathématiques">Mathématiques</option>
                                  <option value="Physique-Chimie">Physique-Chimie</option>
                                  <option value="Philosophie">Philosophie</option>
                                  <option value="Religions & Théologie">Religions & Théologie</option>
                                  <option value="Histoire">Histoire</option>
                                  <option value="Géographie">Géographie</option>
                                  <option value="Intelligence Artificielle">Intelligence Artificielle</option>
                                  <option value="Informatique">Informatique</option>
                                  <option value="Arts & Culture Générale">Arts & Culture Générale</option>
                                  <option value="Restauration & Gastronomie">Restauration & Gastronomie</option>
                              </select>
                          </div>
                          <div style="flex: 1;">
                              <label>Langue :</label>
                              <select id="adminLang">
                                  <option value="fr">Français</option>
                                  <option value="ar">العربية</option>
                                  <option value="en">English</option>
                                  <option value="es">Español</option>
                                  <option value="de">Deutsch</option>
                                  <option value="it">Italiano</option>
                              </select>
                          </div>
                      </div>
                      <textarea id="adminPrompt" rows="3" placeholder="Saisissez votre question administrateur ici (multi-questions supportées)..."></textarea>
                      <button onclick="adminAskAI()">Interroger les Scholars & Gemini directement</button>
                      <div id="adminResponse" style="margin-top: 15px; white-space: pre-wrap; background: white; padding: 15px; border-radius: 6px; border: 1px solid #cbd5e1;"></div>
                  </div>

                  <div class="metrics-grid">
                      <div class="metric-card">
                          <h3>Total Sessions Visiteurs</h3>
                          <div class="value">${sessions.length}</div>
                      </div>
                      <div class="metric-card">
                          <h3>Total Q/R Traitées</h3>
                          <div class="value">${qas.length}</div>
                      </div>
                  </div>

                  <div class="section">
                      <h3>🕒 Suivi des Connexions Visiteurs</h3>
                      <table>
                          <thead>
                              <tr>
                                  <th>Nom</th>
                                  <th>Email</th>
                                  <th>Entrée</th>
                                  <th>Sortie</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${sessions.map(s => `
                                  <tr>
                                      <td>${s.visitor_name || 'Anonyme'}</td>
                                      <td>${s.visitor_email}</td>
                                      <td>${s.login_time ? new Date(s.login_time).toLocaleString() : '-'}</td>
                                      <td>${s.logout_time ? new Date(s.logout_time).toLocaleString() : '<span style="color:green; font-weight:bold;">En ligne 🟢</span>'}</td>
                                  </tr>
                              `).join('')}
                          </tbody>
                      </table>
                  </div>

                  <div class="section">
                      <h3>💬 Historique des Q/R</h3>
                      <table>
                          <thead>
                              <tr>
                                  <th>Utilisateur</th>
                                  <th>Question</th>
                                  <th>Réponse</th>
                                  <th>Date</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${qas.map(q => `
                                  <tr>
                                      <td>${q.visitor_email}</td>
                                      <td>${q.question}</td>
                                      <td>${q.answer}</td>
                                      <td>${new Date(q.created_at).toLocaleString()}</td>
                                  </tr>
                              `).join('')}
                          </tbody>
                      </table>
                  </div>
              </div>

              <script>
                  async function adminAskAI() {
                      const prompt = document.getElementById('adminPrompt').value;
                      const domain = document.getElementById('adminDomain').value;
                      const lang = document.getElementById('adminLang').value;
                      const respDiv = document.getElementById('adminResponse');
                      respDiv.innerText = 'Consultation des Scholars du domaine et synthèse Gemini en cours...';

                      const res = await fetch('/api/ai', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ prompt, domain, lang, email: 'admin@scholars.com' })
                      });
                      const data = await res.json();
                      respDiv.innerHTML = "<strong>Scholars consultés :</strong> " + data.scholars + "<br><br><strong>Réponse :</strong> " + data.answer;
                  }
              </script>
          </body>
          </html>
        `);
      });
    });
  });
});

// Route IA enrichie avec sélection des Scholars par domaine et réponse dans la langue demandée
app.post('/api/ai', async (req, res) => {
  const { prompt, domain, lang, email } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt requis.' });
  }

  const scholarsMap = {
    "Mathématiques": "Pr. Al-Khwarizmi, Dr. Évariste Galois, Pr. Maryam Mirzakhani",
    "Physique-Chimie": "Pr. Albert Einstein, Dr. Marie Curie, Pr. Richard Feynman",
    "Philosophie": "Pr. Ibn Khaldoun, Dr. Immanuel Kant, Pr. Hannah Arendt",
    "Religions & Théologie": "Pr. Averroès (Ibn Rushd), Dr. Thomas d'Aquin, Sheikh Al-Ghazali",
    "Histoire": "Pr. Fernand Braudel, Dr. Herodotus, Pr. Ibn Khaldoun",
    "Géographie": "Pr. Al-Idrisi, Dr. Alexander von Humboldt",
    "Intelligence Artificielle": "Pr. Alan Turing, Dr. Geoffrey Hinton, Pr. Yann LeCun",
    "Informatique": "Pr. Ada Lovelace, Dr. Donald Knuth, Linus Torvalds",
    "Arts & Culture Générale": "Pr. Leonardo da Vinci, Dr. Ibn Arabi, Pr. Pablo Picasso",
    "Restauration & Gastronomie": "Chef Auguste Escoffier, Chef Paul Bocuse, Chef Fatma Baccar"
  };

  const assignedScholars = scholarsMap[domain] || "Comité d'experts multidisciplinaires Scholars Connect";

  try {
    const contextualPrompt = `En tant que collège de scholars reconnus (${assignedScholars}) spécialisés dans le domaine "${domain || 'Culture Générale'}", analysez et répondez de manière approfondie à la question suivante en croisant vos publications et expertises, en rédigeant la réponse finale dans la langue "${lang || 'fr'}": ${prompt}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contextualPrompt,
    });
    const answer = response.text;

    if (email) {
      db.run(`INSERT INTO visitor_qa (visitor_email, question, answer) VALUES (?, ?, ?)`, [email, `[${domain || 'Général'}] ${prompt}`, answer]);
    }

    res.json({ answer, scholars: assignedScholars });
  } catch (error) {
    console.error('Erreur IA Gemini:', error);
    res.status(500).json({ error: 'Erreur lors de la génération avec l’IA.' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
