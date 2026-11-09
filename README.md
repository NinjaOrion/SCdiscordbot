# 🎵 SoundCloud Discord-Bot

Ein Discord-Bot in JavaScript (Node.js), der Musik von SoundCloud streamt und im Sprachkanal abspielt.

## Features

- 🔍 Suche nach Tracks direkt über den Chat (`!play <Suchbegriff>`)
- 🔗 Abspielen über SoundCloud-URL
- 📋 Warteschlange mit `!skip`, `!queue`
- ⏸️ `!pause` / `!resume`
- 👋 `!stop` verlässt den Kanal

## Voraussetzungen

- [Node.js](https://nodejs.org) 18 oder neuer
- Ein Discord-Bot-Token aus dem [Discord Developer Portal](https://discord.com/developers/applications)

## Schnellstart

1. **Abhängigkeiten installieren**

   ```bash
   npm install
   ```

2. **`.env` Datei anlegen**

   Kopiere die Beispiel-Datei und trage dein Bot-Token ein:

   ```bash
   cp .env.example .env
   ```

   Dann in `.env` den Token eintragen:

   ```env
   DISCORD_TOKEN=dein_bot_token_hier
   ```

3. **Bot starten**

   ```bash
   npm start
   ```

4. **Bot einladen**

   Erstelle im Developer Portal eine Einladungs-URL mit den folgenden **Scopes** und Rechten:

   - Scopes: `bot`, `applications.commands`
   - Bot-Rechte: `Send Messages`, `Connect`, `Speak`, `Use Voice Activity`

## Discord-Intents aktivieren

Im Developer Portal unter **Bot → Privileged Gateway Intents** müssen aktiviert sein:

- ✅ `Message Content Intent`
- ✅ `Server Members Intent` (optional, aber empfohlen)

## Befehle

| Befehl              | Beschreibung                                          |
| ------------------- | ----------------------------------------------------- |
| `!play <URL/Suche>` | Spielt einen Track ab oder fügt ihn der Liste hinzu   |
| `!skip`             | Überspringt den aktuellen Track                       |
| `!pause`            | Pausiert                                              |
| `!resume`           | Setzt fort                                            |
| `!queue`            | Zeigt die Warteschlange                               |
| `!stop`             | Stoppt und verlässt den Kanal                         |
| `!help`             | Zeigt alle Befehle                                    |

## SoundCloud Client-ID (optional)

`soundcloud-downloader` bringt eine Standard-Client-ID mit. Falls das Streaming nicht mehr
funktioniert, kannst du eine eigene Client-ID in der `.env` setzen:

```env
SC_CLIENT_ID=deine_client_id
```

## Hinweise

- Aus rechtlichen Gründen solltest du nur Tracks abspielen, die du selbst hochgeladen hast
  oder deren öffentliche Wiedergabe erlaubt ist.
- Der Bot puffert den Stream direkt von SoundCloud; große Warteschlangen können Arbeitsspeicher nutzen.
