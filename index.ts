import { Client, Events, GatewayIntentBits } from "discord.js";

const DATABASE_BACKUP_CHANNEL_ID = '1460006766812074086';
const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const GUILD_ID = '375698086942736384';
const LOG_CHANNEL_ID = '375998117780127754';

const DATABASE_FILE = './database.json';
let database = Bun.file(DATABASE_FILE);

type Record = {
    memberId: string,
    xp: number,
};

const data: Record[] = await database.json();

// Returns -1 if the user level hasn't changed after the XP update; returns the user's new level otherwise.
function incrementXP(targetMemberId: string): number {
    const recordIndex = data.findIndex(record => record.memberId === targetMemberId);

    if (recordIndex === -1) {
        data.push({ memberId: targetMemberId, xp: 1 });

        return 1; // level 1 is reached at 1 xp
    }

    function xpToLevel(xp: number): number {
        return Math.floor(Math.pow(xp / 60, 0.385));
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

client.login(DISCORD_TOKEN)