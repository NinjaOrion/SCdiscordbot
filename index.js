// ============================================================
//  SoundCloud Discord-Bot
//  Spielt Musik von SoundCloud im Sprachkanal ab.
// ============================================================

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
  getVoiceConnection,
} = require("@discordjs/voice");

// soundcloud-downloader: Default-Export importieren
const scdl = require("soundcloud-downloader").default;

const PREFIX = "!";

// Optionaler eigener SoundCloud Client-ID aus der .env
const SC_CLIENT_ID = process.env.SC_CLIENT_ID || null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

// --------------------------------------------
// Einfache Warteschlangen-Verwaltung pro Server
// --------------------------------------------
const queues = new Map(); // Map<guildId, QueueItem[]>

/**
 * @typedef {Object} QueueItem
 * @property {string} url
 * @property {string} title
 * @property {string} artwork_url
 * @property {string} authorName
 * @property {number} duration
 */

// --------------------------------------------
// Pro Server einen AudioPlayer anlegen
// --------------------------------------------
const players = new Map(); // Map<guildId, AudioPlayer>

function getPlayer(guildId, voiceConnection) {
  let player = players.get(guildId);
  if (!player) {
    player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    // Nächstes Lied abspielen, sobald der Player "idle" ist
    player.on(AudioPlayerStatus.Idle, async () => {
      const queue = queues.get(guildId) || [];
      if (queue.length > 0) {
        await playNext(guildId, voiceConnection, player);
      }
    });

    player.on("error", (error) => {
      console.error(`[Player] Fehler in Guild ${guildId}:`, error.message);
    });

    players.set(guildId, player);
  }
  return player;
}

// --------------------------------------------
// Nächstes Lied aus der Warteschlange abspielen
// --------------------------------------------
async function playNext(guildId, voiceConnection, player) {
  const queue = queues.get(guildId) || [];
  const item = queue.shift();

  if (!item) {
    // Keine Lieder mehr -> Verbindung nach kurzer Zeit trennen
    setTimeout(() => {
      const conn = getVoiceConnection(guildId);
      if (conn && players.get(guildId)?.state.status === AudioPlayerStatus.Idle) {
        conn.destroy();
        players.delete(guildId);
      }
    }, 30_000);
    return;
  }

  try {
    // Stream von SoundCloud holen
    const stream = await scdl.download(item.url, SC_CLIENT_ID);
    const resource = createAudioResource(stream, {
      inputType: stream.type ?? undefined, // wird automatisch erkannt, wenn nicht gesetzt
    });
    player.play(resource);
    voiceConnection.subscribe(player);

    // Jetzt-Abspielen-Nachricht als Embed senden (nur wenn Kanal bekannt)
    // Wir speichern den Text-Kanal pro Guild, um Embeds zu posten.
    const textChannel = client.channels.cache.get(item.textChannelId);
    if (textChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xff5500)
        .setTitle("▶️ Jetzt läuft")
        .setDescription(`[${item.title}](${item.url})`)
        .setThumbnail(item.artwork_url || null)
        .addFields(
          { name: "Künstler", value: item.authorName || "Unbekannt", inline: true },
          {
            name: "Dauer",
            value: item.duration ? formatDuration(item.duration) : "Unbekannt",
            inline: true,
          }
        )
        .setFooter({ text: "Powered by SoundCloud" });

      textChannel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (error) {
    console.error(`[Download] Fehler bei ${item.url}:`, error.message);
    const textChannel = client.channels.cache.get(item.textChannelId);
    if (textChannel) {
      textChannel
        .send(`❌ Konnte den Track nicht abspielen: ${item.title}`)
        .catch(() => {});
    }
    // Weiter mit dem nächsten Lied
    await playNext(guildId, voiceConnection, player);
  }
}

// --------------------------------------------
// Hilfsfunktionen
// --------------------------------------------
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isSoundCloudUrl(input) {
  return /^https?:\/\/(www\.|m\.)?soundcloud\.com\//i.test(input);
}

// --------------------------------------------
// Kommandos
// --------------------------------------------

// !play <SoundCloud-URL | Suchbegriff>
async function playCommand(message, args) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    return message.reply("❌ Du musst dich zuerst in einem Sprachkanal befinden!");
  }

  if (!args.length) {
    return message.reply("❌ Bitte gib eine SoundCloud-URL oder einen Suchbegriff an.");
  }

  const input = args.join(" ");
  const guildId = message.guild.id;

  let track;

  try {
    if (isSoundCloudUrl(input)) {
      // Direkt per URL laden
      const info = await scdl.getInfo(input, SC_CLIENT_ID);
      track = {
        url: input,
        title: info.title,
        artwork_url: info.artwork_url || info.user?.avatar_url || null,
        authorName: info.user?.username || null,
        duration: info.duration,
      };
    } else {
      // Suche
      const results = await scdl.search({
        query: input,
        limit: 1,
        resourceType: "tracks",
        clientID: SC_CLIENT_ID,
      });
      if (!results.collection || results.collection.length === 0) {
        return message.reply("❌ Keine Ergebnisse gefunden.");
      }
      const first = results.collection[0];
      track = {
        url: first.permalink_url,
        title: first.title,
        artwork_url: first.artwork_url || null,
        authorName: first.user?.username || null,
        duration: first.duration,
      };
    }
  } catch (error) {
    console.error("[Suche] Fehler:", error.message);
    return message.reply("❌ Fehler beim Laden des Tracks. Überprüfe die URL oder den Suchbegriff.");
  }

  // Track anhängen
  track.textChannelId = message.channel.id;
  const queue = queues.get(guildId) || [];
  queue.push(track);
  queues.set(guildId, queue);

  // Stimme beitreten, falls noch nicht verbunden
  let voiceConnection = getVoiceConnection(guildId);
  if (!voiceConnection) {
    voiceConnection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    // Auf Verbindung warten
    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 10_000);
    } catch (error) {
      console.error("[Voice] Konnte nicht beitreten:", error.message);
      return message.reply("❌ Konnte dem Sprachkanal nicht beitreten.");
    }
  }

  const player = getPlayer(guildId, voiceConnection);

  if (player.state.status === AudioPlayerStatus.Playing) {
    // Es läuft bereits etwas -> nur in die Queue
    return message.reply(`➕ Zur Warteschlange hinzugefügt: **${track.title}**`);
  }

  // Sofort abspielen
  await playNext(guildId, voiceConnection, player);
  return message.reply(`▶️ Spiele jetzt ab: **${track.title}**`);
}

