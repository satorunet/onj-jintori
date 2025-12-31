/**
 * カスタムバイナリプロトコル エンコーダー/デコーダー
 * 転送量を90%以上削減するためのバイナリシリアライゼーション
 */

// メッセージタイプ定数
const MSG_TYPE = {
    STATE: 0x01,
    STATE_FULL: 0x02,
    STATE_DELTA: 0x03,
    INIT: 0x10,
    PLAYER_DEATH: 0x20,
    ROUND_START: 0x30,
    ROUND_END: 0x31,
    CHAT: 0x40
};

// 色パレット（プレイヤー色をインデックスで管理）
const COLOR_PALETTE = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#34495e', '#16a085', '#27ae60',
    '#2980b9', '#8e44ad', '#f1c40f', '#e74c3c', '#95a5a6',
    '#d35400', '#c0392b', '#7f8c8d', '#2c3e50', '#1abc9c'
];

// 色をインデックスに変換（見つからなければ追加）
const colorToIndex = new Map();
COLOR_PALETTE.forEach((c, i) => colorToIndex.set(c.toLowerCase(), i));
let nextColorIndex = COLOR_PALETTE.length;

function getColorIndex(color) {
    const c = color.toLowerCase();
    if (colorToIndex.has(c)) {
        return colorToIndex.get(c);
    }
    const idx = nextColorIndex++;
    colorToIndex.set(c, idx);
    COLOR_PALETTE[idx] = color;
    return idx;
}

function getColorByIndex(idx) {
    return COLOR_PALETTE[idx] || '#888888';
}

// プレイヤーIDをインデックスに変換
const playerIdToIndex = new Map();
const playerIndexToId = new Map();
let nextPlayerIndex = 0;

function getPlayerIndex(id) {
    if (playerIdToIndex.has(id)) {
        return playerIdToIndex.get(id);
    }
    const idx = nextPlayerIndex++;
    playerIdToIndex.set(id, idx);
    playerIndexToId.set(idx, id);
    return idx;
}

function getPlayerIdByIndex(idx) {
    return playerIndexToId.get(idx) || '';
}

function resetPlayerMapping() {
    playerIdToIndex.clear();
    playerIndexToId.clear();
    nextPlayerIndex = 0;
}

// 文字列をバッファに書き込み（長さプレフィックス付き）
function writeString(buffer, offset, str) {
    const bytes = Buffer.from(str, 'utf8');
    const len = Math.min(bytes.length, 255);
    buffer.writeUInt8(len, offset);
    bytes.copy(buffer, offset + 1, 0, len);
    return offset + 1 + len;
}

// バッファから文字列を読み取り
function readString(buffer, offset) {
    const len = buffer.readUInt8(offset);
    const str = buffer.toString('utf8', offset + 1, offset + 1 + len);
    return { value: str, newOffset: offset + 1 + len };
}

/**
 * STATE メッセージをエンコード
 */
