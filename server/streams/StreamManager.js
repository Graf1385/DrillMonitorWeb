const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

class StreamManager {
    constructor() {
        this._streams = new Map();
        this._hlsBase = path.join(os.tmpdir(), 'drillmonitor_hls');
        try { fs.mkdirSync(this._hlsBase, { recursive: true }); } catch {}
    }

    buildRtspUrl({ rtspUrl, host, port, username, password, channel, substream }) {
        if (rtspUrl) return rtspUrl;
        const u    = encodeURIComponent(username || '');
        const p    = encodeURIComponent(password || '');
        const auth = u ? `${u}:${p}@` : '';
        const ch   = channel   || 1;
        const sub  = substream ? 1 : 0;
        return `rtsp://${auth}${host || 'localhost'}:${port || 554}/cam/realmonitor?channel=${ch}&subtype=${sub}`;
    }

    start(streamKey, rtspUrl) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(streamKey)) throw new Error('Invalid streamKey');
        this.stop(streamKey);

        const hlsDir = path.join(this._hlsBase, streamKey);
        try { fs.mkdirSync(hlsDir, { recursive: true }); } catch {}

        const proc = spawn('ffmpeg', [
            '-loglevel',    'error',
            '-rtsp_transport', 'tcp',
            '-i',           rtspUrl,
            '-c:v',         'copy',
            '-an',
            '-f',           'hls',
            '-hls_time',    '1',
            '-hls_list_size', '3',
            '-hls_flags',   'delete_segments+omit_endlist',
            path.join(hlsDir, 'index.m3u8')
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        proc.stderr.on('data', d => process.stderr.write(`[Stream ${streamKey}] ${d}`));
        proc.on('exit', () => this._streams.delete(streamKey));

        this._streams.set(streamKey, { process: proc, hlsDir });
        return hlsDir;
    }

    stop(streamKey) {
        const s = this._streams.get(streamKey);
        if (!s) return;
        try { s.process.kill('SIGTERM'); } catch {}
        this._streams.delete(streamKey);
        setTimeout(() => {
            try { fs.rmSync(s.hlsDir, { recursive: true, force: true }); } catch {}
        }, 5000);
    }

    stopAll() {
        for (const key of [...this._streams.keys()]) this.stop(key);
    }

    getHlsDir(streamKey) {
        const s = this._streams.get(streamKey);
        return s ? s.hlsDir : null;
    }

    isActive(streamKey) {
        return this._streams.has(streamKey);
    }
}

module.exports = new StreamManager();
