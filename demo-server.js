const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_super_securise_scholars';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Erreur ouverture DB', err.message);
    } else {
        console.log('Connecté à la base de données SQLite.');
        db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT "user", status TEXT DEFAULT "active", last_login TEXT, last_logout TEXT)', () => {
            db.get('SELECT * FROM users WHERE username = ?', ['ramsis0710@gmail.com'], (err, row) => {
                if (!row) {
                    const hashedPwd = bcrypt.hashSync('AdminPass123!', 8);
                    db.run('INSERT INTO users (username, password, role, status) VALUES (?, ?, "admin", "active")', ['ramsis0710@gmail.com', hashedPwd]);
                }
            });
        });

        db.run('CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, domain TEXT, specialty TEXT, scholar_name TEXT, prompt TEXT, reply TEXT, status TEXT DEFAULT "En attente", created_at TEXT)');
    }
});

function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token manquant.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token invalide.' });
        db.get('SELECT status FROM users WHERE id = ?', [user.id], (err, row) => {
            if (row && row.status === 'inactive') {
                return res.status(403).json({ error: 'Compte désactivé par l\'administrateur.' });
            }
            req.user = user;
            next();
        });
    });
}

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Champs requis.' });
    const hashedPassword = bcrypt.hashSync(password, 8);
    db.run('INSERT INTO users (username, password, role, status) VALUES (?, ?, "user", "active")', [username, hashedPassword], function(err) {
        if (err) return res.status(400).json({ error: 'Utilisateur déjà existant.' });
        res.json({ message: 'Inscription réussie !', userId: this.lastID });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Identifiants invalides.' });
        }
        if (user.status === 'inactive') return res.status(403).json({ error: 'Compte désactivé.' });

        const now = new Date().toISOString();
        db.run('UPDATE users SET last_login = ? WHERE id = ?', [now, user.id]);

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '4h' });
        res.json({ message: 'Connexion réussie', token, role: user.role, username: user.username });
    });
});

app.post('/api/logout', verifyToken, (req, res) => {
    const now = new Date().toISOString();
    db.run('UPDATE users SET last_logout = ? WHERE id = ?', [now, req.user.id], () => {
        res.json({ message: 'Déconnexion enregistrée.' });
    });
});

app.get('/api/admin/users', verifyToken, (req, res) => {
    if (req.user.username !== 'ramsis0710@gmail.com') return res.status(403).json({ error: 'Accès refusé.' });
    db.all('SELECT id, username, role, status, last_login, last_logout FROM users', [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/admin/toggle-status', verifyToken, (req, res) => {
    if (req.user.username !== 'ramsis0710@gmail.com') return res.status(403).json({ error: 'Accès refusé.' });
    const { userId, status } = req.body;
    db.run('UPDATE users SET status = ? WHERE id = ?', [status, userId], () => {
        res.json({ message: 'Statut mis à jour.' });
    });
});

app.post('/api/questions', verifyToken, async (req, res) => {
    const { domain, specialty, scholar_name, prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt requis.' });
    const createdAt = new Date().toLocaleDateString('fr-FR');
    try {
        const aiResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `En tant que Juge Académique, réponds en expert à la question en ${domain} (${specialty}), assignée au scholar ${scholar_name}. Question : ${prompt}`,
        });
        const replyText = aiResponse.text;
        db.run('INSERT INTO questions (username, domain, specialty, scholar_name, prompt, reply, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.username, domain, specialty, scholar_name, prompt, replyText, '🤖 Juge Claude ⏱️ 5 min', createdAt], function() {
                res.json({ message: 'Réponse générée', reply: replyText, id: this.lastID });
            });
    } catch (e) {
        res.status(500).json({ error: 'Erreur IA' });
    }
});