function encodeStateMessage(players, timeRemaining, territories, isFullSync, GRID_SIZE, playerMappings) {
    // 最大サイズを計算（余裕を持って確保）
    const maxPlayerSize = 50 + 255 * 4; // 基本 + trail
    const maxTerritorySize = 7;
    const estimatedSize = 10 +
        players.length * maxPlayerSize +
        (isFullSync ? (territories ? territories.length : 0) * maxTerritorySize + 4 : 0) +
        (isFullSync ? (playerMappings ? playerMappings.length : 0) * 100 + 4 : 0);

    const buffer = Buffer.alloc(estimatedSize);
    let offset = 0;

    // ヘッダー
    buffer.writeUInt8(isFullSync ? MSG_TYPE.STATE_FULL : MSG_TYPE.STATE, offset++);
    buffer.writeUInt16LE(timeRemaining, offset); offset += 2;
    buffer.writeUInt8(players.length, offset++);

    // プレイヤーデータ
    for (const p of players) {
        const playerIdx = getPlayerIndex(p.id || p.i);
        buffer.writeUInt8(playerIdx, offset++);

        // 座標
        buffer.writeUInt16LE(Math.round(p.x) & 0xFFFF, offset); offset += 2;
        buffer.writeUInt16LE(Math.round(p.y) & 0xFFFF, offset); offset += 2;

        // 色インデックス
        const color = p.color || p.c;
        buffer.writeUInt8(getColorIndex(color), offset++);

        // 状態 (上位4bit: state, 下位4bit: invulnerable)
        const state = p.state === 'active' || p.st === 1 ? 1 :
            (p.state === 'dead' || p.st === 0 ? 0 : 2);
        const invuln = Math.min(p.invulnerableCount || p.iv || 0, 15);
        buffer.writeUInt8((state << 4) | invuln, offset++);

        // スコア
        buffer.writeUInt16LE(Math.min(p.score || p.s || 0, 65535), offset); offset += 2;

        // Trail
        const trail = p.trail || p.r || [];
        const trailLen = Math.min(trail.length, 255);
        buffer.writeUInt8(trailLen, offset++);

        for (let i = 0; i < trailLen; i++) {
            const pt = trail[i];
            // 座標をグリッド単位に正規化して2バイトに詰める
            const tx = Array.isArray(pt) ? pt[0] : pt.x;
            const ty = Array.isArray(pt) ? pt[1] : pt.y;
            const gx = Math.floor(tx / GRID_SIZE) & 0xFF;
            const gy = Math.floor(ty / GRID_SIZE) & 0xFF;
            buffer.writeUInt8(gx, offset++);
            buffer.writeUInt8(gy, offset++);
        }
    }

    // テリトリーデータ（フル同期時のみ）
    if (isFullSync) {
        if (territories) {
            buffer.writeUInt16LE(territories.length, offset); offset += 2;

            for (const t of territories) {
                const tx = Math.floor((t.x || 0) / GRID_SIZE) & 0xFFFF;
                const ty = Math.floor((t.y || 0) / GRID_SIZE) & 0xFFFF;
                const tw = Math.floor((t.w || GRID_SIZE) / GRID_SIZE) & 0xFF;
                const th = Math.floor((t.h || GRID_SIZE) / GRID_SIZE) & 0xFF;
                const colorIdx = getColorIndex(t.color || t.c || '#888');

                buffer.writeUInt16LE(tx, offset); offset += 2;
                buffer.writeUInt16LE(ty, offset); offset += 2;
                buffer.writeUInt8(tw, offset++);
                buffer.writeUInt8(th, offset++);
                buffer.writeUInt8(colorIdx, offset++);
            }
        } else {
            buffer.writeUInt16LE(0, offset); offset += 2;
        }

        // マッピングデータ
        if (playerMappings && playerMappings.length > 0) {
            buffer.writeUInt8(playerMappings.length, offset++);
            for (const p of playerMappings) {
                buffer.writeUInt8(getPlayerIndex(p.id), offset++);
                offset = writeString(buffer, offset, p.id.substring(0, 10));
                offset = writeString(buffer, offset, (p.name || '').substring(0, 20));
                offset = writeString(buffer, offset, (p.emoji || '').substring(0, 4));
                offset = writeString(buffer, offset, (p.team || '').substring(0, 15));
            }
        } else {
            buffer.writeUInt8(0, offset++);
        }
    }

    return buffer.slice(0, offset);
}

/**
 * INIT メッセージをエンコード
 */
