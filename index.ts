import { ChatInputCommandInteraction, Embed, EmbedBuilder, REST, Routes } from "discord.js";
import { Client, Events, GatewayIntentBits, SlashCommandBuilder, type APIUser } from "discord.js";

const APPLICATION_ID = '761329837654540289';
const DATABASE_BACKUP_CHANNEL_ID = '1460006766812074086';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const EMBED_COLOR = 0x206694;
const GUILD_ID = '375698086942736384';
const LOG_CHANNEL_ID = '375998117780127754';

const DATABASE_FILE = './database.json';
let database = Bun.file(DATABASE_FILE);

type Record = {
    memberId: string,
    xp: number,
};

const data: Record[] = await database.json();

function ranked(): Record[] {
    return data.toSorted((a, b) => b.xp - a.xp);
}

function rankOf(memberId: string): number {
    return ranked().findIndex(record => record.memberId === memberId);
}

function xpToLevel(xp: number): number {
    return Math.floor(Math.pow(xp / 60, 0.385));
}

function levelToXp(level: number): number {
    return Math.floor(Math.pow(level, 2.6) * 60);
}

// Returns -1 if the user level hasn't changed after the XP update; returns the user's new level otherwise.
function incrementXP(targetMemberId: string): number {
    const recordIndex = data.findIndex(record => record.memberId === targetMemberId);

    if (recordIndex === -1) {
        data.push({ memberId: targetMemberId, xp: 1 });

        return 1; // level 1 is reached at 1 xp
    }

    const oldLevel = xpToLevel(data[recordIndex]!.xp);
    data[recordIndex]!.xp++;
    const newLevel = xpToLevel(data[recordIndex]!.xp);

    if (oldLevel !== newLevel) {
        return newLevel;
    } else {
        return -1;
    }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const rankCommand = new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Consulter votre classement (ou celui d'un autre utilisateur).")
    .addUserOption(option => option.setName('user').setDescription("L'utilisateur dont le classement doit être consulté (défaut: vous-même)."));

const topCommand = new SlashCommandBuilder()
    .setName('top')
    .setDescription("Consulter le classement du serveur.");

// Deploying commands

const rest = new REST().setToken(DISCORD_TOKEN);

try {
    await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: [rankCommand.toJSON(), topCommand.toJSON()] });
} catch (error) {
    console.error('Registering slash commands failed:', error);
}

client.on(Events.ClientReady, _ => {
    setInterval(async () => {
        const guild = client.guilds.cache.get(GUILD_ID);

        if (guild === undefined) {
            return;
        }

        for(const voiceChannel of guild.channels.cache.values().filter(channel => channel.isVoiceBased())) {
            if (voiceChannel.members.size <= 1) {
                continue;
            }

            const eligibleMembers = voiceChannel.members.filter(member => !member.user.bot && !member.voice.mute && !member.voice.deaf);

            for (const [memberId, _] of eligibleMembers) {
                const newLevel = incrementXP(memberId);
                if (newLevel !== -1) {
                    const channel = await client.channels.fetch(LOG_CHANNEL_ID);

                    if (channel === null) {
                        console.warn('Could not find log channel.');
                        return;
                    }

                    if (!channel.isSendable()) {
                        console.warn('Cannot write message to log channel.');
                        return;
                    }

                    channel.send(`Félicitations <@${memberId}>, vous venez de passer au niveau ${newLevel} !`);
                }
            }
        }
    }, 60 * 1000);

    setInterval(async () => {
        await database.delete();
        database = Bun.file(DATABASE_FILE);
        await database.write(JSON.stringify(data));
    }, 10 * 60 * 1000);

    setInterval(async () => {
        const backupChannel = await client.channels.fetch(DATABASE_BACKUP_CHANNEL_ID);

        if (backupChannel === null) {
            console.warn('Could not find backup channel for database.');
            return;
        }

        if (!backupChannel.isSendable()) {
            console.warn('Database backup channel is not sendable.');
            return;
        }

        await backupChannel.send(JSON.stringify(data));
    }, 24 * 60 * 60 * 1000);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName === 'rank') {
        await handleRankCommand(interaction);
    }

    if (interaction.commandName === 'top') {
        await handleTopCommand(interaction);
    }
});

client.login(DISCORD_TOKEN)

const FOOTER = 'Bot réalisé par g.mz !';

async function handleRankCommand(interaction: ChatInputCommandInteraction) {
    const invoker = interaction.user;
    const targetUser = interaction.options.getUser('user', false) ?? invoker;

    const record = data.find(current => current.memberId === targetUser.id);

    const xp = record?.xp ?? 0;
    const level = xpToLevel(xp);
    const baseXpCurrentLevel = levelToXp(level);
    const baseXpNextLevel = levelToXp(level + 1);

    const progressPercentage = (xp - baseXpCurrentLevel) / (baseXpNextLevel - baseXpCurrentLevel) * 100;
    const progressBars = Math.round(progressPercentage / 10);

    const progressBarFull = '█';
    const progressBarEmpty = '░';

    const hoursBeforeNextLevel = Math.ceil((baseXpNextLevel - xp) / 60);

    const progress = `${progressBarFull.repeat(2 * progressBars)}${progressBarEmpty.repeat(20 - 2 * progressBars)} (${hoursBeforeNextLevel}h restantes)`;

    const rank = rankOf(targetUser.id) + 1;
    const rankString = rank === -1 ? "Non classé" : `${rank.toString()}/${data.length}`;

    const reply = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`Rang de ${targetUser.displayName}`)
        .setThumbnail(targetUser.avatarURL())
        .addFields(
            { name: 'Rang', value: rankString },
            { name: 'Niveau', value: level.toString() },
            { name: 'Progression', value: progress }
        )
        .setFooter({ text:  FOOTER });

    await interaction.reply({ embeds: [reply] });
}

async function handleTopCommand(interaction: ChatInputCommandInteraction) {
    const first15 = ranked().slice(0, 14);

    let result = '';

    for (const [i, record] of first15.entries()) {
        if (i == 0) { result += '🥇'; }
        if (i == 1) { result += '🥈'; }
        if (i == 2) { result += '🥉'; }

        const user = await client.users.fetch(record.memberId);
        result += `- ${user.displayName}\n`;
    }

    const reply = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Classement du serveur')
        .addFields({ name: "Top 15:", value: result })
        .setFooter({ text: FOOTER });

    await interaction.reply({ embeds: [reply] });
}