// !skip
async function skipCommand(message) {
  const guildId = message.guild.id;
  const player = players.get(guildId);
  const queue = queues.get(guildId) || [];

  if (!player || player.state.status !== AudioPlayerStatus.Playing) {
    return message.reply("❌ Es wird gerade nichts abgespielt.");
  }

  if (queue.length === 0) {
    player.stop();
    return message.reply("⏭️ Gestoppt. Die Warteschlange ist leer.");
  }

  player.stop(); // löst "Idle" aus -> spielt nächstes Lied
  return message.reply("⏭️ Übersprungen.");
}

// !queue
async function queueCommand(message) {
  const guildId = message.guild.id;
  const queue = queues.get(guildId) || [];
  const player = players.get(guildId);

  if (queue.length === 0 && !(player && player.state.status === AudioPlayerStatus.Playing)) {
    return message.reply("📭 Die Warteschlange ist leer.");
  }

  const lines = queue.map((item, i) => {
    const duration = item.duration ? ` (${formatDuration(item.duration)})` : "";
    return `${i + 1}. [${item.title}](${item.url})${duration}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xff5500)
    .setTitle("📋 Warteschlange")
    .setDescription(lines.join("\n") || "Keine weiteren Tracks.")
    .setFooter({ text: `${queue.length} Track(s) in der Warteschlange` });

  return message.reply({ embeds: [embed] });
}

// !stop / !leave
async function stopCommand(message) {
  const guildId = message.guild.id;
  const voiceConnection = getVoiceConnection(guildId);

  queues.delete(guildId);
  players.delete(guildId);

  if (voiceConnection) {
    voiceConnection.destroy();
  }

  return message.reply("👋 Tschüss! Wiedergabe gestoppt und Verbindung getrennt.");
}

// !pause
async function pauseCommand(message) {
  const player = players.get(message.guild.id);
  if (!player || player.state.status !== AudioPlayerStatus.Playing) {
    return message.reply("❌ Es wird gerade nichts abgespielt.");
  }
  player.pause();
  return message.reply("⏸️ Pausiert.");
}

// !resume
async function resumeCommand(message) {
  const player = players.get(message.guild.id);
  if (!player || player.state.status !== AudioPlayerStatus.Paused) {
    return message.reply("❌ Es ist nichts pausiert.");
  }
  player.unpause();
  return message.reply("▶️ Fortgesetzt.");
}

// --------------------------------------------
// Hilfe
// --------------------------------------------
function helpCommand(message) {
  const embed = new EmbedBuilder()
    .setColor(0xff5500)
    .setTitle("🎵 SoundCloud Bot – Befehle")
    .setDescription("Alle Befehle beginnen mit `!`.")
    .addFields(
      { name: "!play <URL|Suche>", value: "Spielt einen SoundCloud-Track ab oder fügt ihn der Warteschlange hinzu." },
      { name: "!skip", value: "Überspringt den aktuellen Track." },
      { name: "!pause", value: "Pausiert die Wiedergabe." },
      { name: "!resume", value: "Setzt die Wiedergabe fort." },
      { name: "!queue", value: "Zeigt die aktuelle Warteschlange." },
      { name: "!stop", value: "Stoppt die Wiedergabe und verlässt den Kanal." },
      { name: "!help", value: "Zeigt diese Hilfe." }
    );
  return message.reply({ embeds: [embed] });
}

// --------------------------------------------
// Nachrichten-Handler
// --------------------------------------------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  try {
    switch (command) {
      case "play":
      case "p":
        await playCommand(message, args);
        break;
      case "skip":
      case "s":
        await skipCommand(message);
        break;
      case "queue":
      case "q":
        await queueCommand(message);
        break;
      case "stop":
      case "leave":
      case "disconnect":
        await stopCommand(message);
        break;
      case "pause":
        await pauseCommand(message);
        break;
      case "resume":
      case "unpause":
        await resumeCommand(message);
        break;
      case "help":
      case "h":
        await helpCommand(message);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error("[Command] Fehler:", error);
    message.reply("❌ Hoppla, da ist etwas schiefgelaufen.").catch(() => {});
  }
});

// --------------------------------------------
// Events
// --------------------------------------------
client.once("ready", () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
});

client.on("voiceStateUpdate", (oldState, newState) => {
  // Bot allein im Kanal? -> Verbindung trennen
  if (newState.member?.user?.bot && newState.channelId) {
    const connection = getVoiceConnection(newState.guild.id);
    const channel = newState.channel;
    if (channel && channel.members.filter((m) => !m.user.bot).size === 0) {
      setTimeout(() => {
        const conn = getVoiceConnection(newState.guild.id);
        if (conn) {
          conn.destroy();
          queues.delete(newState.guild.id);
          players.delete(newState.guild.id);
        }
      }, 10_000);
    }
  }
});

// --------------------------------------------
// Start
// --------------------------------------------
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN fehlt! Bitte .env Datei anlegen (siehe .env.example).");
  process.exit(1);
}

client.login(token);