function encodeInitMessage(playerId, color, world, mode, obstacles, territories, GRID_SIZE, playerMappings) {
    const estimatedSize = 100 +
        obstacles.length * 20 +
        territories.length * 7 +
        playerMappings.length * 100;

    const buffer = Buffer.alloc(estimatedSize);
    let offset = 0;

    buffer.writeUInt8(MSG_TYPE.INIT, offset++);
    buffer.writeUInt8(getPlayerIndex(playerId), offset++);
    buffer.writeUInt8(getColorIndex(color), offset++);
    buffer.writeUInt16LE(world.width, offset); offset += 2;
    buffer.writeUInt16LE(world.height, offset); offset += 2;
    buffer.writeUInt8(mode === 'TEAM' ? 1 : 0, offset++);

    // 障害物
    buffer.writeUInt8(Math.min(obstacles.length, 255), offset++);
    for (let i = 0; i < Math.min(obstacles.length, 255); i++) {
        const o = obstacles[i];
        buffer.writeUInt16LE(o.x, offset); offset += 2;
        buffer.writeUInt16LE(o.y, offset); offset += 2;
        buffer.writeUInt16LE(o.width, offset); offset += 2;
        buffer.writeUInt16LE(o.height, offset); offset += 2;
    }

    // テリトリー
    buffer.writeUInt16LE(territories.length, offset); offset += 2;
    for (const t of territories) {
        const tx = Math.floor((t.x || 0) / GRID_SIZE) & 0xFFFF;
        const ty = Math.floor((t.y || 0) / GRID_SIZE) & 0xFFFF;
        const tw = Math.floor((t.w || GRID_SIZE) / GRID_SIZE) & 0xFF;
        const th = Math.floor((t.h || GRID_SIZE) / GRID_SIZE) & 0xFF;
        const colorIdx = getColorIndex(t.color || t.c || '#888');

        buffer.writeUInt16LE(tx, offset); offset += 2;
        buffer.writeUInt16LE(ty, offset); offset += 2;
        buffer.writeUInt8(tw, offset++);
        buffer.writeUInt8(th, offset++);
        buffer.writeUInt8(colorIdx, offset++);
    }



    // プレイヤーマッピング（ID, 名前, emoji, チーム）
    buffer.writeUInt8(playerMappings.length, offset++);
    for (const p of playerMappings) {
        buffer.writeUInt8(getPlayerIndex(p.id), offset++);
        offset = writeString(buffer, offset, p.id.substring(0, 10));
        offset = writeString(buffer, offset, (p.name || '').substring(0, 20));
        offset = writeString(buffer, offset, (p.emoji || '').substring(0, 4));
        offset = writeString(buffer, offset, (p.team || '').substring(0, 15));
    }

    return buffer.slice(0, offset);
}

/**
 * PLAYER_DEATH メッセージをエンコード
 */
function encodePlayerDeathMessage(playerId, reason) {
    const buffer = Buffer.alloc(100);
    let offset = 0;

    buffer.writeUInt8(MSG_TYPE.PLAYER_DEATH, offset++);
    buffer.writeUInt8(getPlayerIndex(playerId), offset++);
    offset = writeString(buffer, offset, reason.substring(0, 50));

    return buffer.slice(0, offset);
}

/**
 * ROUND_START メッセージをエンコード
 */
function encodeRoundStartMessage(mode, world, obstacles) {
    const buffer = Buffer.alloc(10 + obstacles.length * 8);
    let offset = 0;

    buffer.writeUInt8(MSG_TYPE.ROUND_START, offset++);
    buffer.writeUInt8(mode === 'TEAM' ? 1 : 0, offset++);
    buffer.writeUInt16LE(world.width, offset); offset += 2;
    buffer.writeUInt16LE(world.height, offset); offset += 2;

    buffer.writeUInt8(Math.min(obstacles.length, 255), offset++);
    for (let i = 0; i < Math.min(obstacles.length, 255); i++) {
        const o = obstacles[i];
        buffer.writeUInt16LE(o.x, offset); offset += 2;
        buffer.writeUInt16LE(o.y, offset); offset += 2;
        buffer.writeUInt16LE(o.w, offset); offset += 2;
        buffer.writeUInt16LE(o.h, offset); offset += 2;
    }

    return buffer.slice(0, offset);
}

/**
 * CHAT メッセージをエンコード
 */
function encodeChatMessage(text, color, name) {
    const buffer = Buffer.alloc(150);
    let offset = 0;

    buffer.writeUInt8(MSG_TYPE.CHAT, offset++);
    buffer.writeUInt8(getColorIndex(color), offset++);
    offset = writeString(buffer, offset, name.substring(0, 20));
    offset = writeString(buffer, offset, text.substring(0, 50));

    return buffer.slice(0, offset);
}

module.exports = {
    MSG_TYPE,
    COLOR_PALETTE,
    getColorIndex,
    getColorByIndex,
    getPlayerIndex,
    getPlayerIdByIndex,
    resetPlayerMapping,
    encodeStateMessage,
    encodeInitMessage,
    encodePlayerDeathMessage,
    encodeRoundStartMessage,
    encodeChatMessage,
    writeString,
    readString
};