app.get('/api/questions', (req, res) => {
    db.all('SELECT * FROM questions ORDER BY id DESC', [], (err, rows) => { res.json(rows); });
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Scholars Connect</title>
<style>
body { font-family: Arial, sans-serif; max-width: 900px; margin: 20px auto; padding: 20px; background: #f0f2f5; }
.card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
input, select, textarea { width: 100%; padding: 10px; margin: 5px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
button { background: #007BFF; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; margin-top: 5px; }
button:hover { background: #0056b3; }
.hidden { display: none; }
pre { background: #eee; padding: 10px; border-radius: 4px; white-space: pre-wrap; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { background: #f2f2f2; }
</style>
</head>
<body>
<div class="card">
<h2>🌍 Scholars Connect - Public</h2>
<p><span id="user-display">👤 Visiteur</span> | <button onclick="logout()" id="logout-btn" class="hidden" style="background:#d9534f;padding:5px 10px;">Déconnexion</button></p>
</div>

<div class="card" id="auth-card">
<h3>🔐 Connexion / Inscription</h3>
<input type="text" id="username" placeholder="Email (ex: ramsis0710@gmail.com)">
<input type="password" id="password" placeholder="Mot de passe">
<button onclick="login()">Se connecter</button>
<button onclick="register()" style="background:#5cb85c;">S'inscrire</button>
<button onclick="fillAdmin()" style="background:#6c757d;">Remplir Admin Auto</button>
<p id="auth-msg" style="color:red;font-weight:bold;"></p>
</div>

<div class="card hidden" id="admin-dashboard">
<h3>🛡️ Tableau de Bord Administrateur (ramsis0710@gmail.com)</h3>
<div id="admin-container">Chargement...</div>
</div>

<div class="card hidden" id="question-card">
<h3>🎓 Poser une question</h3>
<select id="domain"><option value="Islam">Islam</option><option value="Medecine">Medecine</option><option value="General" selected>General</option></select>
<input type="text" id="specialty" placeholder="Spécialité">
<input type="text" id="scholar" placeholder="Nom du Scholar">
<textarea id="prompt" rows="3" placeholder="Votre question ou dictée vocale..."></textarea>
<button onclick="startVoice()" style="background:#5cb85c;">🎤 Dictée Vocale (7s pause)</button>
<button onclick="sendQuestion()">Envoyer</button>
<p id="voice-status" style="font-weight:bold;color:#007BFF;"></p>
</div>

<div class="card">
<h3>📋 Historique</h3>
<button onclick="loadQuestions()">🔄 Rafraîchir</button>
<div id="q-list" style="margin-top:10px;"></div>
</div>

<script>
let token = localStorage.getItem('token') || '';
let username = localStorage.getItem('username') || '';

function fillAdmin() {
    document.getElementById('username').value = 'ramsis0710@gmail.com';
    document.getElementById('password').value = 'AdminPass123!';
}

function checkUI() {
    if (token) {
        document.getElementById('auth-card').classList.add('hidden');
        document.getElementById('question-card').classList.remove('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        document.getElementById('user-display').innerText = '👤 ' + username;
        if (username === 'ramsis0710@gmail.com') {
            document.getElementById('admin-dashboard').classList.remove('hidden');
            loadAdmin();
        }
    } else {
        document.getElementById('auth-card').classList.remove('hidden');
        document.getElementById('question-card').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.add('hidden');
        document.getElementById('logout-btn').classList.add('hidden');
        document.getElementById('user-display').innerText = '👤 Visiteur';
    }
}

function startVoice() {
    const status = document.getElementById('voice-status');
    const txt = document.getElementById('prompt');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Reconnaissance vocale non supportée'); return; }
    const rec = new SpeechRecognition();
    rec.onresult = (e) => {
        const speech = e.results[0][0].transcript;
        status.innerText = '⏱️ Pause de réflexion de 7 secondes...';
        let count = 7;
        let t = setInterval(() => {
            count--;
            status.innerText = '⏱️ Validation dans ' + count + 's...';
            if(count < 0) {
                clearInterval(t);
                txt.value += (txt.value ? ' ' : '') + speech;
                status.innerText = '✅ Dictée ajoutée !';
            }
        }, 1000);
    };
    rec.start();
    status.innerText = '🎙️ Parlez maintenant...';
}

async function login() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username:u, password:p}) });
    const data = await res.json();
    if (data.token) {
        token = data.token; username = data.username;
        localStorage.setItem('token', token); localStorage.setItem('username', username);
        checkUI(); loadQuestions();
    } else { document.getElementById('auth-msg').innerText = data.error; }
}

async function register() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const res = await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username:u, password:p}) });
    const data = await res.json();
    document.getElementById('auth-msg').innerText = data.message || data.error;
}

async function logout() {
    await fetch('/api/logout', { method: 'POST', headers: {'Authorization':'Bearer ' + token} });
    localStorage.clear(); token = ''; username = ''; checkUI();
}

async function loadAdmin() {
    const res = await fetch('/api/admin/users', { headers: {'Authorization':'Bearer ' + token} });
    const users = await res.json();
    let html = '<table><tr><th>ID</th><th>User</th><th>Statut</th><th>Action</th></tr>';
    users.forEach(u => {
        let actionBtn = (u.username !== 'ramsis0710@gmail.com') 
            ? '<button onclick="toggleUser(' + u.id + ', \'' + u.status + '\')">Changer</button>' 
            : 'Admin';
        html += '<tr><td>' + u.id + '</td><td>' + u.username + '</td><td>' + u.status + '</td><td>' + actionBtn + '</td></tr>';
    });
    html += '</table>';
    document.getElementById('admin-container').innerHTML = html;
}

async function toggleUser(id, current) {
    const newStatus = current === 'active' ? 'inactive' : 'active';
    await fetch('/api/admin/toggle-status', { method: 'POST', headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + token}, body: JSON.stringify({userId: id, status: newStatus}) });
    loadAdmin();
}

async function sendQuestion() {
    const domain = document.getElementById('domain').value;
    const specialty = document.getElementById('specialty').value || 'Général';
    const scholar_name = document.getElementById('scholar').value || 'Dr. Scholar';
    const prompt = document.getElementById('prompt').value;
    const res = await fetch('/api/questions', { method: 'POST', headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + token}, body: JSON.stringify({domain, specialty, scholar_name, prompt}) });
    if(res.ok) { document.getElementById('prompt').value = ''; loadQuestions(); }
}

async function loadQuestions() {
    const res = await fetch('/api/questions');
    const data = await res.json();
    let html = '';
    data.forEach(q => {
        html += '<div style="background:#fff;padding:10px;margin-bottom:10px;border-radius:5px;"><b>' + q.domain + '</b> - ' + q.username + '<p>Q: ' + q.prompt + '</p><pre>' + q.reply + '</pre><button onclick="speak(\'' + encodeURIComponent(q.reply) + '\')">🔊 Écouter</button></div>';
    });
    document.getElementById('q-list').innerHTML = html;
}

function speak(text) {
    if('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(decodeURIComponent(text)));
    }
}

checkUI(); loadQuestions();
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
    console.log(`Serveur opérationnel sur le port ${PORT}`);
});
