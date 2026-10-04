const { AudioPlayerStatus } = require('@discordjs/voice');

async function handleTrackIdle(state, guildId, playNext) {
  const currentSong = state.songs[0];
  const shouldLoop = state.loopCurrent && !state.skipCurrent
    && currentSong && state.failedSong !== currentSong;

  state.skipCurrent = false;
  if (!shouldLoop) {
    state.songs.shift();
    state.loopCurrent = false;
  }
  state.failedSong = null;
  state.resource = null;

  if (state.songs.length) {
    await playNext(guildId);
  } else {
    state.playing = false;
  }
}

async function skipCurrentTrack(state, guildId, playNext) {
  if (!state.songs.length) return false;

  state.loopCurrent = false;
  if (state.player.state.status === AudioPlayerStatus.Idle) {
    state.songs.shift();
    state.skipCurrent = false;
    state.resource = null;
    state.failedSong = null;
    if (state.songs.length) await playNext(guildId);
    else state.playing = false;
    return true;
  }

  state.skipCurrent = true;
  state.player.stop();
  return true;
}

function clearQueue(state) {
  const clearedCount = state.songs.length;
  state.playGeneration += 1;
  state.songs = [];
  state.loopCurrent = false;
  state.skipCurrent = false;
  state.player.stop();
  state.resource = null;
  state.failedSong = null;
  state.playing = false;
  return clearedCount;
}

module.exports = { clearQueue, handleTrackIdle, skipCurrentTrack };
